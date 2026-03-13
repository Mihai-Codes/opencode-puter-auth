/**
 * Puter Chat Language Model
 * 
 * Implements the AI SDK LanguageModelV2 interface using the official @heyputer/puter.js SDK.
 * This enables Puter to work as a proper AI SDK provider in OpenCode.
 * 
 * Note: We use V2 because OpenCode's AI SDK 5.x only supports LanguageModelV2.
 * 
 * Features automatic model fallback when rate limits are encountered.
 */

import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2StreamPart,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2Usage,
  LanguageModelV2Message,
  LanguageModelV2TextPart,
  LanguageModelV2FilePart,
  LanguageModelV2ToolCallPart,
  LanguageModelV2ToolResultPart,
  LanguageModelV2FunctionTool,
  LanguageModelV2CallWarning,
} from '@ai-sdk/provider';
import type { PuterChatSettings, PuterChatConfig } from './puter-chat-settings.js';
import { 
  getGlobalFallbackManager, 
  type FallbackManager,
  classifyError,
} from '../fallback.js';
import { 
  getGlobalAccountRotationManager, 
  type AccountRotationManager,
  type IAuthManager,
  AllAccountsOnCooldownError,
} from '../account-rotation.js';
import { createLogger, type Logger } from '../logger.js';
import { ResponseCache, buildCacheKey } from '../cache.js';
import { ModelMetricsStore } from '../metrics.js';
import { getConfigDir } from '../paths.js';

// Type definitions for Puter SDK responses
interface PuterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cached_tokens?: number;
  // Alternative property names from Puter streaming
  prompt?: number;
  completion?: number;
  input_cache_read?: number;
}

interface PuterToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

// Content block from Claude-style response
interface PuterContentBlock {
  type: 'text' | 'tool_use' | 'reasoning' | 'thinking';
  text?: string;
  // For tool_use blocks
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface PuterChatResponse {
  index?: number;
  message?: {
    role: string;
    // Content can be a string OR an array of content blocks (Claude-style)
    content: string | PuterContentBlock[] | null;
    tool_calls?: PuterToolCall[];
    refusal?: string | null;
  };
  finish_reason?: string;
  usage?: PuterUsage;
  via_ai_chat_service?: boolean;
  toString?: () => string;
  valueOf?: () => string;
}

interface PuterStreamChunk {
  type?: string;
  text?: string;
  usage?: PuterUsage;
  // Tool use fields (for streaming tool calls)
  id?: string;           // Tool call ID
  name?: string;         // Tool/function name
  input?: Record<string, unknown>; // Already parsed arguments
  // Reasoning fields (for thinking models)
  reasoning?: string;    // Reasoning/thinking content
}

// Puter SDK message format
interface PuterSDKMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | PuterSDKContentPart[];
  tool_call_id?: string;
  tool_calls?: PuterToolCall[];
}

interface PuterSDKContentPart {
  type: 'text' | 'tool_result' | 'image_url' | 'file';
  text?: string;
  tool_use_id?: string;
  content?: string;
  image_url?: { url: string };
  puter_path?: string;
}

interface PuterSDKTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface PuterSDKOptions {
  model: string;
  stream?: boolean;
  vision?: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop?: string[];
  tools?: PuterSDKTool[];
}

// Type for the Puter SDK instance
interface PuterSDK {
  ai: {
    chat: (
      messages: string | PuterSDKMessage[],
      options?: PuterSDKOptions
    ) => Promise<PuterChatResponse | AsyncIterable<PuterStreamChunk>>;
  };
  setAuthToken: (token: string) => void;
  print: (message: unknown) => void;
}

interface CachedGenerateResult {
  content: Array<LanguageModelV2Content>;
  finishReason: LanguageModelV2FinishReason;
  usage: LanguageModelV2Usage;
  request?: { body?: unknown };
  response?: { body?: unknown };
}

const BASE64_RE = /^[A-Za-z0-9+/=]+$/;

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isDataUrl(value: string): boolean {
  return /^data:/i.test(value);
}

function isProbablyBase64(value: string): boolean {
  return value.length > 32 && BASE64_RE.test(value);
}

