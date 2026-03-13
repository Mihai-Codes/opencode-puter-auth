/**
 * Puter Provider Integration
 * 
 * This module provides two transformation paths:
 * 
 * 1. Google Generative Language API format (for google provider integration)
 *    - Used when Puter models are configured under provider.google
 *    - Transforms Google's format to Puter's format
 * 
 * 2. OpenAI-compatible format (for standalone puter provider)
 *    - Used when Puter is configured as a separate provider with @ai-sdk/openai-compatible
 *    - Transforms OpenAI's format to Puter's format
 * 
 * The custom fetch function intercepts requests and routes them to Puter's API.
 */

import type { PuterChatMessage, PuterChatStreamChunk, PuterConfig } from './types.js';

const PUTER_API_URL = 'https://api.puter.com';

// Puter model prefix - models starting with this are routed to Puter
const PUTER_MODEL_PREFIX = 'puter-';

// Fake Puter API endpoint that we intercept
const PUTER_LOCAL_API = 'localhost:8080';

/**
 * Check if a request is targeting the Puter provider
 */
export function isPuterRequest(input: RequestInfo | URL): boolean {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  
  // Check for localhost:8080 fake endpoint (OpenAI-compatible format)
  if (url.includes(PUTER_LOCAL_API)) {
    return true;
  }
  
  // Check for puter- prefix in Google API format
  if (url.includes(`/models/${PUTER_MODEL_PREFIX}`)) {
    return true;
  }
  
  return false;
}

/**
 * Check if the request is using OpenAI format (vs Google format)
 */
export function isOpenAIFormat(url: string): boolean {
  return url.includes('/chat/completions') || url.includes(PUTER_LOCAL_API);
}

/**
 * Extract model ID from the request URL
 */
export function extractModelFromUrl(url: string): string {
  // OpenAI format: model is in the request body, not URL
  // Google format: .../models/puter-claude-opus-4-5:generateContent
  const match = url.match(/\/models\/([^:\/]+)/);
  const modelWithPrefix = match?.[1] || 'puter-claude-opus-4-5';
  
  // Strip the puter- prefix to get the actual Puter model name
  return modelWithPrefix.startsWith(PUTER_MODEL_PREFIX) 
    ? modelWithPrefix.slice(PUTER_MODEL_PREFIX.length)
    : modelWithPrefix;
}

/**
 * Check if the request is for streaming
 */
export function isStreamingRequest(url: string): boolean {
  return url.includes('streamGenerateContent') || url.includes('alt=sse');
}

// ============================================================================
// OpenAI Format Transformations
// ============================================================================

/**
 * Transform OpenAI chat completion request to Puter format
 */
export function transformOpenAIToPuter(
  body: OpenAIChatCompletionRequest,
  authToken: string
): PuterRequestBody {
  // Strip puter- prefix from model name if present
  const model = body.model?.startsWith(PUTER_MODEL_PREFIX)
    ? body.model.slice(PUTER_MODEL_PREFIX.length)
    : body.model || 'claude-opus-4-5';

  // Transform messages
  const messages: PuterChatMessage[] = body.messages?.map(msg => {
    if (msg.role === 'tool') {
      return {
        role: 'tool' as const,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        tool_call_id: msg.tool_call_id,
      };
    }
    
    if (msg.role === 'assistant' && msg.tool_calls) {
      return {
        role: 'assistant' as const,
        content: typeof msg.content === 'string' ? msg.content : '',
        tool_calls: msg.tool_calls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        })),
      };
    }
    
    return {
      role: msg.role as 'system' | 'user' | 'assistant',
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
    };
  }) || [];

  // Transform tools
  let tools: PuterTool[] | undefined;
  if (body.tools && body.tools.length > 0) {
    tools = body.tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.function.name,
        description: tool.function.description || '',
        parameters: tool.function.parameters || { type: 'object', properties: {} },
      },
    }));
  }

  return {
    interface: 'puter-chat-completion',
    service: 'ai-chat',
    method: 'complete',
    args: {
      messages,
      model,
      stream: body.stream || false,
      max_tokens: body.max_tokens,
      temperature: body.temperature,
      tools,
    },
    auth_token: authToken,
  };
}

/**
 * Transform Puter response to OpenAI chat completion format
 */
export function transformPuterToOpenAI(puterResponse: PuterChatResponse): OpenAIChatCompletionResponse {
  const message = puterResponse.message;
  
  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'puter',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: message?.content || null,
        tool_calls: message?.tool_calls?.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        })),
      },
      finish_reason: mapFinishReason(puterResponse.finish_reason),
    }],
    usage: puterResponse.usage ? {
      prompt_tokens: puterResponse.usage.prompt_tokens,
      completion_tokens: puterResponse.usage.completion_tokens,
      total_tokens: puterResponse.usage.total_tokens,
    } : undefined,
  };
}

