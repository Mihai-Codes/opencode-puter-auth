import http from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createPuterAuthManager } from './auth.js';
import { PuterClient } from './client.js';
import type { PuterChatMessage, PuterContentPart, PuterToolCall } from './types.js';

const CONFIG_DIR = join(homedir(), '.config', 'opencode');
const DEFAULT_PORT = 11434;

interface OpenAIProxyOptions {
  port?: number;
  host?: string;
  apiKey?: string;
}

export interface OpenAIProxyServer {
  url: string;
  close: () => Promise<void>;
}

interface OpenAIChatRequest {
  model?: string;
  messages?: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: unknown;
    tool_call_id?: string;
  }>;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function getBearerToken(req: http.IncomingMessage): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function getRequestApiKey(req: http.IncomingMessage): string | null {
  const bearer = getBearerToken(req);
  if (bearer) return bearer;

  const fromHeader = req.headers['x-api-key'];
  if (typeof fromHeader === 'string') return fromHeader;
  if (Array.isArray(fromHeader) && fromHeader[0]) return fromHeader[0];
  return null;
}

function toOpenAIError(message: string, type = 'invalid_request_error', code?: string) {
  return {
    error: {
      message,
      type,
      code,
    },
  };
}

function toPuterContentPart(part: unknown): PuterContentPart | null {
  if (!part || typeof part !== 'object') return null;

  const record = part as Record<string, unknown>;
  const type = record.type;

  if (type === 'text' || type === 'input_text') {
    const text = record.text;
    if (typeof text === 'string') {
      return { type: 'text', text };
    }
    return null;
  }

  if (type === 'image_url') {
    const imageUrl = record.image_url;
    if (imageUrl && typeof imageUrl === 'object' && typeof (imageUrl as Record<string, unknown>).url === 'string') {
      return {
        type: 'image_url',
        image_url: { url: (imageUrl as Record<string, unknown>).url as string },
      };
    }
    return null;
  }

  if (type === 'input_image') {
    const imageUrl = record.image_url;
    if (typeof imageUrl === 'string') {
      return {
        type: 'image_url',
        image_url: { url: imageUrl },
      };
    }
    if (imageUrl && typeof imageUrl === 'object' && typeof (imageUrl as Record<string, unknown>).url === 'string') {
      return {
        type: 'image_url',
        image_url: { url: (imageUrl as Record<string, unknown>).url as string },
      };
    }
    return null;
  }

  if (type === 'file') {
    const puterPath = record.puter_path;
    if (typeof puterPath === 'string') {
      return { type: 'file', puter_path: puterPath };
    }
    return null;
  }

  return null;
}

function toPuterMessage(message: NonNullable<OpenAIChatRequest['messages']>[number]): PuterChatMessage {
  const rawContent = message.content;
  let content: string | PuterContentPart[] = '';

  if (typeof rawContent === 'string') {
    content = rawContent;
  } else if (Array.isArray(rawContent)) {
    const parts = rawContent
      .map(toPuterContentPart)
      .filter((part): part is PuterContentPart => part !== null);
    content = parts.length > 0 ? parts : '';
  }

  return {
    role: message.role,
    content,
    tool_call_id: message.tool_call_id,
  };
}

function normalizeAssistantContent(content: unknown): string | null {
  if (typeof content === 'string' || content === null) {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string') {
          return (part as Record<string, unknown>).text as string;
        }
        return '';
      })
      .join('');
    return text || null;
  }

  return String(content);
}

function mapToolCalls(toolCalls: PuterToolCall[] | undefined) {
  if (!toolCalls || toolCalls.length === 0) return undefined;
  return toolCalls.map((call) => ({
    id: call.id,
    type: call.type,
    function: {
      name: call.function.name,
      arguments: call.function.arguments,
    },
  }));
}

async function getClient(): Promise<{ client: PuterClient; username: string } | null> {
  const authManager = createPuterAuthManager(CONFIG_DIR);
  await authManager.init();

  const account = authManager.getActiveAccount();
  if (!account) return null;

  return {
    client: new PuterClient(account.authToken),
    username: account.username,
  };
}

async function readJsonBody<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body) as T);
      } catch {
        reject(new Error('Invalid JSON request body'));
      }
    });
    req.on('error', reject);
  });
}

