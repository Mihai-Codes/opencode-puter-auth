#!/usr/bin/env node
/**
 * Puter MCP Server for OpenCode
 * 
 * Model Context Protocol server that exposes Puter.com AI models to MCP clients
 * like Zed IDE, Claude Desktop, and other MCP-compatible applications.
 * 
 * This server provides three tools:
 * - puter-chat: Chat with AI models (Claude, GPT, Gemini, etc.)
 * - puter-models: List all available models
 * - puter-account: Show account info and credit usage
 * 
 * Usage:
 *   npx opencode-puter-auth serve --mcp
 *   # or directly:
 *   node dist/mcp-server.js
 * 
 * IMPORTANT: This server uses stdio transport. All logging MUST go to stderr,
 * never to stdout, as stdout is reserved for JSON-RPC messages.
 * 
 * @module mcp-server
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createPuterAuthManager } from './auth.js';
import { PuterClient } from './client.js';
import { homedir } from 'os';
import { join } from 'path';

// Configuration
const CONFIG_DIR = join(homedir(), '.config', 'opencode');
const SERVER_NAME = 'puter-mcp';
const SERVER_VERSION = '1.1.1';

// Logger that writes to stderr (never stdout!)
const log = {
  info: (msg: string, data?: unknown) => {
    console.error(`[${SERVER_NAME}] ${msg}`, data ? JSON.stringify(data) : '');
  },
  error: (msg: string, error?: unknown) => {
    console.error(`[${SERVER_NAME}] ERROR: ${msg}`, error instanceof Error ? error.message : error);
  },
  debug: (msg: string, data?: unknown) => {
    if (process.env.DEBUG) {
      console.error(`[${SERVER_NAME}] DEBUG: ${msg}`, data ? JSON.stringify(data) : '');
    }
  },
};

// Tool definitions
const TOOLS: Tool[] = [
  {
    name: 'puter-chat',
    description: 'Chat with AI models through Puter.com. Supports Claude, GPT, Gemini, and 500+ other models. Returns the model\'s response.',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The message to send to the AI model',
        },
        model: {
          type: 'string',
          description: 'Model ID to use (e.g., "claude-sonnet-4-5", "gpt-4o", "gemini-2.5-pro"). Defaults to "gpt-4o".',
        },
        system: {
          type: 'string',
          description: 'Optional system prompt to set the AI\'s behavior',
        },
        temperature: {
          type: 'number',
          description: 'Sampling temperature (0-2). Lower = more focused, higher = more creative. Default: 0.7',
        },
        max_tokens: {
          type: 'number',
          description: 'Maximum tokens in the response. Default: 4096',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'puter-models',
    description: 'List all available AI models from Puter.com. Returns model IDs, names, providers, and capabilities.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          description: 'Filter by provider (e.g., "anthropic", "openai", "google")',
        },
      },
    },
  },
  {
    name: 'puter-account',
    description: 'Show Puter.com account information including username and credit usage.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// Input schemas for validation
const ChatInputSchema = z.object({
  message: z.string().min(1, 'Message is required'),
  model: z.string().optional().default('gpt-4o'),
  system: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().positive().optional(),
});

const ModelsInputSchema = z.object({
  provider: z.string().optional(),
});

/**
 * Initialize and get the Puter client
 */
async function getPuterClient(): Promise<{ client: PuterClient; username: string } | null> {
  try {
    const authManager = createPuterAuthManager(CONFIG_DIR);
    await authManager.init();

    const account = authManager.getActiveAccount();
    if (!account) {
      return null;
    }

    const client = new PuterClient(account.authToken);
    return { client, username: account.username };
  } catch (error) {
    log.error('Failed to initialize Puter client', error);
    return null;
  }
}

/**
 * Handle the puter-chat tool
 */
