/**
 * OpenCode Plugin for Puter.com Authentication
 * 
 * This plugin provides easy access to Claude, GPT, Gemini, and 500+ AI models
 * through Puter.com's OAuth authentication. No API keys needed - just sign in.
 * 
 * Note: Puter uses a credit-based system. New accounts get free credits,
 * and premium models consume credits. This is NOT unlimited - credits run out.
 * 
 * @author chindris-mihai-alexandru
 * @license MIT
 */

import type { Plugin, PluginInput, Hooks } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { URL } from 'node:url';
import { PuterClient } from './client.js';
import { createPuterAuthManager, type PuterAuthManager } from './auth.js';
import type { PuterConfig, PuterChatMessage, PuterAccount } from './types.js';
import { PuterConfigSchema } from './types.js';

// Default config directory
const getConfigDir = (): string => {
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  if (xdgConfig) {
    return path.join(xdgConfig, 'opencode');
  }
  return path.join(os.homedir(), '.config', 'opencode');
};

// Plugin state
let authManager: PuterAuthManager | null = null;
let puterClient: PuterClient | null = null;
let pluginConfig: Partial<PuterConfig> = {};

// OAuth server state
const CALLBACK_PORT = 19847;
const AUTH_TIMEOUT_MS = 300000;

/**
 * Load plugin configuration from puter.json
 */
async function loadConfig(configDir: string): Promise<Partial<PuterConfig>> {
  const fs = await import('node:fs/promises');
  const configPath = path.join(configDir, 'puter.json');
  
  try {
    const data = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(data);
    return PuterConfigSchema.partial().parse(parsed);
  } catch {
    return {};
  }
}

/**
 * Log a message (respects quiet mode)
 */
function log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  if (pluginConfig.quiet_mode) return;
  
  const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : '🟣';
  console.log(`${prefix} [puter-auth] ${message}`);
}

/**
 * Main Plugin Export
 */
