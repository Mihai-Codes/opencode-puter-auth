import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let activeAccount: { username: string; authToken: string } | null = {
  username: 'tester',
  authToken: 'token-123',
};

let modelsData = [
  { id: 'claude-sonnet-4-5', provider: 'anthropic' },
  { id: 'gpt-4o', provider: 'openai' },
];

let chatResponseData = {
  message: {
    role: 'assistant' as const,
    content: 'Hello from Puter',
    tool_calls: undefined,
  },
  finish_reason: 'stop' as const,
  usage: {
    prompt_tokens: 5,
    completion_tokens: 7,
    total_tokens: 12,
  },
};

let streamChunksData: Array<Record<string, unknown>> = [
  { text: 'Hello ' },
  { text: 'stream', finish_reason: 'stop' },
];

let lastChatMessages: unknown = null;

vi.mock('../src/auth.js', () => ({
  createPuterAuthManager: () => ({
    init: async () => {},
    getActiveAccount: () => activeAccount,
  }),
}));

vi.mock('../src/client.js', () => ({
  PuterClient: class {
    async listModels() {
      return modelsData;
    }

    async chat(messages: unknown) {
      lastChatMessages = messages;
      return chatResponseData;
    }

    async *chatStream(messages: unknown) {
      lastChatMessages = messages;
      for (const chunk of streamChunksData) {
        yield chunk;
      }
    }
  },
}));

describe('OpenAI Proxy', () => {
  let server: { close: () => Promise<void>; url: string } | null = null;

  beforeEach(() => {
    activeAccount = { username: 'tester', authToken: 'token-123' };
    lastChatMessages = null;
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it('serves health endpoint', async () => {
    const { startOpenAIProxy } = await import('../src/openai-proxy.js');
    server = await startOpenAIProxy({ port: 0 });

    const response = await fetch(`${server.url}/health`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe('ok');
  });

  it('enforces api key when configured', async () => {
    const { startOpenAIProxy } = await import('../src/openai-proxy.js');
    server = await startOpenAIProxy({ port: 0, apiKey: 'secret-key' });

    const unauthorized = await fetch(`${server.url}/v1/models`);
    expect(unauthorized.status).toBe(401);

    const authorized = await fetch(`${server.url}/v1/models`, {
      headers: {
        Authorization: 'Bearer secret-key',
      },
    });
    expect(authorized.status).toBe(200);
  });

  it('returns OpenAI model list shape', async () => {
    const { startOpenAIProxy } = await import('../src/openai-proxy.js');
    server = await startOpenAIProxy({ port: 0 });

    const response = await fetch(`${server.url}/v1/models`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.object).toBe('list');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data[0].id).toBe('claude-sonnet-4-5');
  });

  it('maps chat request and response in non-stream mode', async () => {
    const { startOpenAIProxy } = await import('../src/openai-proxy.js');
    server = await startOpenAIProxy({ port: 0 });

    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this image.' },
              { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
            ],
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.object).toBe('chat.completion');
    expect(body.choices[0].message.content).toBe('Hello from Puter');
    expect(body.usage.total_tokens).toBe(12);
    expect(lastChatMessages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image.' },
          { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
        ],
      },
    ]);
  });

  it('streams OpenAI-compatible SSE with DONE terminator', async () => {
    const { startOpenAIProxy } = await import('../src/openai-proxy.js');
    server = await startOpenAIProxy({ port: 0 });

    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        stream: true,
        messages: [{ role: 'user', content: 'Stream please' }],
      }),
    });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('chat.completion.chunk');
    expect(text).toContain('data: [DONE]');
    expect(text).toContain('Hello ');
    expect(text).toContain('stream');
  });

  it('returns auth error when no Puter account exists', async () => {
    activeAccount = null;
    const { startOpenAIProxy } = await import('../src/openai-proxy.js');
    server = await startOpenAIProxy({ port: 0 });

    const response = await fetch(`${server.url}/v1/models`);
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error.type).toBe('authentication_error');
  });
});