/**
 * Transform Puter stream chunk to OpenAI SSE format
 */
export function transformPuterStreamToOpenAI(chunk: PuterChatStreamChunk): string {
  const delta: OpenAIDelta = {};
  
  if (chunk.text) {
    delta.content = chunk.text;
  }
  
  if (chunk.reasoning) {
    // Include reasoning as a special field (some clients support this)
    delta.reasoning = chunk.reasoning;
    delta.content = (delta.content || '') + chunk.reasoning;
  }
  
  if (chunk.tool_calls && chunk.tool_calls.length > 0) {
    delta.tool_calls = chunk.tool_calls.map((tc, idx) => ({
      index: idx,
      id: tc.id,
      type: 'function' as const,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    }));
  }

  const response: OpenAIStreamChunk = {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'puter',
    choices: [{
      index: 0,
      delta,
      finish_reason: chunk.done || chunk.finish_reason ? mapFinishReason(chunk.finish_reason) : null,
    }],
  };

  return `data: ${JSON.stringify(response)}\n\n`;
}

function mapFinishReason(reason?: string): 'stop' | 'tool_calls' | 'length' | null {
  if (!reason) return null;
  if (reason === 'tool_calls') return 'tool_calls';
  if (reason === 'length') return 'length';
  return 'stop';
}

// ============================================================================
// Google Format Transformations (for backward compatibility)
// ============================================================================

/**
 * Transform Google Generative Language API content to Puter message format
 */
function transformContentToPuterMessage(content: GoogleContent): PuterChatMessage {
  const role = content.role === 'model' ? 'assistant' : content.role as 'user' | 'system' | 'assistant' | 'tool';
  
  if (Array.isArray(content.parts)) {
    const textParts = content.parts
      .filter((p): p is { text: string } => 'text' in p && typeof p.text === 'string')
      .map(p => p.text);
    
    const functionCalls = content.parts
      .filter((p): p is { functionCall: { name: string; args: unknown } } => 'functionCall' in p);
    
    const functionResponses = content.parts
      .filter((p): p is { functionResponse: { name: string; response: unknown; id?: string } } => 'functionResponse' in p);
    
    if (functionCalls.length > 0) {
      return {
        role: 'assistant',
        content: textParts.join('\n') || '',
        tool_calls: functionCalls.map((fc, idx) => ({
          id: `call_${idx}`,
          type: 'function' as const,
          function: {
            name: fc.functionCall.name,
            arguments: JSON.stringify(fc.functionCall.args),
          },
        })),
      };
    }
    
    if (functionResponses.length > 0) {
      const fr = functionResponses[0];
      return {
        role: 'tool',
        content: typeof fr.functionResponse.response === 'string' 
          ? fr.functionResponse.response 
          : JSON.stringify(fr.functionResponse.response),
        tool_call_id: fr.functionResponse.id || `call_0`,
      };
    }
    
    return {
      role,
      content: textParts.join('\n'),
    };
  }
  
  return {
    role,
    content: '',
  };
}

/**
 * Transform Google Generative Language API request body to Puter format
 */
export function transformRequestToPuter(
  body: GoogleGenerateContentRequest,
  model: string,
  streaming: boolean,
  authToken: string
): PuterRequestBody {
  const messages: PuterChatMessage[] = [];
  
  // Add system instruction if present
  if (body.systemInstruction) {
    const systemText = typeof body.systemInstruction === 'string'
      ? body.systemInstruction
      : body.systemInstruction.parts?.map(p => p.text).join('\n') || '';
    
    if (systemText) {
      messages.push({
        role: 'system',
        content: systemText,
      });
    }
  }
  
  // Transform contents
  if (body.contents) {
    for (const content of body.contents) {
      messages.push(transformContentToPuterMessage(content));
    }
  }
  
  // Transform tools
  let tools: PuterTool[] | undefined;
  if (body.tools && body.tools.length > 0) {
    tools = [];
    for (const tool of body.tools) {
      if (tool.functionDeclarations) {
        for (const fn of tool.functionDeclarations) {
          tools.push({
            type: 'function',
            function: {
              name: fn.name,
              description: fn.description || '',
              parameters: fn.parameters || { type: 'object', properties: {} },
            },
          });
        }
      }
    }
  }
  
  return {
    interface: 'puter-chat-completion',
    service: 'ai-chat',
    method: 'complete',
    args: {
      messages,
      model,
      stream: streaming,
      max_tokens: body.generationConfig?.maxOutputTokens,
      temperature: body.generationConfig?.temperature,
      tools,
    },
    auth_token: authToken,
  };
}

