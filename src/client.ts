/**
 * Puter API Client
 * 
 * Handles all communication with Puter.com's AI API.
 * Includes automatic retry with exponential backoff for transient failures.
 */

import type {
  PuterChatMessage,
  PuterChatOptions,
  PuterChatResponse,
  PuterChatStreamChunk,
  PuterModelInfo,
  PuterConfig,
  PuterMonthlyUsage,
} from './types.js';
import { withRetry, type RetryOptions } from './retry.js';
import { createLoggerFromConfig, type Logger } from './logger.js';
import { ResponseCache, buildCacheKey, type CacheStats } from './cache.js';
import { ModelMetricsStore } from './metrics.js';

const DEFAULT_API_URL = 'https://api.puter.com';
const DEFAULT_TIMEOUT = 120000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;
const DEFAULT_CACHE_TTL = 300000; // 5 minutes
const DEFAULT_CACHE_MAX_ENTRIES = 100;
const DEFAULT_METRICS_MAX_SAMPLES = 200;

function normalizeErrorText(errorText: string): string {
  const trimmed = errorText?.trim();
  return trimmed ? trimmed : 'Unknown error';
}

function getErrorHint(status: number | undefined, errorText: string): string | undefined {
  const text = errorText.toLowerCase();

  if (status === 401) {
    return 'Not authenticated or token expired. Run `puter-auth login` to refresh credentials.';
  }

  if (status === 403) {
    if (text.includes('usage-limited') || text.includes('permission denied') || text.includes('credits') || text.includes('exhaust')) {
      return 'Account likely out of credits. Check usage with `puter-usage` or switch accounts.';
    }
    return 'Access forbidden. Check account permissions and usage limits.';
  }

  if (status === 429 || text.includes('rate limit')) {
    return 'Rate limited. Wait and retry, or enable account rotation.';
  }

  if (status && status >= 500) {
    return 'Puter service error. Retry later.';
  }

  if (status === 404) {
    return 'Endpoint not found. Make sure you are on the latest version.';
  }

  return undefined;
}

function formatApiError(prefix: string, status: number, errorText: string): string {
  const cleanText = normalizeErrorText(errorText);
  const base = `${prefix} (${status}): ${cleanText}`;
  const hint = getErrorHint(status, cleanText);
  return hint ? `${base} Hint: ${hint}` : base;
}

/**
 * Model cache entry
 */
interface ModelCache {
  models: PuterModelInfo[];
  timestamp: number;
}

/**
 * User-app-token cache entry
 * The user-app-token is required for /drivers/call endpoint
 * and must be obtained via /auth/get-user-app-token with a specific origin
 */
interface UserAppTokenCache {
  token: string;
  origin: string;
  timestamp: number;
}

// Default origin for CLI apps - must match the Origin header in requests
const DEFAULT_APP_ORIGIN = 'http://localhost:5500';
const USER_APP_TOKEN_TTL = 3600000; // 1 hour

export class PuterClient {
  private authToken: string;
  private config: Partial<PuterConfig>;
  private logger: Logger;
  private modelCache: ModelCache | null = null;
  private userAppTokenCache: UserAppTokenCache | null = null;
  private appOrigin: string;
  private responseCache: ResponseCache<PuterChatResponse>;
  private metrics: ModelMetricsStore;

  constructor(authToken: string, config: Partial<PuterConfig> = {}) {
    this.authToken = authToken;
    this.config = config;
    this.logger = createLoggerFromConfig(config);
    this.appOrigin = DEFAULT_APP_ORIGIN;
    this.responseCache = new ResponseCache<PuterChatResponse>({
      enabled: this.config.cache_enabled ?? false,
      ttlMs: this.config.cache_ttl_ms ?? DEFAULT_CACHE_TTL,
      maxEntries: this.config.cache_max_entries ?? DEFAULT_CACHE_MAX_ENTRIES,
      directory: this.config.cache_directory,
    });
    this.metrics = new ModelMetricsStore({
      enabled: this.config.metrics_enabled ?? true,
      maxSamples: this.config.metrics_max_samples ?? DEFAULT_METRICS_MAX_SAMPLES,
      filePath: this.config.metrics_file,
    });
  }