async function handleChat(args: unknown): Promise<string> {
  const input = ChatInputSchema.parse(args);
  
  const puter = await getPuterClient();
  if (!puter) {
    return JSON.stringify({
      error: 'Not authenticated with Puter. Run "npx opencode-puter-auth login" first.',
    });
  }

  log.info(`Chat request: model=${input.model}, message length=${input.message.length}`);

  try {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    
    if (input.system) {
      messages.push({ role: 'system', content: input.system });
    }
    messages.push({ role: 'user', content: input.message });

    const response = await puter.client.chat(messages, {
      model: input.model,
      temperature: input.temperature,
      max_tokens: input.max_tokens || 4096,
    });

    let content = response.message?.content || '';
    
    // Handle case where content is an array of parts (e.g. OpenAI format)
    if (Array.isArray(content)) {
      content = content
        .map((part: any) => part.text || '')
        .join('');
    }
    
    log.info(`Chat response: ${content.length} chars`);

    return content;
  } catch (error) {
    log.error('Chat failed', error);
    return JSON.stringify({
      error: error instanceof Error ? error.message : 'Chat request failed',
    });
  }
}

/**
 * Handle the puter-models tool
 */
async function handleModels(args: unknown): Promise<string> {
  const input = ModelsInputSchema.parse(args);
  
  const puter = await getPuterClient();
  if (!puter) {
    return JSON.stringify({
      error: 'Not authenticated with Puter. Run "npx opencode-puter-auth login" first.',
    });
  }

  log.info('Fetching models list');

  try {
    let models = await puter.client.listModels();
    
    // Filter by provider if specified
    if (input.provider) {
      const providerLower = input.provider.toLowerCase();
      models = models.filter(m => 
        m.provider?.toLowerCase() === providerLower ||
        m.id.toLowerCase().includes(providerLower)
      );
    }

    log.info(`Found ${models.length} models`);

    // Format output
    const formatted = models.map(m => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      context_window: m.context_window,
      max_output_tokens: m.max_output_tokens,
      supports_streaming: m.supports_streaming,
      supports_tools: m.supports_tools,
      supports_vision: m.supports_vision,
    }));

    return JSON.stringify(formatted, null, 2);
  } catch (error) {
    log.error('Failed to fetch models', error);
    return JSON.stringify({
      error: error instanceof Error ? error.message : 'Failed to fetch models',
    });
  }
}

/**
 * Handle the puter-account tool
 */
async function handleAccount(): Promise<string> {
  const puter = await getPuterClient();
  if (!puter) {
    return JSON.stringify({
      error: 'Not authenticated with Puter. Run "npx opencode-puter-auth login" first.',
    });
  }

  log.info('Fetching account info');

  try {
    const usage = await puter.client.getMonthlyUsage();
    
    // Format credit amounts (Puter uses 8 decimal places / microcents)
    const formatCredits = (amount: number) => {
      return `$${(amount / 100000000).toFixed(2)}`;
    };

    const allowance = usage.allowanceInfo?.monthUsageAllowance || 0;
    const remaining = usage.allowanceInfo?.remaining || 0;
    const used = allowance - remaining;

    const result = {
      username: puter.username,
      monthly_allowance: formatCredits(allowance),
      used: formatCredits(used),
      remaining: formatCredits(remaining),
    };

    log.info(`Account: ${puter.username}, remaining: ${result.remaining}`);

    return JSON.stringify(result, null, 2);
  } catch (error) {
    log.error('Failed to fetch account info', error);
    
    // Return basic info even if usage fetch fails
    return JSON.stringify({
      username: puter.username,
      error: 'Could not fetch usage details: ' + (error instanceof Error ? error.message : 'Unknown error'),
    }, null, 2);
  }
}

/**
 * Create and configure the MCP server
 */
function createServer(): Server {
  const server = new Server(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Handle tool listing
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    log.debug('Tools list requested');
    return { tools: TOOLS };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    log.info(`Tool called: ${name}`);

    try {
      let result: string;

      switch (name) {
        case 'puter-chat':
          result = await handleChat(args);
          break;
        case 'puter-models':
          result = await handleModels(args);
          break;
        case 'puter-account':
          result = await handleAccount();
          break;
        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }

      return {
        content: [{ type: 'text', text: result }],
      };
    } catch (error) {
      log.error(`Tool ${name} failed`, error);
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Start the MCP server
 */
export async function startMcpServer(): Promise<void> {
  log.info('Starting Puter MCP server...');

  const server = createServer();
  const transport = new StdioServerTransport();

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    log.info('Shutting down...');
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    log.info('Shutting down...');
    await server.close();
    process.exit(0);
  });

  // Connect and run
  await server.connect(transport);
  log.info('Server connected on stdio');
}

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  startMcpServer().catch((error) => {
    log.error('Failed to start server', error);
    process.exit(1);
  });
}