/**
 * Transform Puter response to Google Generative Language API format
 */
export function transformPuterResponseToGoogle(puterResponse: PuterChatResponse): GoogleGenerateContentResponse {
  const content = puterResponse.message?.content || '';
  const toolCalls = puterResponse.message?.tool_calls;
  
  const parts: GooglePart[] = [];
  
  if (content) {
    parts.push({ text: content });
  }
  
  if (toolCalls && toolCalls.length > 0) {
    for (const tc of toolCalls) {
      parts.push({
        functionCall: {
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments),
        },
      });
    }
  }
  
  let finishReason: string = 'STOP';
  if (puterResponse.finish_reason === 'tool_calls') {
    finishReason = 'TOOL_CALLS';
  } else if (puterResponse.finish_reason === 'length') {
    finishReason = 'MAX_TOKENS';
  }
  
  return {
    candidates: [{
      content: {
        role: 'model',
        parts,
      },
      finishReason,
      index: 0,
    }],
    usageMetadata: puterResponse.usage ? {
      promptTokenCount: puterResponse.usage.prompt_tokens,
      candidatesTokenCount: puterResponse.usage.completion_tokens,
      totalTokenCount: puterResponse.usage.total_tokens,
    } : undefined,
  };
}

/**
 * Transform a Puter streaming chunk to Google SSE format
 */
export function transformPuterStreamChunkToGoogle(chunk: PuterChatStreamChunk): string {
  const parts: GooglePart[] = [];
  
  if (chunk.text) {
    parts.push({ text: chunk.text });
  }
  
  if (chunk.reasoning) {
    parts.push({
      thought: true,
      text: chunk.reasoning,
    } as GooglePart);
  }
  
  if (chunk.tool_calls && chunk.tool_calls.length > 0) {
    for (const tc of chunk.tool_calls) {
      parts.push({
        functionCall: {
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments),
        },
      });
    }
  }
  
  let finishReason: string | undefined;
  if (chunk.done || chunk.finish_reason) {
    finishReason = chunk.finish_reason === 'tool_calls' ? 'TOOL_CALLS' : 'STOP';
  }
  
  const response: GoogleGenerateContentResponse = {
    candidates: [{
      content: {
        role: 'model',
        parts,
      },
      finishReason,
      index: 0,
    }],
  };
  
  return `data: ${JSON.stringify(response)}\n\n`;
}

// ============================================================================
// Request Handler
// ============================================================================

/**
 * Make a request to Puter API and return transformed response
 */
