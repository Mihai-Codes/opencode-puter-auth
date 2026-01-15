/**
 * Puter Chat Language Model
 * 
 * Implements the AI SDK LanguageModelV3 interface for Puter.com's AI API.
 * This enables Puter to work as a proper AI SDK provider in OpenCode.
 */

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
  LanguageModelV3StreamPart,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3Usage,
  LanguageModelV3Message,
  LanguageModelV3TextPart,
  LanguageModelV3ToolCallPart,
  LanguageModelV3ToolResultPart,
  LanguageModelV3FunctionTool,
  SharedV3Warning,
} from '@ai-sdk/provider';
import type { PuterChatSettings, PuterChatConfig } from './puter-chat-settings.js';

// Type for Puter usage in response
interface PuterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

// Puter API types
interface PuterMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: PuterToolCall[];
}

interface PuterToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface PuterTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface PuterRequestBody {
  interface: string;
  service: string;
  method: string;
  args: {
    messages: PuterMessage[];
    model: string;
    stream: boolean;
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    stop?: string[];
    tools?: PuterTool[];
  };
  auth_token: string;
}

interface PuterResponse {
  success?: boolean;
  result?: {
    message?: {
      role: string;
      content: string | null;
      tool_calls?: PuterToolCall[];
    };
    finish_reason?: string;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
  error?: {
    message: string;
    code?: string;
  };
}

interface PuterStreamChunk {
  text?: string;
  reasoning?: string;
  tool_calls?: PuterToolCall[];
  done?: boolean;
  finish_reason?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Puter Chat Language Model implementing LanguageModelV3.
 */
export class PuterChatLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3' as const;
  readonly provider: string;
  readonly modelId: string;
  
  private readonly settings: PuterChatSettings;
  private readonly config: PuterChatConfig;

  constructor(
    modelId: string,
    settings: PuterChatSettings,
    config: PuterChatConfig
  ) {
    this.modelId = modelId;
    this.settings = settings;
    this.config = config;
    this.provider = config.provider;
  }

  /**
   * Supported URL patterns for native file handling.
   * Puter doesn't natively handle URLs, so we return an empty map.
   */
  get supportedUrls(): Record<string, RegExp[]> {
    return {};
  }

