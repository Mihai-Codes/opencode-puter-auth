/**
 * Integration tests for Puter API Client
 *
 * Uses MSW (Mock Service Worker) to mock the Puter API endpoints.
 * These tests verify the full request/response cycle without hitting real APIs.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse, delay } from 'msw';
import { PuterClient } from '../../src/client.js';
import type { PuterChatStreamChunk } from '../../src/types.js';

const MOCK_API_URL = 'https://api.puter.com';
const MOCK_AUTH_TOKEN = 'test-auth-token-12345';

/**
 * Create a mock streaming response in the format Puter uses
 * Each chunk is a JSON object on a new line
 */
function createMockStreamResponse(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        const streamChunk: PuterChatStreamChunk = {
          text: chunk,
          done: false,
        };
        controller.enqueue(encoder.encode(JSON.stringify(streamChunk) + '\n'));
        await delay(10); // Small delay to simulate real streaming
      }

      // Final done chunk
      const doneChunk: PuterChatStreamChunk = {
        done: true,
        finish_reason: 'stop',
      };
      controller.enqueue(encoder.encode(JSON.stringify(doneChunk) + '\n'));
      controller.close();
    },
  });
}

// Define API handlers
const handlers = [
  // Chat completion (non-streaming)
  http.post(`${MOCK_API_URL}/drivers/call`, async ({ request }) => {
    const body = (await request.json()) as {
      interface: string;
      method: string;
      args: { stream?: boolean; model?: string; messages?: Array<{ role: string; content: string }> };
      auth_token: string;
    };

    // Check auth
    if (body.auth_token === 'expired-token') {
      return new HttpResponse(JSON.stringify({ error: 'Token expired' }), {
        status: 401,
      });
    }

    if (body.auth_token === 'rate-limited-token') {
      return new HttpResponse(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: 429,
      });
    }

    // Check interface
    if (body.interface !== 'puter-chat-completion') {
      return new HttpResponse(JSON.stringify({ error: 'Unknown interface' }), {
        status: 400,
      });
    }

    // Handle streaming request
    if (body.args?.stream === true) {
      const streamResponse = createMockStreamResponse([
        'Hello',
        ' from',
        ' Claude',
        ' Opus',
        '!',
      ]);

      return new HttpResponse(streamResponse, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    // Non-streaming response
    const model = body.args?.model || 'gpt-5-nano';
    const userMessage = body.args?.messages?.[0]?.content || '';

    return HttpResponse.json({
      success: true,
      result: {
        message: {
          role: 'assistant',
          content: `Mock response from ${model}: ${userMessage.slice(0, 20)}...`,
        },
        finish_reason: 'stop',
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      },
    });
  }),

  // List models endpoint
  http.get(`${MOCK_API_URL}/puterai/chat/models/details`, ({ request }) => {
    const authHeader = request.headers.get('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new HttpResponse(null, { status: 401 });
    }

    return HttpResponse.json({
      models: [
        {
          id: 'claude-opus-4-5',
          name: 'Claude Opus 4.5',
          provider: 'anthropic',
          context_window: 200000,
          supports_streaming: true,
        },
        {
          id: 'gpt-5-nano',
          name: 'GPT-5 Nano',
          provider: 'openai',
          context_window: 128000,
          supports_streaming: true,
        },
        {
          id: 'gemini-2.5-pro',
          name: 'Gemini 2.5 Pro',
          provider: 'google',
          context_window: 1000000,
          supports_streaming: true,
        },
      ],
    });
  }),
];

// Setup MSW server
const server = setupServer(...handlers);

describe('PuterClient Integration Tests', () => {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
  });

  afterAll(() => {
    server.close();
  });

  afterEach(() => {
    server.resetHandlers();
  });

  describe('Chat Completion (Non-Streaming)', () => {
    it('should complete a chat request successfully', async () => {
      const client = new PuterClient(MOCK_AUTH_TOKEN, {
        api_base_url: MOCK_API_URL,
      });

      const response = await client.chat(
        [{ role: 'user', content: 'Hello, how are you?' }],
        { model: 'claude-opus-4-5' }
      );

      expect(response).toBeDefined();
      expect(response.message).toBeDefined();
      expect(response.message.role).toBe('assistant');
      expect(response.message.content).toContain('Mock response from claude-opus-4-5');
      expect(response.finish_reason).toBe('stop');
      expect(response.usage).toBeDefined();
      expect(response.usage?.total_tokens).toBe(30);
    });

    it('should use default model when not specified', async () => {
      const client = new PuterClient(MOCK_AUTH_TOKEN, {
        api_base_url: MOCK_API_URL,
      });

      const response = await client.chat([{ role: 'user', content: 'Test' }]);

      expect(response.message.content).toContain('gpt-5-nano');
    });

    it('should handle different models correctly', async () => {
      const client = new PuterClient(MOCK_AUTH_TOKEN, {
        api_base_url: MOCK_API_URL,
      });

      const models = ['claude-opus-4-5', 'gpt-5-nano', 'gemini-2.5-pro'];

      for (const model of models) {
        const response = await client.chat(
          [{ role: 'user', content: 'Hello' }],
          { model }
        );
        expect(response.message.content).toContain(model);
      }
    });
  });

  describe('Chat Completion (Streaming)', () => {
    it('should stream chat response chunks', async () => {
      const client = new PuterClient(MOCK_AUTH_TOKEN, {
        api_base_url: MOCK_API_URL,
      });

      const chunks: PuterChatStreamChunk[] = [];

      for await (const chunk of client.chatStream(
        [{ role: 'user', content: 'Tell me a story' }],
        { model: 'claude-opus-4-5' }
      )) {
        chunks.push(chunk);
      }

      // Should have multiple chunks
      expect(chunks.length).toBeGreaterThan(1);

      // Collect all text
      const fullText = chunks
        .filter((c) => c.text)
        .map((c) => c.text)
        .join('');

      expect(fullText).toBe('Hello from Claude Opus!');

      // Last chunk should be done
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.done).toBe(true);
      expect(lastChunk.finish_reason).toBe('stop');
    });

    it('should handle empty stream gracefully', async () => {
      // Override with empty stream handler
      server.use(
        http.post(`${MOCK_API_URL}/drivers/call`, async () => {
          const emptyStream = new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(
                encoder.encode(JSON.stringify({ done: true }) + '\n')
              );
              controller.close();
            },
          });

          return new HttpResponse(emptyStream, {
            headers: { 'Content-Type': 'text/event-stream' },
          });
        })
      );

      const client = new PuterClient(MOCK_AUTH_TOKEN, {
        api_base_url: MOCK_API_URL,
      });

      const chunks: PuterChatStreamChunk[] = [];
      for await (const chunk of client.chatStream(
        [{ role: 'user', content: 'Test' }]
      )) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(1);
      expect(chunks[0].done).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should throw on 401 unauthorized (expired token)', async () => {
      const client = new PuterClient('expired-token', {
        api_base_url: MOCK_API_URL,
      });

      await expect(
        client.chat([{ role: 'user', content: 'Test' }])
      ).rejects.toThrow('Puter API error (401)');
    });

    it('should throw on 429 rate limit', async () => {
      // Disable retries to test immediate error handling
      const client = new PuterClient('rate-limited-token', {
        api_base_url: MOCK_API_URL,
        max_retries: 0,
      });

      await expect(
        client.chat([{ role: 'user', content: 'Test' }])
      ).rejects.toThrow('Puter API error (429)');
    });

    it('should handle network errors gracefully', async () => {
      // Override to simulate network error
      server.use(
        http.post(`${MOCK_API_URL}/drivers/call`, () => {
          return HttpResponse.error();
        })
      );

      // Disable retries to test immediate error handling
      const client = new PuterClient(MOCK_AUTH_TOKEN, {
        api_base_url: MOCK_API_URL,
        max_retries: 0,
      });

      await expect(
        client.chat([{ role: 'user', content: 'Test' }])
      ).rejects.toThrow();
    });

    it('should handle 500 server error', async () => {
      server.use(
        http.post(`${MOCK_API_URL}/drivers/call`, () => {
          return new HttpResponse(
            JSON.stringify({ error: 'Internal server error' }),
            { status: 500 }
          );
        })
      );

      // Disable retries to test immediate error handling
      const client = new PuterClient(MOCK_AUTH_TOKEN, {
        api_base_url: MOCK_API_URL,
        max_retries: 0,
      });

      await expect(
        client.chat([{ role: 'user', content: 'Test' }])
      ).rejects.toThrow('Puter API error (500)');
    });
  });

  describe('Model Listing', () => {
    it('should list available models', async () => {
      const client = new PuterClient(MOCK_AUTH_TOKEN, {
        api_base_url: MOCK_API_URL,
      });

      const models = await client.listModels();

      expect(models).toBeInstanceOf(Array);
      expect(models.length).toBe(3);

      const modelIds = models.map((m) => m.id);
      expect(modelIds).toContain('claude-opus-4-5');
      expect(modelIds).toContain('gpt-5-nano');
      expect(modelIds).toContain('gemini-2.5-pro');
    });

    it('should return model details', async () => {
      const client = new PuterClient(MOCK_AUTH_TOKEN, {
        api_base_url: MOCK_API_URL,
      });

      const models = await client.listModels();
      const claudeOpus = models.find((m) => m.id === 'claude-opus-4-5');

      expect(claudeOpus).toBeDefined();
      expect(claudeOpus?.name).toBe('Claude Opus 4.5');
      expect(claudeOpus?.provider).toBe('anthropic');
      expect(claudeOpus?.context_window).toBe(200000);
      expect(claudeOpus?.supports_streaming).toBe(true);
    });

    it('should fallback to default models on error', async () => {
      server.use(
        http.get(`${MOCK_API_URL}/puterai/chat/models/details`, () => {
          return HttpResponse.error();
        })
      );

      const client = new PuterClient(MOCK_AUTH_TOKEN, {
        api_base_url: MOCK_API_URL,
      });

      const models = await client.listModels();

      // Should return default models from getDefaultModels()
      expect(models).toBeInstanceOf(Array);
      expect(models.length).toBeGreaterThan(0);
      expect(models.some((m) => m.id === 'claude-opus-4-5')).toBe(true);
    });
  });

  describe('Connection Testing', () => {
    it('should test connection successfully', async () => {
      const client = new PuterClient(MOCK_AUTH_TOKEN, {
        api_base_url: MOCK_API_URL,
      });

      const connected = await client.testConnection();

      expect(connected).toBe(true);
    });

    it('should return false on connection failure', async () => {
      server.use(
        http.post(`${MOCK_API_URL}/drivers/call`, () => {
          return HttpResponse.error();
        })
      );

      const client = new PuterClient(MOCK_AUTH_TOKEN, {
        api_base_url: MOCK_API_URL,
      });

      const connected = await client.testConnection();

      expect(connected).toBe(false);
    });
  });

  describe('Token Management', () => {
    it('should allow updating auth token', async () => {
      const client = new PuterClient('initial-token', {
        api_base_url: MOCK_API_URL,
      });

      // First request should fail with invalid token
      // (our mock doesn't recognize 'initial-token' specifically, but let's test setAuthToken)
      client.setAuthToken(MOCK_AUTH_TOKEN);

      const response = await client.chat([{ role: 'user', content: 'Hello' }]);

      expect(response.message).toBeDefined();
    });
  });
});
