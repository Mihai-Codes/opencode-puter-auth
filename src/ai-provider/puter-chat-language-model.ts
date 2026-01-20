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
  LanguageModelV2ToolCallPart,
  LanguageModelV2ToolResultPart,
  LanguageModelV2FunctionTool,
  LanguageModelV2CallWarning,
} from '@ai-sdk/provider';
import type { PuterChatSettings, PuterChatConfig } from './puter-chat-settings.js';
import { 
  getGlobalFallbackManager, 
  type FallbackManager,
} from '../fallback.js';
import { createLogger, type Logger } from '../logger.js';

// Type definitions for Puter SDK responses
interface PuterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cached_tokens?: number;
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
  type: 'text' | 'tool_use';
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
}

// Puter SDK message format
interface PuterSDKMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | PuterSDKContentPart[];
  tool_call_id?: string;
  tool_calls?: PuterToolCall[];
}

interface PuterSDKContentPart {
  type: 'text' | 'tool_result';
  text?: string;
  tool_use_id?: string;
  content?: string;
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
  private readonly logger: Logger;

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
    this.logger = createLogger({ debug: false }); // Will be quiet unless debug enabled
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
  private convertPromptToMessages(prompt: LanguageModelV2Message[]): PuterSDKMessage[] {
    const messages: PuterSDKMessage[] = [];

    for (const message of prompt) {
      if (message.role === 'system') {
        messages.push({
          role: 'system',
          content: message.content,
        });
      } else if (message.role === 'user') {
        // Extract text from user message parts
        const textParts = message.content
          .filter((part): part is LanguageModelV2TextPart => part.type === 'text')
          .map(part => part.text);
        
        messages.push({
          role: 'user',
          content: textParts.join('\n'),
        });
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

    return messages;
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
    modelOverride?: string
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
   */
  private mapUsage(usage?: PuterUsage): LanguageModelV2Usage {
    const inputTokens = usage?.prompt_tokens;
    const outputTokens = usage?.completion_tokens;
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
   * Automatically falls back to alternative models when rate limits are hit,
   * unless `disableFallback` is set in settings.
   */
  async doGenerate(options: LanguageModelV2CallOptions): Promise<{
    content: Array<LanguageModelV2Content>;
    finishReason: LanguageModelV2FinishReason;
    usage: LanguageModelV2Usage;
    warnings: Array<LanguageModelV2CallWarning>;
    request?: { body?: unknown };
    response?: { body?: unknown };
  }> {
    const puter = await this.initPuterSDK();
    const messages = this.convertPromptToMessages(options.prompt);
    const warnings: LanguageModelV2CallWarning[] = [];
    
    // Check if fallback is disabled for this request
    const useFallback = !this.settings.disableFallback;
    
    // Define the operation that will be executed (possibly with fallback)
    const executeChat = async (model: string): Promise<PuterChatResponse> => {
      const sdkOptions = this.buildSDKOptions(options, false, model);
      return await puter.ai.chat(messages, sdkOptions) as PuterChatResponse;
    };
    
    let response: PuterChatResponse;
    let actualModelUsed = this.modelId;
    let wasFallback = false;
    
    if (useFallback) {
      // Execute with fallback support
      const fallbackResult = await this.fallbackManager.executeWithFallback(
        this.modelId,
        executeChat,
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
      // Execute without fallback
      const sdkOptions = this.buildSDKOptions(options, false);
      response = await puter.ai.chat(messages, sdkOptions) as PuterChatResponse;
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

    // Handle tool use from Claude-style content blocks
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

    return {
      content,
      finishReason: this.mapFinishReason(response.finish_reason),
      usage: this.mapUsage(response.usage),
      warnings,
      request: { body: { messages, model: actualModelUsed } },
      response: {
        body: response,
      },
    };
  }

  /**
   * Streaming generation using Puter SDK.
   * 
   * Automatically falls back to alternative models when rate limits are hit,
   * unless `disableFallback` is set in settings.
   */
  async doStream(options: LanguageModelV2CallOptions): Promise<{
    stream: ReadableStream<LanguageModelV2StreamPart>;
    request?: { body?: unknown };
  }> {
    const puter = await this.initPuterSDK();
    const messages = this.convertPromptToMessages(options.prompt);
    const warnings: LanguageModelV2CallWarning[] = [];
    const generateId = this._modelConfig.generateId;
    
    // Check if fallback is disabled for this request
    const useFallback = !this.settings.disableFallback;
    
    // Define the operation that initiates the stream
    const initiateStream = async (model: string): Promise<AsyncIterable<PuterStreamChunk>> => {
      const sdkOptions = this.buildSDKOptions(options, true, model);
      return await puter.ai.chat(messages, sdkOptions) as AsyncIterable<PuterStreamChunk>;
    };
    
    let streamResponse: AsyncIterable<PuterStreamChunk>;
    let actualModelUsed = this.modelId;
    
    if (useFallback) {
      // Execute stream initiation with fallback support
      const fallbackResult = await this.fallbackManager.executeWithFallback(
        this.modelId,
        initiateStream,
        this.logger
      );
      streamResponse = fallbackResult.result;
      actualModelUsed = fallbackResult.usedModel;
      
      if (fallbackResult.wasFallback) {
        // Add a warning that fallback was used
        warnings.push({
          type: 'other',
          message: `Model ${this.modelId} rate limited, used fallback: ${actualModelUsed}`,
        });
      }
    } else {
      // Execute without fallback
      const sdkOptions = this.buildSDKOptions(options, true);
      streamResponse = await puter.ai.chat(messages, sdkOptions) as AsyncIterable<PuterStreamChunk>;
    }

    // Create a transform stream to convert Puter chunks to AI SDK V2 format
    const self = this;
    let textId: string | null = null;
    let fullText = '';
    let finalUsage: PuterUsage | undefined;

    const stream = new ReadableStream<LanguageModelV2StreamPart>({
      async start(controller) {
        // Emit stream-start
        controller.enqueue({
          type: 'stream-start',
          warnings,
        });

        try {
          for await (const chunk of streamResponse) {
            // Handle text content
            if (chunk.text) {
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
                delta: chunk.text,
              });
            }

            // Handle usage (usually at the end)
            if (chunk.usage) {
              finalUsage = chunk.usage;
            }
          }

          // Close text stream if we had one
          if (textId) {
            controller.enqueue({
              type: 'text-end',
              id: textId,
            });
          }

          // Emit finish
          controller.enqueue({
            type: 'finish',
            usage: self.mapUsage(finalUsage),
            finishReason: self.mapFinishReason('stop'),
          });

          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return {
      stream,
      request: { body: { messages, model: actualModelUsed } },
    };
  }
}
