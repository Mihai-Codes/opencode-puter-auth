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
} from './types.js';
import { withRetry, type RetryOptions } from './retry.js';

const DEFAULT_API_URL = 'https://api.puter.com';
const DEFAULT_TIMEOUT = 120000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;

export class PuterClient {
  private authToken: string;
  private config: Partial<PuterConfig>;
  private debug: boolean;

  constructor(authToken: string, config: Partial<PuterConfig> = {}) {
    this.authToken = authToken;
    this.config = config;
    this.debug = config.debug ?? false;
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
      onRetry: this.debug
        ? (attempt, error, delay) => {
            console.warn(`[PuterClient] Retry ${attempt}: ${error.message} (waiting ${delay}ms)`);
          }
        : undefined,
    };
  }

  /**
   * Update the auth token
   */
  public setAuthToken(token: string): void {
    this.authToken = token;
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
    const response = await this.makeRequest('complete', {
      messages,
      model: options.model || 'gpt-5-nano',
      stream: false,
      max_tokens: options.max_tokens,
      temperature: options.temperature,
      tools: options.tools,
    });

    return response.result as PuterChatResponse;
  }

  /**
   * Send a streaming chat completion request
   * 
   * Returns an async generator that yields chunks as they arrive.
   * The initial connection is retried on transient failures.
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

    try {
      // Retry the initial connection
      const response = await withRetry(async () => {
        const res = await fetch(`${this.apiUrl}/drivers/call`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            interface: 'puter-chat-completion',
            service: 'ai-chat',
            method: 'complete',
            args: {
              messages,
              model: options.model || 'gpt-5-nano',
              stream: true,
              max_tokens: options.max_tokens,
              temperature: options.temperature,
              tools: options.tools,
            },
            auth_token: this.authToken,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`Puter API error (${res.status}): ${errorText}`);
        }

        return res;
      }, this.retryOptions);

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
            
            if (chunk.done) {
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
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * List available models from Puter API
   * 
   * Falls back to a default model list if the API is unavailable.
   * 
   * @returns Array of available model information
   * 
   * @example
   * ```ts
   * const models = await client.listModels();
   * models.forEach(m => console.log(`${m.id}: ${m.name}`));
   * ```
   */
  public async listModels(): Promise<PuterModelInfo[]> {
    try {
      return await withRetry(async () => {
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
    } catch {
      // Return default models if API fails after retries
      if (this.debug) {
        console.warn('[PuterClient] Failed to fetch models, using defaults');
      }
      return this.getDefaultModels();
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
    return withRetry(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        const response = await fetch(`${this.apiUrl}/drivers/call`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            interface: 'puter-chat-completion',
            service: 'ai-chat',
            method,
            args,
            auth_token: this.authToken,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Puter API error (${response.status}): ${errorText}`);
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
    try {
      const response = await this.chat(
        [{ role: 'user', content: 'Say "OK" and nothing else.' }],
        { model: 'gpt-5-nano', max_tokens: 10 }
      );
      return !!response.message?.content;
    } catch {
      return false;
    }
  }
}