export const PuterAuthPlugin: Plugin = async (_input: PluginInput): Promise<Hooks> => {
  const configDir = getConfigDir();
  
  // Load configuration
  pluginConfig = await loadConfig(configDir);
  
  // Initialize auth manager
  authManager = createPuterAuthManager(configDir, pluginConfig);
  await authManager.init();
  
  // Initialize client if we have an active account
  const activeAccount = authManager.getActiveAccount();
  if (activeAccount) {
    puterClient = new PuterClient(activeAccount.authToken, pluginConfig);
    log(`Loaded account: ${activeAccount.username}${activeAccount.isTemporary ? ' (temporary)' : ''}`);
  }

  return {
    // ========================================
    // AUTH HOOK - OAuth with Puter (Standalone Provider)
    // ========================================
    auth: {
      // Use 'puter' as a STANDALONE provider - NOT routing through Google!
      // This provides direct access to Puter's API without
      // being subject to Google/Antigravity rate limits.
      //
      // Users must configure opencode.json with:
      //   "provider": { "puter": { "npm": "opencode-puter-auth", ... } }
      //
      // Models are then accessed as puter/claude-opus-4-5, puter/gpt-4o, etc.
      provider: 'puter',

      // Load auth credentials for Puter provider
      // Returns the API key (auth token) that OpenCode passes to the AI SDK provider
      async loader(_auth, provider) {
        const account = authManager?.getActiveAccount();
        if (account) {
          // Set cost to 0 for OpenCode's cost tracking (Puter handles billing separately)
          if (provider?.models) {
            for (const model of Object.values(provider.models)) {
              (model as any).cost = { input: 0, output: 0, cache: { read: 0, write: 0 } };
            }
          }

          // Return the auth token - OpenCode passes this to createPuter() as apiKey
          // The AI SDK provider (createPuter) uses this to authenticate with Puter's API
          return {
            apiKey: account.authToken,
          };
        }
        return {};
      },
      
      methods: [
        {
          type: 'oauth',
          label: 'Puter.com (500+ AI Models, No API Keys)',
          
          async authorize() {
            return new Promise((resolve) => {
              let resolved = false;
              let server: http.Server | null = null;
              
              // Callback handler function
              const callbackPromise = new Promise<{ type: 'success'; key: string } | { type: 'failed' }>((resolveCallback) => {
                server = http.createServer(async (req, res) => {
                  if (resolved) {
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end('<html><body><h1>Already authenticated</h1></body></html>');
                    return;
                  }

                  const url = new URL(req.url || '/', `http://localhost:${CALLBACK_PORT}`);
                  
                  if (url.pathname === '/callback') {
                    const token = url.searchParams.get('token');
                    const username = url.searchParams.get('username') || 'puter_user';
                    const email = url.searchParams.get('email') || undefined;
                    const isTemp = url.searchParams.get('temp') === 'true';

                    if (token) {
                      resolved = true;

                      const account: PuterAccount = {
                        username,
                        email,
                        authToken: token,
                        addedAt: Date.now(),
                        isTemporary: isTemp,
                      };

                      // Save account
                      if (authManager) {
                        await authManager.addAccount(account);
                        puterClient = new PuterClient(token, pluginConfig);
                        log(`Authenticated as: ${username}`);
                      }

                      res.writeHead(200, { 'Content-Type': 'text/html' });
                      res.end(`
                        <!DOCTYPE html>
                        <html>
                        <head>
                          <title>Puter Auth Success</title>
                          <style>
                            body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
                            .card { background: white; padding: 40px; border-radius: 16px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,0.2); }
                            h1 { color: #22c55e; margin: 0 0 16px 0; }
                            p { color: #666; margin: 0; }
                            .emoji { font-size: 48px; margin-bottom: 16px; }
                          </style>
                        </head>
                        <body>
                          <div class="card">
                            <div class="emoji">✅</div>
                            <h1>Authentication Successful!</h1>
                            <p>You can close this window and return to OpenCode.</p>
                          </div>
                        </body>
                        </html>
                      `);

                      server?.close();
                      resolveCallback({ type: 'success', key: token });
                    } else {
                      res.writeHead(400, { 'Content-Type': 'text/html' });
                      res.end('<html><body><h1>Missing token</h1></body></html>');
                    }
                  } else if (url.pathname === '/') {
                    // Redirect to Puter auth
                    const callbackUrl = encodeURIComponent(`http://localhost:${CALLBACK_PORT}/callback`);
                    const authUrl = `https://puter.com/auth?redirect=${callbackUrl}`;
                    
                    res.writeHead(302, { Location: authUrl });
                    res.end();
                  } else {
                    res.writeHead(404);
                    res.end('Not found');
                  }
                });

                server.listen(CALLBACK_PORT, 'localhost');

                // Timeout handler
                setTimeout(() => {
                  if (!resolved) {
                    resolved = true;
                    server?.close();
                    resolveCallback({ type: 'failed' });
                  }
                }, AUTH_TIMEOUT_MS);

                server.on('error', () => {
                  if (!resolved) {
                    resolved = true;
                    resolveCallback({ type: 'failed' });
                  }
                });
              });
              
              resolve({
                url: `http://localhost:${CALLBACK_PORT}`,
                instructions: 'Opening browser for Puter.com authentication. Sign in or create an account to access 500+ AI models.',
                method: 'auto' as const,
                callback: () => callbackPromise,
              });
            });
          },
        },
      ],
    },

    // ========================================
    // CUSTOM TOOLS
    // ========================================
    tool: {
      'puter-models': tool({
        description: 'List all available Puter.com AI models (Claude, GPT, Gemini, etc.)',
        args: {},
        async execute() {
          if (!puterClient) {
            return 'Not authenticated with Puter. Run: opencode auth login';
          }
          
          const models = await puterClient.listModels();
          
          let output = '# Available Puter.com Models\n\n';
          
          // Group by provider
          const byProvider: Record<string, typeof models> = {};
          for (const model of models) {
            const provider = model.provider || 'other';
            if (!byProvider[provider]) byProvider[provider] = [];
            byProvider[provider].push(model);
          }
          
          for (const [provider, providerModels] of Object.entries(byProvider)) {
            output += `## ${provider.charAt(0).toUpperCase() + provider.slice(1)}\n\n`;
            for (const model of providerModels) {
              output += `- **${model.id}** - ${model.name}\n`;
              if (model.context_window) {
                output += `  - Context: ${model.context_window.toLocaleString()} tokens\n`;
              }
            }
            output += '\n';
          }
          
          output += `\nTotal: ${models.length} models available via Puter.com`;
          
          return output;
        },
      }),
      
      'puter-account': tool({
        description: 'Show current Puter.com account information',
        args: {},
        async execute() {
          if (!authManager) {
            return 'Puter plugin not initialized';
          }
          
          const accounts = authManager.getAllAccounts();
          const activeAccount = authManager.getActiveAccount();
          
          if (accounts.length === 0) {
            return 'No Puter accounts configured. Run: opencode auth login';
          }
          
          let output = '# Puter.com Accounts\n\n';
          
          for (let i = 0; i < accounts.length; i++) {
            const account = accounts[i];
            const isActive = account === activeAccount;
            const marker = isActive ? '→ ' : '  ';
            const status = account.isTemporary ? '(temporary)' : '';
            
            output += `${marker}${i + 1}. **${account.username}** ${status}\n`;
            if (account.email) {
              output += `      Email: ${account.email}\n`;
            }
            if (account.lastUsed) {
              output += `      Last used: ${new Date(account.lastUsed).toLocaleString()}\n`;
            }
          }
          
          output += '\n---\n';
          output += 'Puter uses a credit-based system. New accounts get free credits.\n';
          
          return output;
        },
      }),
      
      'puter-chat': tool({
        description: 'Send a chat message using Puter AI. Access Claude, GPT, Gemini via Puter.com.',
        args: {
          message: tool.schema.string().describe('The message to send to the AI'),
          model: tool.schema.string().optional().describe('Model to use (default: claude-sonnet-4-5). Options: claude-opus-4-5, claude-sonnet-4-5, gpt-5.2, gpt-4o, gemini-2.5-pro, etc.'),
        },
        async execute(args) {
          if (!puterClient) {
            return 'Not authenticated with Puter. Run: opencode auth login';
          }
          
          const model = args.model || 'claude-sonnet-4-5';
          const messages: PuterChatMessage[] = [
            { role: 'user', content: args.message },
          ];
          
          try {
            const response = await puterClient.chat(messages, { model });
            
            await authManager?.touchActiveAccount();
            
            const content = response.message?.content || 'No response';
            const usage = response.usage 
              ? `\n\n---\n*Model: ${model} | Tokens: ${response.usage.total_tokens}*`
              : '';
            
            return content + usage;
          } catch (error) {
            return `Failed to chat with Puter AI: ${error instanceof Error ? error.message : 'Unknown error'}`;
          }
        },
      }),
    },

    // ========================================
    // EVENT HANDLER
    // ========================================
    async event({ event }) {
      if (pluginConfig.debug) {
        console.log(`[puter-auth] Event: ${event.type}`);
      }
    },
  };
};