  /**
   * Get user-app-token required for /drivers/call endpoint
   * 
   * The /drivers/call endpoint requires a user-app-token (not the regular auth token)
   * which is obtained by calling /auth/get-user-app-token with a specific origin.
   * The origin must then be included as a header in subsequent /drivers/call requests.
   * 
   * This is the key fix for the 403 Forbidden error on /drivers/call.
   * 
   * @returns User-app-token for API calls
   */
  private async getUserAppToken(): Promise<string> {
    // Check cache first
    if (this.userAppTokenCache) {
      const cacheAge = Date.now() - this.userAppTokenCache.timestamp;
      if (cacheAge < USER_APP_TOKEN_TTL && this.userAppTokenCache.origin === this.appOrigin) {
        this.logger.debug('Using cached user-app-token', { age: `${Math.round(cacheAge / 1000)}s` });
        return this.userAppTokenCache.token;
      }
      this.logger.debug('User-app-token cache expired or origin changed');
    }

    const startTime = Date.now();
    this.logger.request('POST', '/auth/get-user-app-token', { origin: this.appOrigin });

    try {
      const response = await fetch(`${this.apiUrl}/auth/get-user-app-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`,
          'Origin': this.appOrigin,
        },
        body: JSON.stringify({
          origin: this.appOrigin,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(formatApiError('Failed to get user-app-token', response.status, errorText));
      }

      const data = await response.json();
      const token = data.token || data.user_app_token || data;
      
      const duration = Date.now() - startTime;
      this.logger.response(200, 'OK (user-app-token obtained)', duration);

      // Cache the token
      this.userAppTokenCache = {
        token: typeof token === 'string' ? token : JSON.stringify(token),
        origin: this.appOrigin,
        timestamp: Date.now(),
      };

      return this.userAppTokenCache.token;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.warn('Failed to get user-app-token, falling back to auth_token', { 
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      // Fall back to regular auth token if user-app-token fails
      return this.authToken;
    }
  }

  /**
   * Invalidate the user-app-token cache
   */
  public invalidateUserAppTokenCache(): void {
    if (this.userAppTokenCache) {
      this.userAppTokenCache = null;
      this.logger.debug('User-app-token cache invalidated');
    }
  }

  /**
   * Get the cache TTL in milliseconds
   */
  private get cacheTtl(): number {
    return this.config.cache_ttl_ms ?? DEFAULT_CACHE_TTL;
  }

  /**
   * Get the API base URL
   */
  private get apiUrl(): string {
    return this.config.api_base_url || DEFAULT_API_URL;
  }

  /**
   * Get the request timeout
   */
  private get timeout(): number {
    return this.config.api_timeout_ms || DEFAULT_TIMEOUT;
  }

  /**
   * Get retry options from config
   */
  private get retryOptions(): RetryOptions {
    return {
      maxRetries: this.config.max_retries ?? DEFAULT_MAX_RETRIES,
      initialDelay: this.config.retry_delay_ms ?? DEFAULT_RETRY_DELAY,
      onRetry: (attempt, error, delay) => {
        // Extract status code from error message if present
        const statusMatch = error.message.match(/\((\d+)\)/);
        const status = statusMatch ? statusMatch[1] : 'error';
        const reason = error.message.includes('429') || error.message.includes('rate limit')
          ? `Rate limited (${status})`
          : error.message.includes('timeout')
            ? 'Timeout'
            : `Error (${status})`;
        
        this.logger.retry(
          attempt,
          this.config.max_retries ?? DEFAULT_MAX_RETRIES,
          reason,
          delay
        );
      },
    };
  }

  /**
   * Update the auth token
   * 
   * Note: This invalidates both model and user-app-token caches since they're account-specific.
   */
  public setAuthToken(token: string): void {
    if (this.authToken !== token) {
      this.authToken = token;
      this.modelCache = null; // Invalidate cache on token change
      this.userAppTokenCache = null; // Invalidate user-app-token too
      this.logger.debug('Auth token updated, caches invalidated');
    }
  }

  /**
   * Clear cached chat responses (if enabled).
   */
  public async clearResponseCache(): Promise<void> {
    await this.responseCache.clear();
  }

  /**
   * Get response cache stats (if enabled).
   */
  public async getResponseCacheStats(): Promise<CacheStats> {
    return this.responseCache.getStats();
  }

  /**
   * Invalidate the model cache
   * 
   * Forces the next `listModels()` call to fetch fresh data from the API.
   */
  public invalidateModelCache(): void {
    if (this.modelCache) {
      this.modelCache = null;
      this.logger.debug('Model cache invalidated');
    }
  }

  /**
   * Send a chat completion request (non-streaming)
   * 
   * Automatically retries on transient failures (rate limits, server errors)
   * using exponential backoff with jitter.
   * 
   * @param messages - Array of chat messages
   * @param options - Chat options (model, temperature, etc.)
   * @returns Chat response with assistant message
   * @throws Error if request fails after all retries
   * 
   * @example
   * ```ts
   * const response = await client.chat([
   *   { role: 'user', content: 'Hello!' }
   * ], { model: 'claude-opus-4-5' });
   * console.log(response.message.content);
   * ```
   */
  public async chat(
    messages: PuterChatMessage[],
    options: PuterChatOptions = {}
  ): Promise<PuterChatResponse> {
    const model = options.model || 'gpt-5-nano';
    const startTime = Date.now();
    const cacheKeyInput = {
      model,
      messages,
      max_tokens: options.max_tokens,
      temperature: options.temperature,
      tools: options.tools,
    };
    const cacheKey = (this.config.cache_enabled ?? false)
      ? buildCacheKey(cacheKeyInput)
      : null;

    if (cacheKey) {
      const cached = await this.responseCache.get(cacheKey);
      if (cached) {
        this.logger.debug('Using cached chat response', { model });
        return cached;
      }
    }
    
    this.logger.request('POST', '/drivers/call', {
      method: 'complete',
      model,
      stream: false,
      messages: messages.length,
    });

    try {
      const response = await this.makeRequest('complete', {
        messages,
        model,
        stream: false,
        max_tokens: options.max_tokens,
        temperature: options.temperature,
        tools: options.tools,
      });

      const duration = Date.now() - startTime;
      this.logger.response(200, 'OK', duration);
      const result = response.result as PuterChatResponse;

      if (cacheKey) {
        await this.responseCache.set(cacheKey, result);
      }

      await this.metrics.recordSuccess(model, duration, result.usage);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const statusMatch = error instanceof Error && error.message.match(/\((\d+)\)/);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : 500;
      this.logger.response(status, error instanceof Error ? error.message : 'Unknown error', duration);
      await this.metrics.recordFailure(model, duration, error);
      throw error;
    }
  }

  /**
   * Send a streaming chat completion request
   * 
   * Returns an async generator that yields chunks as they arrive.
   * The initial connection is retried on transient failures.
   * Uses user-app-token flow to bypass 403 Forbidden errors.
   * 
   * @param messages - Array of chat messages
   * @param options - Chat options (model, temperature, etc.)
   * @yields Chat stream chunks with text, reasoning, or tool calls
   * 
   * @example
   * ```ts
   * for await (const chunk of client.chatStream([
   *   { role: 'user', content: 'Tell me a story' }
   * ])) {
   *   if (chunk.text) process.stdout.write(chunk.text);
   * }
   * ```
   */
  public async *chatStream(
    messages: PuterChatMessage[],
    options: PuterChatOptions = {}
  ): AsyncGenerator<PuterChatStreamChunk> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    const model = options.model || 'gpt-5-nano';
    const startTime = Date.now();
    let finalUsage: PuterChatResponse['usage'] | undefined;

    this.logger.request('POST', '/drivers/call', {
      method: 'complete',
      model,
      stream: true,
      messages: messages.length,
    });

    // Get user-app-token (required for /drivers/call)
    const userAppToken = await this.getUserAppToken();

    try {
      // Retry the initial connection
      const response = await withRetry(async () => {
        const res = await fetch(`${this.apiUrl}/drivers/call`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Origin': this.appOrigin,
          },
          body: JSON.stringify({
            interface: 'puter-chat-completion',
            service: 'ai-chat',
            method: 'complete',
            args: {
              messages,
              model,
              stream: true,
              max_tokens: options.max_tokens,
              temperature: options.temperature,
              tools: options.tools,
            },
            auth_token: userAppToken,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errorText = await res.text();
          // If we get 403, invalidate the user-app-token cache
          if (res.status === 403) {
            this.invalidateUserAppTokenCache();
          }
          throw new Error(formatApiError('Puter API error', res.status, errorText));
        }

        return res;
      }, this.retryOptions);

      const connectionTime = Date.now() - startTime;
      this.logger.debug('Stream connected', { duration: `${connectionTime}ms` });

      if (!response.body) {
        throw new Error('No response body for streaming');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          
          try {
            const chunk = JSON.parse(line) as PuterChatStreamChunk;
            yield chunk;
            if (chunk.usage) {
              finalUsage = chunk.usage;
            }
            
            if (chunk.done) {
              const totalDuration = Date.now() - startTime;
              this.logger.response(200, 'Stream complete', totalDuration);
              await this.metrics.recordSuccess(model, totalDuration, finalUsage);
              return;
            }
          } catch {
            // Skip malformed JSON lines
            continue;
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const chunk = JSON.parse(buffer) as PuterChatStreamChunk;
          yield chunk;
        } catch {
          // Ignore
        }
      }
      
      const totalDuration = Date.now() - startTime;
      this.logger.response(200, 'Stream ended', totalDuration);
      await this.metrics.recordSuccess(model, totalDuration, finalUsage);
    } catch (error) {
      const totalDuration = Date.now() - startTime;
      await this.metrics.recordFailure(model, totalDuration, error);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * List available models from Puter API
   * 
   * Falls back to a default model list if the API is unavailable.
   * Results are cached in memory with configurable TTL (default: 5 minutes).
   * 
   * @param forceRefresh - Bypass cache and fetch fresh data from API
   * @returns Array of available model information
   * 
   * @example
   * ```ts
   * const models = await client.listModels();
   * models.forEach(m => console.log(`${m.id}: ${m.name}`));
   * 
   * // Force refresh from API
   * const freshModels = await client.listModels(true);
   * ```
   */
  public async listModels(forceRefresh = false): Promise<PuterModelInfo[]> {
    // Check cache first
    if (!forceRefresh && this.modelCache) {
      const cacheAge = Date.now() - this.modelCache.timestamp;
      if (cacheAge < this.cacheTtl) {
        this.logger.debug('Using cached models', { 
          count: this.modelCache.models.length, 
          age: `${Math.round(cacheAge / 1000)}s` 
        });
        return this.modelCache.models;
      }
      this.logger.debug('Model cache expired', { age: `${Math.round(cacheAge / 1000)}s` });
    }
    
    const startTime = Date.now();
    this.logger.request('GET', '/puterai/chat/models/details', { forceRefresh });
    
    try {
      const models = await withRetry(async () => {
        const response = await fetch(`${this.apiUrl}/puterai/chat/models/details`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.authToken}`,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch models (${response.status})`);
        }

        const data = await response.json();
        return data.models || data || [];
      }, this.retryOptions);
      
      const duration = Date.now() - startTime;
      this.logger.response(200, `OK (${models.length} models)`, duration);
      
      // Cache the results
      this.modelCache = {
        models,
        timestamp: Date.now(),
      };
      this.logger.debug('Model list cached', { count: models.length, ttl: `${this.cacheTtl / 1000}s` });
      
      return models;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.warn('Failed to fetch models, using defaults', { duration: `${duration}ms` });
      
      // Cache the defaults too, but with a shorter TTL (30 seconds)
      const defaults = this.getDefaultModels();
      this.modelCache = {
        models: defaults,
        timestamp: Date.now() - (this.cacheTtl - 30000), // Expire in 30 seconds
      };
      
      return defaults;
    }
  }

  /**
   * Get default model list (fallback)
   */
  private getDefaultModels(): PuterModelInfo[] {
    return [
      // Claude Models
      { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', provider: 'anthropic', context_window: 200000, max_output_tokens: 64000, supports_streaming: true, supports_tools: true, supports_vision: true },
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', provider: 'anthropic', context_window: 200000, max_output_tokens: 64000, supports_streaming: true, supports_tools: true, supports_vision: true },
      { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'anthropic', context_window: 200000, max_output_tokens: 64000, supports_streaming: true, supports_tools: true, supports_vision: true },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic', context_window: 200000, max_output_tokens: 64000, supports_streaming: true, supports_tools: true, supports_vision: true },
      
      // GPT Models
      { id: 'gpt-5-nano', name: 'GPT-5 Nano', provider: 'openai', context_window: 128000, max_output_tokens: 16384, supports_streaming: true, supports_tools: true, supports_vision: true },
      { id: 'gpt-5.2', name: 'GPT-5.2', provider: 'openai', context_window: 128000, max_output_tokens: 32768, supports_streaming: true, supports_tools: true, supports_vision: true },
      { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', context_window: 128000, max_output_tokens: 16384, supports_streaming: true, supports_tools: true, supports_vision: true },
      { id: 'o3-mini', name: 'o3-mini', provider: 'openai', context_window: 128000, max_output_tokens: 32768, supports_streaming: true, supports_tools: true, supports_vision: false },
      
      // Gemini Models
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'google', context_window: 1000000, max_output_tokens: 65536, supports_streaming: true, supports_tools: true, supports_vision: true },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google', context_window: 1000000, max_output_tokens: 65536, supports_streaming: true, supports_tools: true, supports_vision: true },
    ];
  }

  /**
   * Make a generic API request to the drivers endpoint
   * 
   * Includes automatic retry with exponential backoff for transient failures.
   * Uses user-app-token flow to bypass 403 Forbidden errors.
   * 
   * @param method - API method to call
   * @param args - Arguments to pass to the method
   * @returns API response
   * @throws Error if request fails after all retries
   */
  private async makeRequest(
    method: string,
    args: Record<string, unknown>
  ): Promise<{ result: unknown }> {
    // Get user-app-token (required for /drivers/call)
    const userAppToken = await this.getUserAppToken();
    
    return withRetry(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        const response = await fetch(`${this.apiUrl}/drivers/call`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Origin': this.appOrigin,
          },
          body: JSON.stringify({
            interface: 'puter-chat-completion',
            service: 'ai-chat',
            method,
            args,
            auth_token: userAppToken,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          // If we get 403, invalidate the user-app-token cache and retry
          if (response.status === 403) {
            this.invalidateUserAppTokenCache();
          }
          throw new Error(formatApiError('Puter API error', response.status, errorText));
        }

        const data = await response.json();
        return data;
      } finally {
        clearTimeout(timeoutId);
      }
    }, this.retryOptions);
  }

  /**
   * Test the connection and auth token validity
   * 
   * Makes a minimal API call to verify the token works.
   * 
   * @returns true if connection is successful, false otherwise
   * 
   * @example
   * ```ts
   * if (await client.testConnection()) {
   *   console.log('Connected to Puter!');
   * } else {
   *   console.log('Connection failed');
   * }
   * ```
   */
  public async testConnection(): Promise<boolean> {
    this.logger.debug('Testing connection');
    try {
      const response = await this.chat(
        [{ role: 'user', content: 'Say "OK" and nothing else.' }],
        { model: 'gpt-5-nano', max_tokens: 10 }
      );
      const success = !!response.message?.content;
      this.logger.debug('Connection test', { success });
      return success;
    } catch (error) {
      this.logger.debug('Connection test failed', error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  /**
   * Get the user's monthly usage and remaining credits
   * 
   * @returns Monthly usage information including allowance and remaining credits
   * 
   * @example
   * ```ts
   * const usage = await client.getMonthlyUsage();
   * console.log(`Remaining: $${usage.allowanceInfo.remaining / 100000000}`);
   * ```
   */
  public async getMonthlyUsage(): Promise<PuterMonthlyUsage> {
    const startTime = Date.now();
    this.logger.request('GET', '/auth/get-monthly-usage', {});
    
    try {
      const response = await fetch(`${this.apiUrl}/auth/get-monthly-usage`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.authToken}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(formatApiError('Failed to get monthly usage', response.status, errorText));
      }

      const data = await response.json();
      const duration = Date.now() - startTime;
      this.logger.response(200, 'OK', duration);
      
      return data as PuterMonthlyUsage;
    } catch (error) {
      const duration = Date.now() - startTime;
      const statusMatch = error instanceof Error && error.message.match(/\((\d+)\)/);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : 500;
      this.logger.response(status, error instanceof Error ? error.message : 'Unknown error', duration);
      throw error;
    }
  }
}