export async function makePuterRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  authToken: string,
  config: Partial<PuterConfig> = {}
): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  const useOpenAIFormat = isOpenAIFormat(url);
  
  let puterBody: PuterRequestBody;
  let streaming = false;
  
  if (useOpenAIFormat) {
    // Parse OpenAI format request
    let openaiBody: OpenAIChatCompletionRequest = {};
    if (init?.body) {
      try {
        openaiBody = JSON.parse(init.body as string);
      } catch {
        // If parsing fails, use empty body
      }
    }
    streaming = openaiBody.stream || false;
    puterBody = transformOpenAIToPuter(openaiBody, authToken);
  } else {
    // Parse Google format request
    const model = extractModelFromUrl(url);
    streaming = isStreamingRequest(url);
    
    let googleBody: GoogleGenerateContentRequest = {};
    if (init?.body) {
      try {
        googleBody = JSON.parse(init.body as string);
      } catch {
        // If parsing fails, use empty body
      }
    }
    puterBody = transformRequestToPuter(googleBody, model, streaming, authToken);
  }
  
  const apiUrl = config.api_base_url || PUTER_API_URL;
  const timeout = config.api_timeout_ms || 120000;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(`${apiUrl}/drivers/call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(puterBody),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text();
      
      if (useOpenAIFormat) {
        return new Response(JSON.stringify({
          error: {
            message: `Puter API error: ${errorText}`,
            type: response.status >= 500 ? 'server_error' : 'invalid_request_error',
            code: response.status,
          },
        }), {
          status: response.status,
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        return new Response(JSON.stringify({
          error: {
            code: response.status,
            message: `Puter API error: ${errorText}`,
            status: response.status >= 500 ? 'INTERNAL' : 'INVALID_ARGUMENT',
          },
        }), {
          status: response.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    
    if (streaming) {
      return handleStreamingResponse(response, useOpenAIFormat);
    } else {
      const puterResponse = await response.json() as { result: PuterChatResponse };
      
      if (useOpenAIFormat) {
        const openaiResponse = transformPuterToOpenAI(puterResponse.result);
        return new Response(JSON.stringify(openaiResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        const googleResponse = transformPuterResponseToGoogle(puterResponse.result);
        return new Response(JSON.stringify(googleResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
  } catch (error) {
    clearTimeout(timeoutId);
    
    const message = error instanceof Error ? error.message : 'Unknown error';
    
    if (useOpenAIFormat) {
      return new Response(JSON.stringify({
        error: {
          message: `Puter request failed: ${message}`,
          type: 'server_error',
          code: 500,
        },
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    } else {
      return new Response(JSON.stringify({
        error: {
          code: 500,
          message: `Puter request failed: ${message}`,
          status: 'INTERNAL',
        },
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
}

/**
 * Handle streaming response from Puter
 */
async function handleStreamingResponse(response: Response, useOpenAIFormat: boolean): Promise<Response> {
  if (!response.body) {
    return new Response('No response body', { status: 500 });
  }
  
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  
  let buffer = '';
  
  const transformStream = new TransformStream({
    async transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        try {
          const puterChunk = JSON.parse(line) as PuterChatStreamChunk;
          const transformedChunk = useOpenAIFormat
            ? transformPuterStreamToOpenAI(puterChunk)
            : transformPuterStreamChunkToGoogle(puterChunk);
          controller.enqueue(encoder.encode(transformedChunk));
        } catch {
          // Skip malformed lines
        }
      }
    },
    flush(controller) {
      if (buffer.trim()) {
        try {
          const puterChunk = JSON.parse(buffer) as PuterChatStreamChunk;
          const transformedChunk = useOpenAIFormat
            ? transformPuterStreamToOpenAI(puterChunk)
            : transformPuterStreamChunkToGoogle(puterChunk);
          controller.enqueue(encoder.encode(transformedChunk));
        } catch {
          // Ignore
        }
      }
      
      // Send [DONE] for OpenAI format
      if (useOpenAIFormat) {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      }
    },
  });
  
  const transformedBody = response.body.pipeThrough(transformStream);
  
  return new Response(transformedBody, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

// ============================================================================
// Custom Fetch Factory
// ============================================================================

/**
 * Create a custom fetch function for Puter provider integration.
 * 
 * This function intercepts requests to Puter endpoints and routes them
 * through Puter's API with proper request/response transformation.
 * 
 * Supports both OpenAI-compatible format (for standalone puter provider)
 * and Google Generative Language API format (for google provider integration).
 * 
 * @param authToken - The Puter authentication token
 * @param config - Optional Puter configuration
 * @returns A fetch function that can be used by OpenCode's AI SDK
 */
export function createPuterFetch(
  authToken: string,
  config: Partial<PuterConfig> = {}
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Only intercept Puter requests, pass through everything else
    if (!isPuterRequest(input)) {
      return fetch(input, init);
    }
    
    // Route through Puter API with transformation
    return makePuterRequest(input, init, authToken, config);
  };
}

// ============================================================================
// Type Definitions
// ============================================================================

// OpenAI Types
interface OpenAIChatCompletionRequest {
  model?: string;
  messages?: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_call_id?: string;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: {
        name: string;
        arguments: string;
      };
    }>;
  }>;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
    };
  }>;
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

interface OpenAIChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: 'stop' | 'tool_calls' | 'length' | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIDelta {
  role?: 'assistant';
  content?: string;
  reasoning?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: 'function';
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

interface OpenAIStreamChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: OpenAIDelta;
    finish_reason: 'stop' | 'tool_calls' | 'length' | null;
  }>;
}

// Google Types
interface GooglePart {
  text?: string;
  thought?: boolean;
  functionCall?: {
    name: string;
    args: unknown;
  };
  functionResponse?: {
    name: string;
    response: unknown;
    id?: string;
  };
}

interface GoogleContent {
  role: string;
  parts: GooglePart[];
}

interface GoogleGenerateContentRequest {
  contents?: GoogleContent[];
  systemInstruction?: string | { parts: { text: string }[] };
  generationConfig?: {
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
    topK?: number;
    thinkingConfig?: {
      thinkingBudget?: number;
    };
  };
  tools?: Array<{
    functionDeclarations?: Array<{
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
    }>;
  }>;
}

interface GoogleGenerateContentResponse {
  candidates: Array<{
    content: {
      role: string;
      parts: GooglePart[];
    };
    finishReason?: string;
    index: number;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

// Puter Types
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
    messages: PuterChatMessage[];
    model: string;
    stream: boolean;
    max_tokens?: number;
    temperature?: number;
    tools?: PuterTool[];
  };
  auth_token: string;
}

interface PuterChatResponse {
  message?: {
    role: string;
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: {
        name: string;
        arguments: string;
      };
    }>;
  };
  finish_reason?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
