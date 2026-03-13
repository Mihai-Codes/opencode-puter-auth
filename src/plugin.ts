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
import http from 'node:http';
import { URL } from 'node:url';
import { PuterClient } from './client.js';
import { createPuterAuthManager, type PuterAuthManager } from './auth.js';
import type { PuterConfig, PuterChatMessage, PuterAccount, PuterContentPart } from './types.js';
import { loadPuterConfig } from './config.js';
import { getConfigDir } from './paths.js';
import { ModelMetricsStore } from './metrics.js';

// Plugin state
let authManager: PuterAuthManager | null = null;
let puterClient: PuterClient | null = null;
let pluginConfig: Partial<PuterConfig> = {};

// OAuth server state
const CALLBACK_PORT = 19847;
const AUTH_TIMEOUT_MS = 300000;

/**
 * Generate the HTML login page for Puter authentication.
 * Puter uses username/password login via REST API, not OAuth redirects.
 * This page handles the login flow entirely in the browser, including 2FA.
 */
function getLoginPage(callbackPort: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign in to Puter - OpenCode</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 20px;
    }
    .card {
      background: white;
      padding: 40px;
      border-radius: 16px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
      width: 100%;
      max-width: 400px;
    }
    .logo {
      text-align: center;
      margin-bottom: 24px;
    }
    .logo h1 {
      font-size: 28px;
      color: #333;
    }
    .logo p {
      color: #666;
      font-size: 14px;
      margin-top: 8px;
    }
    .form-group {
      margin-bottom: 20px;
    }
    label {
      display: block;
      font-weight: 500;
      margin-bottom: 6px;
      color: #333;
    }
    input {
      width: 100%;
      padding: 12px 16px;
      border: 2px solid #e2e8f0;
      border-radius: 8px;
      font-size: 16px;
      transition: border-color 0.2s;
    }
    input:focus {
      outline: none;
      border-color: #667eea;
    }
    button {
      width: 100%;
      padding: 14px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    button:hover { opacity: 0.9; }
    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .error {
      background: #fee2e2;
      border: 1px solid #fca5a5;
      color: #dc2626;
      padding: 12px;
      border-radius: 8px;
      margin-bottom: 20px;
      display: none;
    }
    .info {
      background: #dbeafe;
      border: 1px solid #93c5fd;
      color: #1d4ed8;
      padding: 12px;
      border-radius: 8px;
      margin-bottom: 20px;
      font-size: 14px;
    }
    .signup-link {
      text-align: center;
      margin-top: 20px;
      font-size: 14px;
      color: #666;
    }
    .signup-link a {
      color: #667eea;
      text-decoration: none;
    }
    .signup-link a:hover { text-decoration: underline; }
    #otp-section { display: none; }
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid transparent;
      border-top: 2px solid white;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-right: 8px;
      vertical-align: middle;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <h1>Puter</h1>
      <p>Sign in to access 500+ AI models via OpenCode</p>
    </div>

    <div class="error" id="error"></div>

    <div class="info">
      Sign in with your Puter.com account. If you don't have one, 
      <a href="https://puter.com" target="_blank">create a free account</a> first.
    </div>

    <form id="login-form">
      <div id="credentials-section">
        <div class="form-group">
          <label for="username">Username</label>
          <input type="text" id="username" name="username" required autocomplete="username">
        </div>
        <div class="form-group">
          <label for="password">Password</label>
          <input type="password" id="password" name="password" required autocomplete="current-password">
        </div>
      </div>

      <div id="otp-section">
        <div class="form-group">
          <label for="otp">Authenticator Code (2FA)</label>
          <input type="text" id="otp" name="otp" maxlength="6" pattern="[0-9]{6}" 
                 placeholder="Enter 6-digit code" autocomplete="one-time-code">
        </div>
      </div>

      <button type="submit" id="submit-btn">Sign In</button>
    </form>

    <div class="signup-link">
      Don't have an account? <a href="https://puter.com" target="_blank">Sign up for Puter</a>
    </div>
  </div>

  <script>
    const form = document.getElementById('login-form');
    const errorDiv = document.getElementById('error');
    const submitBtn = document.getElementById('submit-btn');
    const credentialsSection = document.getElementById('credentials-section');
    const otpSection = document.getElementById('otp-section');
    const otpInput = document.getElementById('otp');
    
    let otpJwtToken = null; // For 2FA flow

    function showError(message) {
      errorDiv.textContent = message;
      errorDiv.style.display = 'block';
    }

    function hideError() {
      errorDiv.style.display = 'none';
    }

    function setLoading(loading) {
      submitBtn.disabled = loading;
      submitBtn.innerHTML = loading 
        ? '<span class="spinner"></span>Signing in...' 
        : 'Sign In';
    }

    async function handleLogin(e) {
      e.preventDefault();
      hideError();
      setLoading(true);

      try {
        let response, data;

        if (otpJwtToken) {
          // 2FA step
          const otp = otpInput.value.trim();
          if (otp.length !== 6) {
            showError('Please enter a 6-digit code');
            setLoading(false);
            return;
          }

          response = await fetch('https://puter.com/login/otp', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Origin': 'https://puter.com',
              'Referer': 'https://puter.com/'
            },
            body: JSON.stringify({
              token: otpJwtToken,
              code: otp
            })
          });
        } else {
          // Initial login
          const username = document.getElementById('username').value.trim();
          const password = document.getElementById('password').value;

          response = await fetch('https://puter.com/login', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Origin': 'https://puter.com',
              'Referer': 'https://puter.com/'
            },
            body: JSON.stringify({ username, password })
          });
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          const text = await response.text();
          throw new Error(text || 'Login failed');
        }

        data = await response.json();

        // Handle multi-step login (2FA)
        while (data.proceed && data.next_step) {
          if (data.next_step === 'otp') {
            // Show 2FA input
            otpJwtToken = data.otp_jwt_token;
            credentialsSection.style.display = 'none';
            otpSection.style.display = 'block';
            submitBtn.textContent = 'Verify Code';
            setLoading(false);
            otpInput.focus();
            return; // Wait for user to submit OTP
          }

          if (data.next_step === 'complete') {
            break;
          }

          throw new Error('Unrecognized login step: ' + data.next_step);
        }

        // Success - we have the token
        if (data.proceed && data.token) {
          // Get user info to get username
          let username = document.getElementById('username').value.trim();
          
          // Redirect to callback with token
          const callbackUrl = new URL('http://localhost:${callbackPort}/callback');
          callbackUrl.searchParams.set('token', data.token);
          callbackUrl.searchParams.set('username', username);
          if (data.email) {
            callbackUrl.searchParams.set('email', data.email);
          }
          
          window.location.href = callbackUrl.toString();
        } else {
          throw new Error('Login failed. Please check your credentials.');
        }

      } catch (err) {
        showError(err.message || 'Login failed');
        setLoading(false);
      }
    }

    form.addEventListener('submit', handleLogin);
    
    // Focus username on load
    document.getElementById('username').focus();
  </script>
