#!/usr/bin/env node
/**
 * Puter Auth CLI for OpenCode
 * 
 * Provides command-line authentication management for the Puter.com provider.
 * 
 * Usage:
 *   puter-auth login       - Authenticate with Puter.com
 *   puter-auth logout      - Remove all stored credentials
 *   puter-auth status      - Show current authentication status
 *   puter-auth serve --mcp - Start MCP server for Zed/Claude Desktop
 *   puter-auth --help      - Show this help message
 */

import { createPuterAuthManager } from './auth.js';
import { homedir } from 'os';
import { join } from 'path';

const configDir = join(homedir(), '.config', 'opencode');

const HELP = `
puter-auth - Puter.com Authentication for OpenCode

USAGE:
  puter-auth <command> [options]

COMMANDS:
  login        Authenticate with Puter.com (opens browser)
  logout       Remove all stored Puter credentials
  status       Show current authentication status
  serve        Start a server (use with --mcp for MCP protocol)
  help         Show this help message

OPTIONS:
  --mcp        Start as MCP (Model Context Protocol) server for Zed/Claude Desktop

EXAMPLES:
  puter-auth login          # Start browser authentication
  puter-auth status         # Check if authenticated
  puter-auth logout         # Clear credentials
  puter-auth serve --mcp    # Start MCP server for Zed IDE

After authenticating, use Puter models in OpenCode:
  opencode -m puter/claude-sonnet-4-5 "Your prompt"
  opencode models puter  # List available models

MCP Integration (Zed IDE, Claude Desktop):
  Add to your MCP config:
  {
    "mcpServers": {
      "puter": {
        "command": "npx",
        "args": ["opencode-puter-auth", "serve", "--mcp"]
      }
    }
  }

For more info: https://github.com/Mihai-Codes/opencode-puter-auth
`;

async function main() {
  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase();

  // Handle help
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(HELP);
    process.exit(0);
  }

  const authManager = createPuterAuthManager(configDir);
  await authManager.init();

  switch (command) {
    case 'login': {
      console.log('Starting Puter authentication...\n');
      const result = await authManager.login();
      if (result.success) {
        console.log('\n✅ Authentication successful!');
        console.log(`   Account: ${result.account?.username}`);
        console.log('\nYou can now use Puter models in OpenCode:');
        console.log('   opencode -m puter/claude-sonnet-4-5 "Your prompt"');
      } else {
        console.error('\n❌ Authentication failed:', result.error);
        process.exit(1);
      }
      break;
    }

    case 'logout': {
      await authManager.logout();
      console.log('✅ Logged out from Puter. All credentials removed.');
      break;
    }

    case 'status': {
      const accounts = authManager.getAllAccounts();
      const active = authManager.getActiveAccount();

      if (accounts.length === 0) {
        console.log('❌ Not authenticated with Puter.');
        console.log('   Run: puter-auth login');
        process.exit(1);
      }

      console.log('✅ Puter Authentication Status\n');
      console.log(`Active account: ${active?.username || 'none'}`);
      console.log(`Total accounts: ${accounts.length}`);
      console.log('');
      
      for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        const isActive = i === authManager.getAllAccounts().indexOf(active!);
        const marker = isActive ? '→' : ' ';
        const temp = acc.isTemporary ? ' (temporary)' : '';
        console.log(`${marker} ${i + 1}. ${acc.username}${temp}`);
        if (acc.lastUsed) {
          console.log(`      Last used: ${new Date(acc.lastUsed).toLocaleString()}`);
        }
      }
      break;
    }

    case 'serve': {
      const isMcp = args.includes('--mcp');
      if (isMcp) {
        // Start MCP server
        const { startMcpServer } = await import('./mcp-server.js');
        await startMcpServer();
      } else {
        console.error('Unknown serve mode. Use --mcp for MCP server.');
        console.log('Example: puter-auth serve --mcp');
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