function normalizeFileData(data: LanguageModelV2FilePart['data']): string | null {
  if (typeof data === 'string') return data;
  if (data instanceof URL) return data.toString();
  if (data instanceof Uint8Array) return Buffer.from(data).toString('base64');
  return null;
}

/**
 * Puter Chat Language Model implementing LanguageModelV2.
 * Uses the official @heyputer/puter.js SDK for all API calls.
 * 
 * Note: We use V2 because OpenCode's AI SDK 5.x only supports LanguageModelV2.
 * 
 * Features automatic model fallback when rate limits are encountered:
 * - Detects rate limit errors (429, 403)
 * - Automatically switches to free OpenRouter models
 * - Tracks model cooldowns to avoid repeated failures
 */
export class PuterChatLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = 'v2' as const;
  readonly provider: string;
  readonly modelId: string;
  
  private readonly settings: PuterChatSettings;
  // IMPORTANT: Named _modelConfig (not 'config') to avoid collision with OpenCode's
  // plugin loader which checks hook.config expecting a function. Using 'config'
  // here causes "hook.config is not a function" errors at startup.
  private readonly _modelConfig: PuterChatConfig;
  private puterInstance: PuterSDK | null = null;
  private readonly fallbackManager: FallbackManager;
  private accountRotationManager: AccountRotationManager | null = null;
  private readonly logger: Logger;
  private readonly responseCache: ResponseCache<CachedGenerateResult>;
  private readonly metrics: ModelMetricsStore;

  constructor(
    modelId: string,
    settings: PuterChatSettings,
    config: PuterChatConfig
  ) {
    this.modelId = modelId;
    this.settings = settings;
    this._modelConfig = config;
    this.provider = config.provider;
    
    // Initialize fallback manager with config options
    this.fallbackManager = getGlobalFallbackManager(config.fallback);
    
    // Create logger (uses console by default, can be configured)
    this.logger = createLogger({
      enabled: config.log_enabled === true,
      debug: config.debug ?? false,
      quiet_mode: config.quiet_mode ?? false,
    });

    this.responseCache = new ResponseCache<CachedGenerateResult>({
      enabled: config.cache?.enabled ?? false,
      ttlMs: config.cache?.ttlMs ?? 300000,
      maxEntries: config.cache?.maxEntries ?? 100,
      directory: config.cache?.directory,
    });

    this.metrics = new ModelMetricsStore({
      enabled: config.metrics?.enabled ?? true,
      maxSamples: config.metrics?.maxSamples ?? 200,
      filePath: config.metrics?.filePath,
    });
    
    // AccountRotationManager will be initialized lazily when needed
    // (requires auth manager which may not be available at construction time)
  }

  /**
   * Initialize the AccountRotationManager lazily.
   * This is called when we need to handle account rotation.
   */
  private async getAccountRotationManager(): Promise<AccountRotationManager | null> {
    if (this.accountRotationManager) {
      return this.accountRotationManager;
    }

    try {
      // Load auth manager from config directory
      const configDir = getConfigDir();
      
      // Dynamically import auth module to avoid circular dependencies
      const { createPuterAuthManager } = await import('../auth.js');
      const authManager = createPuterAuthManager(configDir);
      await authManager.init();
      
      // Only create rotation manager if we have multiple accounts
      if (authManager.getAllAccounts().length > 1) {
        this.accountRotationManager = getGlobalAccountRotationManager(
          authManager as IAuthManager,
          { enabled: true },
          this.logger
        );
        this.logger.debug(`Account rotation enabled with ${authManager.getAllAccounts().length} accounts`);
      }
      
      return this.accountRotationManager;
    } catch (error) {
      // If we can't initialize, account rotation just won't be available
      this.logger.debug(`Account rotation not available: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  }

  /**
   * Reset the Puter SDK instance to force re-initialization with new credentials.
   * This is called after account rotation to pick up the new auth token.
   */
  private resetPuterInstance(): void {
    this.puterInstance = null;
  }

  /**
   * Check if an error indicates account-level exhaustion (403 Forbidden).
   */
  private isAccountExhaustedError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const msg = error.message.toLowerCase();
    const errorType = classifyError(error);
    return errorType === 'forbidden' || msg.includes('403') || msg.includes('credits exhausted');
  }

  /**
   * Execute an operation with account rotation support.
   * 
   * When an account returns 403 (credits exhausted), this will:
   * 1. Add the current account to cooldown
   * 2. Rotate to the next available account
   * 3. Reset the Puter SDK to use new credentials
   * 4. Retry the operation
   * 
   * If all accounts are exhausted, lets the error propagate (fallback manager will handle it).
   */
  private async executeWithAccountRotation<T>(
    operation: () => Promise<T>,
    maxRotations: number = 3
  ): Promise<{ result: T; wasRotated: boolean; accountUsed?: string }> {
    let rotations = 0;
    let wasRotated = false;
    let lastError: Error | null = null;

    while (rotations <= maxRotations) {
      try {
        const result = await operation();
        
        // Success! If we rotated, mark the new account as working
        const rotationManager = await this.getAccountRotationManager();
        if (rotationManager && wasRotated) {
          const summary = rotationManager.getSummary();
          if (summary.currentAccount) {
            rotationManager.removeFromCooldown(summary.currentAccount);
          }
        }
        
        return { 
          result, 
          wasRotated,
          accountUsed: (await this.getAccountRotationManager())?.getSummary().currentAccount ?? undefined
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Check if this is an account exhaustion error (403)
        if (!this.isAccountExhaustedError(error)) {
          // Not an account error, let it propagate
          throw error;
        }

        // Try to rotate to another account
        const rotationManager = await this.getAccountRotationManager();
        if (!rotationManager) {
          // No rotation manager (single account), let error propagate
          throw error;
        }

        try {
          const rotationResult = await rotationManager.handleRateLimitError(lastError);
          if (!rotationResult) {
            // All accounts on cooldown
            this.logger.warn('All accounts exhausted, falling back to free models');
            throw new AllAccountsOnCooldownError(rotationManager.getAccountStatuses());
          }

          // Successfully rotated to a new account
          this.logger.info(`Account ${rotationResult.previousUsername} exhausted, rotated to ${rotationResult.account.username}`);
          this.resetPuterInstance(); // Force re-init with new credentials
          wasRotated = true;
          rotations++;
        } catch (rotationError) {
          if (rotationError instanceof AllAccountsOnCooldownError) {
            // All accounts exhausted, let fallback manager handle it
            throw lastError; // Throw the original 403 error
          }
          throw rotationError;
        }
      }
    }

    // Max rotations reached
    throw lastError || new Error('Max account rotations reached');
  }

  /**
   * Initialize the Puter SDK with auth token.
   */
  private async initPuterSDK(): Promise<PuterSDK> {
    if (this.puterInstance) {
      return this.puterInstance;
    }

    // Dynamically import the Puter SDK init function
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    const { init } = require('@heyputer/puter.js/src/init.cjs') as { init: (token?: string) => PuterSDK };

    // Get auth token from config headers
    const headers = await this._modelConfig.headers();
    const authHeader = headers['Authorization'] || '';
    const authToken = authHeader.replace('Bearer ', '');

    if (!authToken) {
      throw new Error(
        'Puter auth token is required. Please authenticate with `npx opencode-puter-auth login` or set PUTER_AUTH_TOKEN.'
      );
    }

    // Initialize the SDK with the auth token
    this.puterInstance = init(authToken);
    return this.puterInstance;
  }

  /**
   * Supported URL patterns for native file handling.
   * Puter doesn't natively handle URLs, so we return an empty map.
   */
  get supportedUrls(): Record<string, RegExp[]> {
    return {};
  }

  /**
   * Convert AI SDK prompt to Puter SDK message format.
   */
  private convertPromptToMessages(prompt: LanguageModelV2Message[]): { messages: PuterSDKMessage[]; hasVision: boolean } {
    const messages: PuterSDKMessage[] = [];
    let hasVision = false;

    for (const message of prompt) {
      if (message.role === 'system') {
        messages.push({
          role: 'system',
          content: message.content,
        });
      } else if (message.role === 'user') {
        const contentParts: PuterSDKContentPart[] = [];

        for (const part of message.content) {
          if (part.type === 'text') {
            contentParts.push({ type: 'text', text: part.text });
            continue;
          }

          if (part.type === 'file') {
            const filePart = part as LanguageModelV2FilePart;
            const mediaType = filePart.mediaType?.toLowerCase() ?? '';
            const raw = normalizeFileData(filePart.data);

            if (!raw) {
              throw new Error('Unsupported file content provided to Puter.');
            }

            if (mediaType.startsWith('image/')) {
              let url = raw;
              if (!isHttpUrl(url) && !isDataUrl(url)) {
                if (isProbablyBase64(url)) {
                  url = `data:${mediaType};base64,${url}`;
                }
              }
              contentParts.push({ type: 'image_url', image_url: { url } });
              hasVision = true;
              continue;
            }

            if (isHttpUrl(raw) || isDataUrl(raw)) {
              throw new Error(
                'Puter file inputs require a Puter path. Upload the file to Puter and pass its puter_path (e.g., /home/username/file.pdf).'
              );
            }

            contentParts.push({ type: 'file', puter_path: raw });
            continue;
          }
        }

        if (contentParts.length === 0) {
          messages.push({ role: 'user', content: '' });
        } else if (contentParts.length === 1 && contentParts[0].type === 'text') {
          messages.push({ role: 'user', content: contentParts[0].text || '' });
        } else {
          messages.push({ role: 'user', content: contentParts });
        }
      } else if (message.role === 'assistant') {
        // Handle assistant messages with potential tool calls
        const textParts = message.content
          .filter((part): part is LanguageModelV2TextPart => part.type === 'text')
          .map(part => part.text);
        
        const toolCallParts = message.content
          .filter((part): part is LanguageModelV2ToolCallPart => part.type === 'tool-call');

        const puterMessage: PuterSDKMessage = {
          role: 'assistant',
          content: textParts.join('\n') || '',
        };

        if (toolCallParts.length > 0) {
          puterMessage.tool_calls = toolCallParts.map(tc => ({
            id: tc.toolCallId,
            type: 'function' as const,
            function: {
              name: tc.toolName,
              arguments: typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input),
            },
          }));
        }

        messages.push(puterMessage);
      } else if (message.role === 'tool') {
        // Handle tool results
        for (const part of message.content) {
          if (part.type === 'tool-result') {
            const toolResultPart = part as LanguageModelV2ToolResultPart;
            const output = toolResultPart.output;
            let contentStr: string;
            if (typeof output === 'string') {
              contentStr = output;
            } else if (Array.isArray(output)) {
              // Handle array of output parts
              contentStr = output.map(p => {
                if (p.type === 'text') return p.text;
                return JSON.stringify(p);
              }).join('\n');
            } else {
              contentStr = JSON.stringify(output);
            }
            messages.push({
              role: 'tool',
              content: contentStr,
              tool_call_id: toolResultPart.toolCallId,
            });
          }
        }
      }
    }

    return { messages, hasVision };
  }

  /**
   * Convert AI SDK tools to Puter SDK tool format.
   */
  private convertTools(tools: LanguageModelV2FunctionTool[] | undefined): PuterSDKTool[] | undefined {
    if (!tools || tools.length === 0) return undefined;

    return tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: tool.inputSchema as Record<string, unknown>,
      },
    }));
  }

  /**
   * Build options for Puter SDK chat call.
   * 
   * @param options - AI SDK call options
   * @param streaming - Whether to enable streaming
   * @param modelOverride - Optional model to use instead of this.modelId (for fallback)
   */
  private buildSDKOptions(
    options: LanguageModelV2CallOptions, 
    streaming: boolean,
    modelOverride?: string,
    hasVision?: boolean
  ): PuterSDKOptions {
    // Filter to only function tools
    const functionTools = options.tools?.filter(
      (tool): tool is LanguageModelV2FunctionTool => tool.type === 'function'
    );
    const tools = this.convertTools(functionTools);

    const sdkOptions: PuterSDKOptions = {
      model: modelOverride ?? this.modelId,
      stream: streaming,
    };

    if (hasVision) {
      sdkOptions.vision = true;
    }

    // Only add optional params if they have values
    const maxTokens = options.maxOutputTokens ?? this.settings.maxTokens;
    if (maxTokens !== undefined) sdkOptions.max_tokens = maxTokens;

    const temperature = options.temperature ?? this.settings.temperature;
    if (temperature !== undefined) sdkOptions.temperature = temperature;

    const topP = options.topP ?? this.settings.topP;
    if (topP !== undefined) sdkOptions.top_p = topP;

    const topK = options.topK ?? this.settings.topK;
    if (topK !== undefined) sdkOptions.top_k = topK;

    const stop = options.stopSequences ?? this.settings.stopSequences;
    if (stop !== undefined) sdkOptions.stop = stop;

    if (tools !== undefined) sdkOptions.tools = tools;

    return sdkOptions;
  }

  /**
   * Map Puter finish reason to AI SDK V2 format (simple string).
   */
  private mapFinishReason(reason?: string): LanguageModelV2FinishReason {
    if (!reason) return 'other';
    if (reason === 'stop' || reason === 'end_turn') return 'stop';
    if (reason === 'length' || reason === 'max_tokens') return 'length';
    if (reason === 'tool_calls' || reason === 'tool_use') return 'tool-calls';
    if (reason === 'content_filter') return 'content-filter';
    return 'other';
  }

  /**
   * Map Puter usage to AI SDK V2 format (flat structure).
   * Handles both property naming conventions from Puter.
   */
  private mapUsage(usage?: PuterUsage): LanguageModelV2Usage {
    // Puter uses different property names in streaming vs non-streaming
    const inputTokens = usage?.prompt_tokens ?? usage?.prompt;
    const outputTokens = usage?.completion_tokens ?? usage?.completion;
    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens !== undefined && outputTokens !== undefined
        ? inputTokens + outputTokens
        : undefined,
    };
  }

  /**
   * Extract text from response content (handles both string and array formats).
   */
  private extractTextContent(content: string | PuterContentBlock[] | null | undefined): string {
    if (!content) return '';
    
    if (typeof content === 'string') {
      return content;
    }
    
    if (Array.isArray(content)) {
      return content
        .filter((block): block is PuterContentBlock => block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('');
    }
    
    return '';
  }

  /**
   * Non-streaming generation using Puter SDK.
   * 
   * Execution order for rate limit handling:
   * 1. Try with current account
   * 2. If account exhausted (403), rotate to next account and retry
   * 3. If all accounts exhausted, fall back to free models
   * 
   * Set `disableFallback` in settings to skip model fallback.
   */
  async doGenerate(options: LanguageModelV2CallOptions): Promise<{
    content: Array<LanguageModelV2Content>;
    finishReason: LanguageModelV2FinishReason;
    usage: LanguageModelV2Usage;
    warnings: Array<LanguageModelV2CallWarning>;
    request?: { body?: unknown };
    response?: { body?: unknown };
  }> {
    const startTime = Date.now();
    const { messages, hasVision } = this.convertPromptToMessages(options.prompt);
    const warnings: LanguageModelV2CallWarning[] = [];

    const cacheKey = (this._modelConfig.cache?.enabled ?? false)
      ? buildCacheKey({
          model: this.modelId,
          prompt: options.prompt,
          maxOutputTokens: options.maxOutputTokens ?? this.settings.maxTokens,
          temperature: options.temperature ?? this.settings.temperature,
          topP: options.topP ?? this.settings.topP,
          topK: options.topK ?? this.settings.topK,
          stop: options.stopSequences ?? this.settings.stopSequences,
          tools: options.tools,
        })
      : null;

    if (cacheKey) {
      const cached = await this.responseCache.get(cacheKey);
      if (cached) {
        return {
          ...cached,
          warnings: [
            { type: 'other', message: 'Response served from cache' },
          ],
        };
      }
    }
    
    // Check if fallback is disabled for this request
    const useFallback = !this.settings.disableFallback;
    
    // Define the core chat operation (for a specific model)
    const executeChatForModel = async (model: string): Promise<PuterChatResponse> => {
      const puter = await this.initPuterSDK();
      const sdkOptions = this.buildSDKOptions(options, false, model, hasVision);
      return await puter.ai.chat(messages, sdkOptions) as PuterChatResponse;
    };
    
    // Wrap with account rotation: try other accounts before falling back to free models
    const executeChatWithRotation = async (model: string): Promise<PuterChatResponse> => {
      const { result, wasRotated, accountUsed } = await this.executeWithAccountRotation(
        () => executeChatForModel(model)
      );
      
      if (wasRotated && accountUsed) {
        warnings.push({
          type: 'other',
          message: `Rotated to account: ${accountUsed}`,
        });
      }
      
      return result;
    };
    
    let response: PuterChatResponse;
    let actualModelUsed = this.modelId;
    let wasFallback = false;
    
    try {
      if (useFallback) {
        // Execute with account rotation + model fallback support
        const fallbackResult = await this.fallbackManager.executeWithFallback(
          this.modelId,
          executeChatWithRotation,
          this.logger
        );
        response = fallbackResult.result;
        actualModelUsed = fallbackResult.usedModel;
        wasFallback = fallbackResult.wasFallback;
        
        if (wasFallback) {
          // Add a warning that fallback was used
          warnings.push({
            type: 'other',
            message: `Model ${this.modelId} rate limited, used fallback: ${actualModelUsed}`,
          });
        }
      } else {
        // Execute without fallback (but still with account rotation)
        const { result, wasRotated, accountUsed } = await this.executeWithAccountRotation(
          () => executeChatForModel(this.modelId)
        );
        response = result;
        
        if (wasRotated && accountUsed) {
          warnings.push({
            type: 'other',
            message: `Rotated to account: ${accountUsed}`,
          });
        }
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.metrics.recordFailure(actualModelUsed, duration, error);
      throw error;
    }

    const content: LanguageModelV2Content[] = [];

    // Extract text content (handles both string and array formats)
    const textContent = this.extractTextContent(response.message?.content);
    if (textContent) {
      content.push({
        type: 'text',
        text: textContent,
      });
    }

    // Handle tool use and reasoning from Claude-style content blocks
    if (Array.isArray(response.message?.content)) {
      for (const block of response.message.content) {
        if (block.type === 'tool_use' && block.id && block.name) {
          content.push({
            type: 'tool-call',
            toolCallId: block.id,
            toolName: block.name,
            input: typeof block.input === 'string' ? block.input : JSON.stringify(block.input || {}),
          });
        }
        if ((block.type === 'reasoning' || block.type === 'thinking') && block.text) {
          content.push({
            type: 'reasoning',
            text: block.text,
          });
        }
      }
    }

    // Add tool calls from legacy format
    if (response.message?.tool_calls) {
      for (const tc of response.message.tool_calls) {
        content.push({
          type: 'tool-call',
          toolCallId: tc.id,
          toolName: tc.function.name,
          input: tc.function.arguments,
        });
      }
    }

    const result: CachedGenerateResult & { warnings: Array<LanguageModelV2CallWarning> } = {
      content,
      finishReason: this.mapFinishReason(response.finish_reason),
      usage: this.mapUsage(response.usage),
      warnings,
      request: { body: { messages, model: actualModelUsed } },
      response: {
        body: response,
      },
    };

    if (cacheKey) {
      await this.responseCache.set(cacheKey, {
        content: result.content,
        finishReason: result.finishReason,
        usage: result.usage,
        request: result.request,
        response: result.response,
      });
    }

    const duration = Date.now() - startTime;
    await this.metrics.recordSuccess(actualModelUsed, duration, response.usage);

    return result;
  }

  /**
   * Streaming generation using Puter SDK.
   * 
   * Execution order for rate limit handling:
   * 1. Try with current account
   * 2. If account exhausted (403), rotate to next account and retry
   * 3. If all accounts exhausted, fall back to free models
   * 
   * Set `disableFallback` in settings to skip model fallback.
   */
  async doStream(options: LanguageModelV2CallOptions): Promise<{
    stream: ReadableStream<LanguageModelV2StreamPart>;
    request?: { body?: unknown };
  }> {
    const startTime = Date.now();
    const { messages, hasVision } = this.convertPromptToMessages(options.prompt);
    const warnings: LanguageModelV2CallWarning[] = [];
    const generateId = this._modelConfig.generateId;
    
    // Check if fallback is disabled for this request
    const useFallback = !this.settings.disableFallback;
    
    // Define the core stream operation (for a specific model)
    const initiateStreamForModel = async (model: string): Promise<AsyncIterable<PuterStreamChunk>> => {
      const puter = await this.initPuterSDK();
      const sdkOptions = this.buildSDKOptions(options, true, model, hasVision);
      return await puter.ai.chat(messages, sdkOptions) as AsyncIterable<PuterStreamChunk>;
    };
    
    // Wrap with account rotation: try other accounts before falling back to free models
    const initiateStreamWithRotation = async (model: string): Promise<AsyncIterable<PuterStreamChunk>> => {
      const { result, wasRotated, accountUsed } = await this.executeWithAccountRotation(
        () => initiateStreamForModel(model)
      );
      
      if (wasRotated && accountUsed) {
        warnings.push({
          type: 'other',
          message: `Rotated to account: ${accountUsed}`,
        });
      }
      
      return result;
    };
    
    let streamResponse: AsyncIterable<PuterStreamChunk>;
    let actualModelUsed = this.modelId;
    let wasFallback = false;
    
    if (useFallback) {
      // Execute with account rotation + model fallback support
      const fallbackResult = await this.fallbackManager.executeWithFallback(
        this.modelId,
        initiateStreamWithRotation,
        this.logger
      );
      streamResponse = fallbackResult.result;
      actualModelUsed = fallbackResult.usedModel;
      wasFallback = fallbackResult.wasFallback;
      
      if (wasFallback) {
        // Add a warning that fallback was used
        warnings.push({
          type: 'other',
          message: `Model ${this.modelId} rate limited, used fallback: ${actualModelUsed}`,
        });
      }
    } else {
      // Execute without fallback (but still with account rotation)
      const { result, wasRotated, accountUsed } = await this.executeWithAccountRotation(
        () => initiateStreamForModel(this.modelId)
      );
      streamResponse = result;
      
      if (wasRotated && accountUsed) {
        warnings.push({
          type: 'other',
          message: `Rotated to account: ${accountUsed}`,
        });
      }
    }

    // Create a transform stream to convert Puter chunks to AI SDK V2 format
    const self = this;
    let textId: string | null = null;
    let reasoningId: string | null = null;
    let fullText = '';
    let finalUsage: PuterUsage | undefined;
    let hasToolCalls = false;
    
    // Streaming timeout configuration (30s default, handles Puter SDK hanging on errors)
    const STREAM_FIRST_CHUNK_TIMEOUT_MS = 30000;
    const STREAM_CHUNK_TIMEOUT_MS = 60000; // Timeout between chunks

    const stream = new ReadableStream<LanguageModelV2StreamPart>({
      async start(controller) {
        // Emit stream-start
        controller.enqueue({
          type: 'stream-start',
          warnings,
        });

        try {
          // Create an async iterator with timeout protection
          const iterator = streamResponse[Symbol.asyncIterator]();
          let isFirstChunk = true;
          
          const getNextWithTimeout = async (timeoutMs: number): Promise<IteratorResult<PuterStreamChunk>> => {
            return new Promise(async (resolve, reject) => {
              const timeoutId = setTimeout(() => {
                reject(new Error(`Streaming timeout: No ${isFirstChunk ? 'initial response' : 'chunk'} received within ${timeoutMs / 1000}s`));
              }, timeoutMs);
              
              try {
                const result = await iterator.next();
                clearTimeout(timeoutId);
                resolve(result);
              } catch (error) {
                clearTimeout(timeoutId);
                reject(error);
              }
            });
          };
          
          // Iterate with timeout protection
          while (true) {
            const timeout = isFirstChunk ? STREAM_FIRST_CHUNK_TIMEOUT_MS : STREAM_CHUNK_TIMEOUT_MS;
            const result = await getNextWithTimeout(timeout);
            
            if (result.done) break;
            
            const chunk = result.value;
            isFirstChunk = false;
            // Handle reasoning content (for thinking models)
            const reasoningChunk =
              chunk.reasoning ??
              ((chunk.type === 'reasoning' || chunk.type === 'thinking') ? chunk.text : undefined);

            if (reasoningChunk) {
              if (!reasoningId) {
                reasoningId = generateId();
                controller.enqueue({
                  type: 'reasoning-start',
                  id: reasoningId,
                });
              }
              controller.enqueue({
                type: 'reasoning-delta',
                id: reasoningId,
                delta: reasoningChunk,
              });
            }
            
            // Handle text content (type === 'text' or just has .text property)
            if (chunk.type === 'text' || (chunk.text && chunk.type !== 'tool_use' && chunk.type !== 'reasoning')) {
              // Close reasoning stream when text starts
              if (reasoningId) {
                controller.enqueue({
                  type: 'reasoning-end',
                  id: reasoningId,
                });
                reasoningId = null;
              }
              
              if (!textId) {
                textId = generateId();
                controller.enqueue({
                  type: 'text-start',
                  id: textId,
                });
              }
              fullText += chunk.text;
              controller.enqueue({
                type: 'text-delta',
                id: textId,
                delta: chunk.text!,
              });
            }

            // Handle tool use (streaming tool calls from Puter)
            // Puter sends tool_use chunks with: id, name, input (already parsed)
            if (chunk.type === 'tool_use' && chunk.id && chunk.name) {
              hasToolCalls = true;
              
              // Close any open reasoning stream before tool call
              if (reasoningId) {
                controller.enqueue({
                  type: 'reasoning-end',
                  id: reasoningId,
                });
                reasoningId = null;
              }
              
              // Close any open text stream before tool call
              if (textId) {
                controller.enqueue({
                  type: 'text-end',
                  id: textId,
                });
                textId = null;
              }
              
              // Emit complete tool-call (V2 format)
              // input must be a stringified JSON
              const argsJson = typeof chunk.input === 'string' 
                ? chunk.input 
                : JSON.stringify(chunk.input || {});
              
              controller.enqueue({
                type: 'tool-call',
                toolCallId: chunk.id,
                toolName: chunk.name,
                input: argsJson,
              });
            }

            // Handle usage (usually at the end)
            if (chunk.usage) {
              finalUsage = chunk.usage;
            }
          }

          // Close reasoning stream if still open
          if (reasoningId) {
            controller.enqueue({
              type: 'reasoning-end',
              id: reasoningId,
            });
          }
          
          // Close text stream if we had one
          if (textId) {
            controller.enqueue({
              type: 'text-end',
              id: textId,
            });
          }

          // Emit finish with appropriate finish reason
          controller.enqueue({
            type: 'finish',
            usage: self.mapUsage(finalUsage),
            finishReason: self.mapFinishReason(hasToolCalls ? 'tool_calls' : 'stop'),
          });

          const duration = Date.now() - startTime;
          await self.metrics.recordSuccess(actualModelUsed, duration, finalUsage);

          controller.close();
        } catch (error) {
          // Handle streaming timeout by probing for the actual error
          const errorMsg = error instanceof Error ? error.message : String(error);
          
          if (errorMsg.includes('Streaming timeout')) {
            // Log the timeout
            self.logger?.warn?.(`[puter-auth] ${errorMsg}`);
            
            // Emit an error text to the user instead of hanging
            if (!textId) {
              textId = generateId();
              controller.enqueue({
                type: 'text-start',
                id: textId,
              });
            }
            controller.enqueue({
              type: 'text-delta',
              id: textId,
              delta: `⚠️ Streaming failed: ${errorMsg}. This may indicate a rate limit or API issue with Puter. Try again later or switch to a different model.`,
            });
            controller.enqueue({
              type: 'text-end',
              id: textId,
            });
            controller.enqueue({
              type: 'finish',
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
              finishReason: 'error',
            });
            controller.close();
          } else {
            controller.error(error);
          }
          const duration = Date.now() - startTime;
          await self.metrics.recordFailure(actualModelUsed, duration, error);
        }
      },
    });

    return {
      stream,
      request: { body: { messages, model: actualModelUsed } },
    };
  }
}