  /**
   * Convert AI SDK prompt to Puter message format.
   */
  private convertPromptToMessages(prompt: LanguageModelV3Message[]): PuterMessage[] {
    const messages: PuterMessage[] = [];

    for (const message of prompt) {
      if (message.role === 'system') {
        messages.push({
          role: 'system',
          content: message.content,
        });
      } else if (message.role === 'user') {
        // Extract text from user message parts
        const textParts = message.content
          .filter((part): part is LanguageModelV3TextPart => part.type === 'text')
          .map(part => part.text);
        
        messages.push({
          role: 'user',
          content: textParts.join('\n'),
        });
      } else if (message.role === 'assistant') {
        // Handle assistant messages with potential tool calls
        const textParts = message.content
          .filter((part): part is LanguageModelV3TextPart => part.type === 'text')
          .map(part => part.text);
        
        const toolCallParts = message.content
          .filter((part): part is LanguageModelV3ToolCallPart => part.type === 'tool-call');

        const puterMessage: PuterMessage = {
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
            const toolResultPart = part as LanguageModelV3ToolResultPart;
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
   * Convert AI SDK tools to Puter tool format.
   */
  private convertTools(tools: LanguageModelV3FunctionTool[] | undefined): PuterTool[] | undefined {
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
   * Build the request body for Puter API.
   */
  private async buildRequestBody(options: LanguageModelV3CallOptions, streaming: boolean): Promise<PuterRequestBody> {
    const messages = this.convertPromptToMessages(options.prompt);
    
    // Filter to only function tools
    const functionTools = options.tools?.filter(
      (tool): tool is LanguageModelV3FunctionTool => tool.type === 'function'
    );
    const tools = this.convertTools(functionTools);

    return {
      interface: 'puter-chat-completion',
      service: 'ai-chat',
      method: 'complete',
      args: {
        messages,
        model: this.modelId,
        stream: streaming,
        max_tokens: options.maxOutputTokens ?? this.settings.maxTokens,
        temperature: options.temperature ?? this.settings.temperature,
        top_p: options.topP ?? this.settings.topP,
        top_k: options.topK ?? this.settings.topK,
        stop: options.stopSequences ?? this.settings.stopSequences,
        tools,
      },
      auth_token: (await this.config.headers())['Authorization']?.replace('Bearer ', '') || '',
    };
  }

  /**
   * Map Puter finish reason to AI SDK format.
   */
  private mapFinishReason(reason?: string): LanguageModelV3FinishReason {
    const unified = (() => {
      if (!reason) return 'other';
      if (reason === 'stop' || reason === 'end_turn') return 'stop';
      if (reason === 'length' || reason === 'max_tokens') return 'length';
      if (reason === 'tool_calls' || reason === 'tool_use') return 'tool-calls';
      if (reason === 'content_filter') return 'content-filter';
      return 'other';
    })();

    return {
      unified,
      raw: reason,
    };
  }

  /**
   * Map Puter usage to AI SDK format.
   */
  private mapUsage(usage?: PuterUsage): LanguageModelV3Usage {
    return {
      inputTokens: {
        total: usage?.prompt_tokens,
        noCache: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: usage?.completion_tokens,
        text: undefined,
        reasoning: undefined,
      },
    };
  }

  /**
   * Non-streaming generation.
   */
  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const requestBody = await this.buildRequestBody(options, false);
    const warnings: SharedV3Warning[] = [];

    const response = await this.config.fetch(`${this.config.baseURL}/drivers/call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await this.config.headers()),
      },
      body: JSON.stringify(requestBody),
      signal: options.abortSignal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Puter API error (${response.status}): ${errorText}`);
    }

    const puterResponse = await response.json() as PuterResponse;

    if (puterResponse.error) {
      throw new Error(`Puter API error: ${puterResponse.error.message}`);
    }

    const result = puterResponse.result;
    const content: LanguageModelV3Content[] = [];

    // Add text content
    if (result?.message?.content) {
      content.push({
        type: 'text',
        text: result.message.content,
      });
    }

    // Add tool calls
    if (result?.message?.tool_calls) {
      for (const tc of result.message.tool_calls) {
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
      finishReason: this.mapFinishReason(result?.finish_reason),
      usage: this.mapUsage(result?.usage),
      warnings,
      request: { body: requestBody },
      response: {
        body: puterResponse,
      },
    };
  }

  /**
   * Streaming generation.
   */
  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const requestBody = await this.buildRequestBody(options, true);
    const warnings: SharedV3Warning[] = [];
    const generateId = this.config.generateId;

    const response = await this.config.fetch(`${this.config.baseURL}/drivers/call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await this.config.headers()),
      },
      body: JSON.stringify(requestBody),
      signal: options.abortSignal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Puter API error (${response.status}): ${errorText}`);
    }

    if (!response.body) {
      throw new Error('No response body for streaming');
    }

    const self = this;
    let textId: string | null = null;
    let reasoningId: string | null = null;
    const toolCallIds: Map<string, string> = new Map();
    let buffer = '';

    const transformStream = new TransformStream<Uint8Array, LanguageModelV3StreamPart>({
      start(controller) {
        // Emit stream-start
        controller.enqueue({
          type: 'stream-start',
          warnings,
        });
      },

      async transform(chunk, controller) {
        const decoder = new TextDecoder();
        buffer += decoder.decode(chunk, { stream: true });
        
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const puterChunk = JSON.parse(line) as PuterStreamChunk;

            // Handle text content
            if (puterChunk.text) {
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
                delta: puterChunk.text,
              });
            }

            // Handle reasoning content
            if (puterChunk.reasoning) {
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
                delta: puterChunk.reasoning,
              });
            }

            // Handle tool calls
            if (puterChunk.tool_calls) {
              for (const tc of puterChunk.tool_calls) {
                if (!toolCallIds.has(tc.id)) {
                  const streamId = generateId();
                  toolCallIds.set(tc.id, streamId);
                  controller.enqueue({
                    type: 'tool-input-start',
                    id: streamId,
                    toolName: tc.function.name,
                  });
                }
                
                const streamId = toolCallIds.get(tc.id)!;
                controller.enqueue({
                  type: 'tool-input-delta',
                  id: streamId,
                  delta: tc.function.arguments,
                });
              }
            }

            // Handle completion
            if (puterChunk.done || puterChunk.finish_reason) {
              // Close text stream
              if (textId) {
                controller.enqueue({
                  type: 'text-end',
                  id: textId,
                });
              }

              // Close reasoning stream
              if (reasoningId) {
                controller.enqueue({
                  type: 'reasoning-end',
                  id: reasoningId,
                });
              }

              // Close tool call streams and emit tool-call events
              for (const [, streamId] of toolCallIds) {
                controller.enqueue({
                  type: 'tool-input-end',
                  id: streamId,
                });
              }

              // Emit finish
              controller.enqueue({
                type: 'finish',
                usage: self.mapUsage(puterChunk.usage),
                finishReason: self.mapFinishReason(puterChunk.finish_reason),
              });
            }
          } catch {
            // Skip malformed lines
          }
        }
      },

      flush(controller) {
        // Process any remaining buffer
        if (buffer.trim()) {
          try {
            const puterChunk = JSON.parse(buffer) as PuterStreamChunk;
            
            if (puterChunk.done || puterChunk.finish_reason) {
              if (textId) {
                controller.enqueue({
                  type: 'text-end',
                  id: textId,
                });
              }
              
              controller.enqueue({
                type: 'finish',
                usage: self.mapUsage(puterChunk.usage),
                finishReason: self.mapFinishReason(puterChunk.finish_reason),
              });
            }
          } catch {
            // Ignore
          }
        }
      },
    });

    const stream = response.body.pipeThrough(transformStream);

    return {
      stream,
      request: { body: requestBody },
    };
  }
}
