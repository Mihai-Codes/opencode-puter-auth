/**
 * OpenCode plugin implementation with AI SDK provider
 * Implements auth loader pattern like Antigravity plugin
 */

import { PuterAuthManager } from './auth.js';
import path from 'path';
import os from 'os';

// Get config directory
function getConfigDir(): string {
  return path.join(os.homedir(), '.config', 'opencode');
}

// OpenCode plugin function - async with context parameter
export const PuterAuthPlugin = async (_ctx: any) => {
  console.log("Puter Auth Plugin initialized!");
  
  return {
    // Auth methods - OAuth flow registration
    auth: {
      provider: 'puter',
      methods: [
        {
          label: 'Puter.com (FREE Unlimited)',
          type: 'oauth' as const,
          authorize: async () => {
            const configDir = getConfigDir();
            const authManager = new PuterAuthManager(configDir);
            await authManager.init();
            const result = await authManager.login();
            
            if (!result.success || !result.account) {
              return {
                url: '',
                instructions: result.error || 'Authentication failed',
                method: 'auto' as const,
                callback: async () => ({ type: 'failed' as const, error: result.error || 'Authentication failed' })
              };
            }
            
            return {
              url: '',
              instructions: 'Authentication successful',
              method: 'auto' as const,
              callback: async () => ({ 
                type: 'success' as const,
                refresh: result.account!.authToken,
                access: result.account!.authToken,
                expires: Date.now() + 86400000
              })
            };
          }
        }
      ],
      loader: async (_getAuth: any) => {
        const configDir = getConfigDir();
        const authManager = new PuterAuthManager(configDir);
        await authManager.init();
        
        const activeAccount = authManager.getActiveAccount();
        if (!activeAccount) {
          throw new Error('Not authenticated with Puter. Run: opencode auth login');
        }

        return {
          apiKey: '', // Not used, we use custom fetch
          async fetch(input: RequestInfo | URL, init?: RequestInit) {
            const url = input.toString();
            
            // Intercept requests to puter models
            if (url.includes('/chat/completions') && init?.body) {
              const body = JSON.parse(init.body as string);
              
              // Check if this is a puter model request
              if (body.model?.startsWith('puter/') || body.model?.includes('claude-opus-4-5') || body.model?.includes('claude-sonnet-4-5')) {
                // Map model names to Puter drivers
                const modelMap: Record<string, string> = {
                  'claude-opus-4-5': 'claude-opus-4-5',
                  'claude-sonnet-4-5': 'claude-sonnet-4-5',
                  'claude-sonnet-4': 'claude-sonnet-4',
                  'gpt-4o': 'gpt-4o',
                  'gpt-5-nano': 'gpt-5-nano',
                  'o3-mini': 'o3-mini',
                  'gemini-2.5-pro': 'gemini-2.5-pro',
                  'gemini-2.5-flash': 'gemini-2.5-flash'
                };
                
                const cleanModel = body.model.replace('puter/', '').replace('google/', '');
                const driver = modelMap[cleanModel] || 'claude-opus-4-5';
                
                // Translate to Puter API format
                const puterRequest = {
                  interface: 'puter-chat-completion',
                  driver,
                  method: 'complete',
                  args: {
                    messages: body.messages,
                    stream: body.stream || false,
                    max_tokens: body.max_tokens,
                    temperature: body.temperature
                  }
                };

                // Make request to Puter API
                const response = await fetch('http://localhost:8080/drivers/call', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${activeAccount.authToken}`
                  },
                  body: JSON.stringify(puterRequest)
                });

                if (!response.ok) {
                  throw new Error(`Puter API error: ${response.statusText}`);
                }

                // For streaming responses
                if (body.stream) {
                  return response; // Return raw response for streaming
                }

                // For non-streaming, translate response back to OpenAI format
                const puterResponse = await response.json();
                const openaiResponse = {
                  id: 'puter-' + Date.now(),
                  object: 'chat.completion',
                  created: Math.floor(Date.now() / 1000),
                  model: body.model,
                  choices: [{
                    index: 0,
                    message: {
                      role: 'assistant',
                      content: puterResponse.result || puterResponse.message || 'No response'
                    },
                    finish_reason: 'stop'
                  }],
                  usage: {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0
                  }
                };

                return new Response(JSON.stringify(openaiResponse), {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' }
                });
              }
            }

            // For non-puter requests, pass through
            return fetch(input, init);
          }
        };
      }
    }
  };
};