function writeSse(res: http.ServerResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function startOpenAIProxy(options: OpenAIProxyOptions = {}): Promise<OpenAIProxyServer> {
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? '127.0.0.1';
  const requiredApiKey = options.apiKey || process.env.PUTER_OPENAI_PROXY_API_KEY;

  const server = http.createServer(async (req, res) => {
    try {
      const method = req.method ?? 'GET';
      const requestPath = new URL(req.url ?? '/', `http://${host}:${port}`).pathname;

      if (requiredApiKey) {
        const providedApiKey = getRequestApiKey(req);
        if (providedApiKey !== requiredApiKey) {
          json(
            res,
            401,
            toOpenAIError(
              'Invalid API key for local Puter proxy. Provide Authorization: Bearer <key> or x-api-key header.',
              'authentication_error',
              'invalid_api_key'
            )
          );
          return;
        }
      }

      if (method === 'GET' && requestPath === '/health') {
        json(res, 200, { status: 'ok', service: 'puter-openai-proxy' });
        return;
      }

      if (method === 'GET' && requestPath === '/v1/models') {
        const puter = await getClient();
        if (!puter) {
          json(res, 401, toOpenAIError('Not authenticated with Puter. Run `puter-auth login` first.', 'authentication_error', 'unauthorized'));
          return;
        }

        const models = await puter.client.listModels();
        json(res, 200, {
          object: 'list',
          data: models.map((model) => ({
            id: model.id,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: model.provider || 'puter',
          })),
        });
        return;
      }

      if (method === 'POST' && requestPath === '/v1/chat/completions') {
        const puter = await getClient();
        if (!puter) {
          json(res, 401, toOpenAIError('Not authenticated with Puter. Run `puter-auth login` first.', 'authentication_error', 'unauthorized'));
          return;
        }

        const body = await readJsonBody<OpenAIChatRequest>(req);
        const model = body.model || 'gpt-5-nano';

        if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
          json(res, 400, toOpenAIError('`messages` must be a non-empty array'));
          return;
        }

        const messages = body.messages.map(toPuterMessage);
        const created = Math.floor(Date.now() / 1000);
        const id = `chatcmpl-${Date.now().toString(36)}`;

        if (body.stream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
          });

          writeSse(res, {
            id,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [
              {
                index: 0,
                delta: { role: 'assistant' },
                finish_reason: null,
              },
            ],
          });

          let finalFinishReason: string | null = null;
          for await (const chunk of puter.client.chatStream(messages, {
            model,
            temperature: body.temperature,
            max_tokens: body.max_tokens,
          })) {
            if (chunk.text || chunk.reasoning) {
              writeSse(res, {
                id,
                object: 'chat.completion.chunk',
                created,
                model,
                choices: [
                  {
                    index: 0,
                    delta: {
                      content: `${chunk.text || ''}${chunk.reasoning || ''}`,
                    },
                    finish_reason: null,
                  },
                ],
              });
            }

            if (chunk.tool_calls && chunk.tool_calls.length > 0) {
              writeSse(res, {
                id,
                object: 'chat.completion.chunk',
                created,
                model,
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: mapToolCalls(chunk.tool_calls),
                    },
                    finish_reason: null,
                  },
                ],
              });
            }

            if (chunk.finish_reason) {
              finalFinishReason = chunk.finish_reason;
            }
          }

          writeSse(res, {
            id,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: finalFinishReason || 'stop',
              },
            ],
          });
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        const response = await puter.client.chat(messages, {
          model,
          temperature: body.temperature,
          max_tokens: body.max_tokens,
        });

        json(res, 200, {
          id,
          object: 'chat.completion',
          created,
          model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: normalizeAssistantContent(response.message.content),
                tool_calls: mapToolCalls(response.message.tool_calls),
              },
              finish_reason: response.finish_reason || 'stop',
            },
          ],
          usage: response.usage
            ? {
                prompt_tokens: response.usage.prompt_tokens,
                completion_tokens: response.usage.completion_tokens,
                total_tokens: response.usage.total_tokens,
              }
            : undefined,
        });
        return;
      }

      json(res, 404, toOpenAIError('Not found', 'invalid_request_error', 'not_found'));
    } catch (error) {
      json(
        res,
        500,
        toOpenAIError(
          error instanceof Error ? error.message : 'Internal server error',
          'server_error',
          'internal_error'
        )
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;

  console.log(`\n🟣 Puter OpenAI proxy running at http://${host}:${actualPort}`);
  console.log('   Endpoints: /v1/models, /v1/chat/completions, /health');
  if (requiredApiKey) {
    console.log('   API key protection: enabled');
  }
  console.log('   Authenticate first with: puter-auth login\n');

  return {
    url: `http://${host}:${actualPort}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