</body>
</html>`;
}

/**
 * Load plugin configuration from puter.json
 */
async function loadConfig(configDir: string): Promise<Partial<PuterConfig>> {
  return loadPuterConfig(configDir);
}

/**
 * Log a message (respects quiet mode)
 */
function log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  return;
  
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
                    // Serve login page - Puter uses username/password, not OAuth redirects
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(getLoginPage(CALLBACK_PORT));
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
                instructions: 'Opening browser for Puter.com login. Enter your Puter username and password to authenticate.',
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
          image_url: tool.schema.string().optional().describe('Image URL or Puter path (for vision-capable models)'),
          file_path: tool.schema.string().optional().describe('Puter file path for PDFs/documents (e.g., /home/you/file.pdf)'),
        },
        async execute(args) {
          if (!puterClient) {
            return 'Not authenticated with Puter. Run: opencode auth login';
          }
          
          const model = args.model || 'claude-sonnet-4-5';
          const contentParts = (() => {
            const parts: PuterContentPart[] = [];
            if (args.message) {
              parts.push({ type: 'text', text: args.message });
            }
            if (args.image_url) {
              parts.push({ type: 'image_url', image_url: { url: args.image_url } });
            }
            if (args.file_path) {
              parts.push({ type: 'file', puter_path: args.file_path });
            }
            if (parts.length === 1 && parts[0].type === 'text') {
              return parts[0].text || '';
            }
            return parts;
          })();

          const messages: PuterChatMessage[] = [
            { role: 'user', content: contentParts },
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

      'puter-usage': tool({
        description: 'Check Puter.com monthly credit usage for all accounts. Shows remaining credits and helps identify exhausted accounts.',
        args: {
          all: tool.schema.boolean().optional().describe('Check usage for all accounts, not just the active one'),
        },
        async execute(args) {
          if (!authManager) {
            return 'Puter plugin not initialized';
          }

          const accounts = args.all ? authManager.getAllAccounts() : [];
          const activeAccount = authManager.getActiveAccount();
          
          if (!activeAccount && accounts.length === 0) {
            return 'No Puter accounts configured. Run: opencode auth login';
          }

          // Helper to format microcents as dollars
          const formatDollars = (microcents: number): string => {
            const dollars = microcents / 100_000_000;
            return `$${dollars.toFixed(2)}`;
          };

          // Helper to get percentage used
          const getPercentUsed = (remaining: number, total: number): number => {
            if (total === 0) return 100;
            return Math.round(((total - remaining) / total) * 100);
          };

          // Helper to get status indicator
          const getStatus = (remaining: number, total: number): string => {
            const percentRemaining = (remaining / total) * 100;
            if (percentRemaining === 0) return '❌ Exhausted';
            if (percentRemaining < 10) return '🔴 Critical';
            if (percentRemaining < 25) return '🟠 Low';
            if (percentRemaining < 50) return '🟡 Moderate';
            return '🟢 Good';
          };

          let output = '# Puter.com Monthly Usage\n\n';

          // Check active account first
          if (activeAccount) {
            const client = new PuterClient(activeAccount.authToken, pluginConfig);
            try {
              const usage = await client.getMonthlyUsage();
              const { remaining, monthUsageAllowance } = usage.allowanceInfo;
              const percentUsed = getPercentUsed(remaining, monthUsageAllowance);
              const status = getStatus(remaining, monthUsageAllowance);

              output += `## Current Account: ${activeAccount.username}\n\n`;
              output += `| Metric | Value |\n`;
              output += `|--------|-------|\n`;
              output += `| Remaining | ${formatDollars(remaining)} of ${formatDollars(monthUsageAllowance)} |\n`;
              output += `| Used | ${percentUsed}% |\n`;
              output += `| Status | ${status} |\n`;

              // Show API breakdown if available
              if (usage.usage && Object.keys(usage.usage).length > 0) {
                output += `\n### API Usage Breakdown\n\n`;
                output += `| API | Calls | Cost |\n`;
                output += `|-----|-------|------|\n`;
                for (const [api, data] of Object.entries(usage.usage)) {
                  output += `| ${api} | ${data.count.toLocaleString()} | ${formatDollars(data.cost)} |\n`;
                }
              }

              if (remaining === 0) {
                output += `\n**Warning:** This account has exhausted its monthly credits. `;
                output += `Consider creating a new Puter account or waiting for the monthly reset.\n`;
              }
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : 'Unknown error';
              output += `## Current Account: ${activeAccount.username}\n\n`;
              if (errorMsg.includes('403')) {
                output += `❌ **Account exhausted or rate limited**\n\n`;
                output += `This account is returning 403 Forbidden, which typically means:\n`;
                output += `- Monthly credits are exhausted\n`;
                output += `- Account is rate limited\n\n`;
              } else {
                output += `❌ **Error checking usage:** ${errorMsg}\n\n`;
              }
            }
          }

          // Check other accounts if requested
          if (args.all && accounts.length > 0) {
            output += `\n---\n\n## All Accounts Summary\n\n`;
            output += `| Account | Remaining | Status |\n`;
            output += `|---------|-----------|--------|\n`;

            for (const account of accounts) {
              const isActive = account === activeAccount;
              const marker = isActive ? ' (active)' : '';
              
              const client = new PuterClient(account.authToken, pluginConfig);
              try {
                const usage = await client.getMonthlyUsage();
                const { remaining, monthUsageAllowance } = usage.allowanceInfo;
                const status = getStatus(remaining, monthUsageAllowance);
                output += `| ${account.username}${marker} | ${formatDollars(remaining)} | ${status} |\n`;
              } catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Unknown';
                if (errorMsg.includes('403')) {
                  output += `| ${account.username}${marker} | $0.00 | ❌ Exhausted/Blocked |\n`;
                } else {
                  output += `| ${account.username}${marker} | - | ❌ Error |\n`;
                }
              }
            }
          }

          output += `\n---\n`;
          output += `*Credits are measured in microcents ($1.00 = 100,000,000 microcents)*\n`;
          output += `*Use \`puter-usage --all\` to check all accounts*\n`;

          return output;
        },
      }),

      'puter-stats': tool({
        description: 'Show model latency and reliability metrics collected locally.',
        args: {
          model: tool.schema.string().optional().describe('Filter stats to a specific model id'),
          reset: tool.schema.boolean().optional().describe('Reset metrics (optionally for a single model)'),
        },
        async execute(args) {
          const metrics = new ModelMetricsStore({
            enabled: pluginConfig.metrics_enabled ?? true,
            maxSamples: pluginConfig.metrics_max_samples ?? 200,
            filePath: pluginConfig.metrics_file,
          });

          if (args.reset) {
            await metrics.reset(args.model);
            return `✅ Metrics reset${args.model ? ` for ${args.model}` : ''}.`;
          }

          const data = await metrics.getMetrics(args.model);
          if (!data || (Array.isArray(data) && data.length === 0)) {
            return 'No metrics recorded yet.';
          }

          const rows = Array.isArray(data) ? data : [data];
          let output = '# Puter Model Stats\n\n';
          output += '| Model | Requests | Success | Fail | Avg ms | P50 | P95 | Tokens/s | Last Used |\n';
          output += '|-------|----------|---------|------|--------|-----|-----|----------|----------|\n';
          for (const row of rows) {
            const lastUsed = row.lastUsed ? new Date(row.lastUsed).toLocaleString() : '-';
            output += `| ${row.model} | ${row.requestCount} | ${row.successCount} | ${row.failureCount} | ${Math.round(row.avgLatencyMs)} | ${Math.round(row.p50LatencyMs)} | ${Math.round(row.p95LatencyMs)} | ${row.avgTokensPerSecond.toFixed(1)} | ${lastUsed} |\n`;
          }
          return output;
        },
      }),
    },

    // ========================================
    // EVENT HANDLER
    // ========================================
    async event({ event }) {
      void event;
    },
  };
};
