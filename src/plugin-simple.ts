/**
 * Minimal OpenCode plugin for Puter.com
 * Just provides auth loader - users authenticate via `puter-auth` CLI
 */

import { PuterAuthManager } from './auth.js';
import path from 'path';
import os from 'os';

function getConfigDir(): string {
  return path.join(os.homedir(), '.config', 'opencode');
}

export const PuterAuthPlugin = async (_ctx: any) => {
  return {
    auth: {
      provider: 'puter',
      loader: async () => {
        const configDir = getConfigDir();
        const authManager = new PuterAuthManager(configDir);
        await authManager.init();
        
        const activeAccount = authManager.getActiveAccount();
        if (!activeAccount) {
          throw new Error('Not authenticated with Puter. Run: puter-auth');
        }

        return {
          apiKey: activeAccount.authToken,
          async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
            
            const headers = new Headers(init?.headers);
            headers.set('Authorization', `Bearer ${activeAccount.authToken}`);
            
            // Replace OpenAI API URL with Puter API URL
            const puterUrl = url.replace(
              /^https:\/\/api\.openai\.com\/v1/,
              'https://api.puter.com/drivers/call'
            );

            return fetch(puterUrl, { ...init, headers });
          },
        };
      }
    }
  };
};
