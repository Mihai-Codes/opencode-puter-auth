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
 *   puter-auth usage       - Show monthly Puter credit usage
 *   puter-auth stats       - Show model latency/reliability stats
 *   puter-auth cache       - Inspect or clear response cache
 *   puter-auth serve --mcp - Start MCP server for Zed/Claude Desktop
 *   puter-auth serve --openai --port 11434 - Start OpenAI-compatible proxy
 *   puter-auth --help      - Show this help message
 */

import { createPuterAuthManager } from './auth.js';
import { PuterClient } from './client.js';
import { ResponseCache } from './cache.js';
import { ModelMetricsStore } from './metrics.js';
import { loadPuterConfig } from './config.js';
import { getConfigDir } from './paths.js';

const configDir = getConfigDir();

const HELP = `
puter-auth - Puter.com Authentication for OpenCode

USAGE:
  puter-auth <command> [options]

COMMANDS:
  login        Authenticate with Puter.com (opens browser)
  logout       Remove all stored Puter credentials
  status       Show current authentication status
  usage        Show monthly Puter credit usage
  stats        Show model latency and reliability stats
  cache        Inspect or clear response cache
  serve        Start a server (use with --mcp for MCP protocol)
  help         Show this help message

OPTIONS:
  --mcp        Start as MCP (Model Context Protocol) server for Zed/Claude Desktop
  --openai     Start OpenAI-compatible HTTP proxy
  --port N     Port for --openai mode (default: 11434)
  --api-key K  Require API key (or use PUTER_OPENAI_PROXY_API_KEY)
  --all        (usage) Show usage for all accounts
  --reset      (stats) Reset metrics (optionally for a model)
  --clear      (cache) Clear response cache

EXAMPLES:
  puter-auth login          # Start browser authentication
  puter-auth status         # Check if authenticated
  puter-auth usage          # Show monthly credit usage
  puter-auth usage --all    # Show usage for all accounts
  puter-auth stats          # Show model stats
  puter-auth stats gpt-5.2  # Show stats for one model
  puter-auth stats --reset  # Reset all stats
  puter-auth cache          # Show cache stats
  puter-auth cache --clear  # Clear response cache
  puter-auth logout         # Clear credentials
  puter-auth serve --mcp    # Start MCP server for Zed IDE
  puter-auth serve --openai --port 11434
  puter-auth serve --openai --api-key my-secret

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

  const config = await loadPuterConfig(configDir);
  const authManager = createPuterAuthManager(configDir, config);
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

    case 'usage': {
      const showAll = args.includes('--all');
      const accounts = authManager.getAllAccounts();
      const active = authManager.getActiveAccount();

      if (!active && accounts.length === 0) {
        console.log('❌ Not authenticated with Puter.');
        console.log('   Run: puter-auth login');
        process.exit(1);
      }

      const formatDollars = (microcents: number): string => {
        const dollars = microcents / 100_000_000;
        return `$${dollars.toFixed(2)}`;
      };

      const getPercentUsed = (remaining: number, total: number): number => {
        if (total === 0) return 0;
        return Math.round(((total - remaining) / total) * 100);
      };

      const getStatus = (remaining: number, total: number): string => {
        if (total === 0) return 'Unknown';
        const percentRemaining = (remaining / total) * 100;
        if (percentRemaining === 0) return 'Exhausted';
        if (percentRemaining < 10) return 'Critical';
        if (percentRemaining < 25) return 'Low';
        if (percentRemaining < 50) return 'Moderate';
        return 'Good';
      };

      if (showAll) {
        console.log('Puter Account Usage (All Accounts)');
        console.log('----------------------------------\n');
        console.log('Account | Remaining | Status');
        console.log('--------|-----------|-------');

        for (const account of accounts) {
          const marker = account === active ? ' (active)' : '';
          const client = new PuterClient(account.authToken, config);
          try {
            const usage = await client.getMonthlyUsage();
            const { remaining, monthUsageAllowance } = usage.allowanceInfo;
            const status = getStatus(remaining, monthUsageAllowance);
            console.log(`${account.username}${marker} | ${formatDollars(remaining)} | ${status}`);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            console.log(`${account.username}${marker} | - | Error: ${errorMsg}`);
          }
        }

        console.log('\nCredits are measured in microcents ($1.00 = 100,000,000 microcents).');
      } else if (active) {
        const client = new PuterClient(active.authToken, config);
        try {
          const usage = await client.getMonthlyUsage();
          const { remaining, monthUsageAllowance } = usage.allowanceInfo;
          const percentUsed = getPercentUsed(remaining, monthUsageAllowance);
          const status = getStatus(remaining, monthUsageAllowance);

          console.log('Puter Account Usage');
          console.log('-------------------');
          console.log(`Account:   ${active.username}`);
          console.log(`Remaining: ${formatDollars(remaining)} of ${formatDollars(monthUsageAllowance)}`);
          console.log(`Used:      ${percentUsed}%`);
          console.log(`Status:    ${status}`);

          if (usage.usage && Object.keys(usage.usage).length > 0) {
            console.log('\nAPI Usage Breakdown');
            console.log('API | Calls | Cost');
            console.log('----|-------|-----');
            for (const [api, data] of Object.entries(usage.usage)) {
              console.log(`${api} | ${data.count.toLocaleString()} | ${formatDollars(data.cost)}`);
            }
          }

          console.log('\nCredits are measured in microcents ($1.00 = 100,000,000 microcents).');
          console.log('Tip: run `puter-auth usage --all` to see all accounts.');
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error('❌ Failed to fetch usage:', errorMsg);
          process.exit(1);
        }
      }

      break;
    }

    case 'stats': {
      const reset = args.includes('--reset');
      const modelArg = args.find(arg => !arg.startsWith('-') && arg !== 'stats');
      const metrics = new ModelMetricsStore({
        enabled: config.metrics_enabled ?? true,
        maxSamples: config.metrics_max_samples ?? 200,
        filePath: config.metrics_file,
      });

      if (reset) {
        await metrics.reset(modelArg);
        console.log(`✅ Metrics reset${modelArg ? ` for ${modelArg}` : ''}.`);
        break;
      }

      const data = await metrics.getMetrics(modelArg);
      if (!data || (Array.isArray(data) && data.length === 0)) {
        console.log('No metrics recorded yet.');
        break;
      }

      const rows = Array.isArray(data) ? data : [data];
      console.log('Model Stats');
      console.log('-----------\n');
      console.log('Model | Requests | Success | Fail | Avg ms | P50 | P95 | Tokens/s | Last Used');
      console.log('------|----------|---------|------|--------|-----|-----|----------|----------');
      for (const row of rows) {
        const lastUsed = row.lastUsed ? new Date(row.lastUsed).toLocaleString() : '-';
        console.log(
          `${row.model} | ${row.requestCount} | ${row.successCount} | ${row.failureCount} | ` +
          `${Math.round(row.avgLatencyMs)} | ${Math.round(row.p50LatencyMs)} | ${Math.round(row.p95LatencyMs)} | ` +
          `${row.avgTokensPerSecond.toFixed(1)} | ${lastUsed}`
        );
      }
      break;
    }

    case 'cache': {
      const clear = args.includes('--clear') || args.includes('clear');
      const cache = new ResponseCache({
        enabled: true,
        ttlMs: config.cache_ttl_ms ?? 300000,
        maxEntries: config.cache_max_entries ?? 100,
        directory: config.cache_directory,
      });

      if (clear) {
        await cache.clear();
        console.log('✅ Response cache cleared.');
        break;
      }

      const stats = await cache.getStats();
      console.log('Response Cache');
      console.log('--------------');
      console.log(`Directory: ${stats.directory}`);
      console.log(`Entries:   ${stats.entries}`);
      console.log(`Size:      ${(stats.bytes / 1024).toFixed(1)} KB`);
      break;
    }

    case 'serve': {
      const isMcp = args.includes('--mcp');
      const isOpenAI = args.includes('--openai');
      if (isMcp) {
        // Start MCP server
        const { startMcpServer } = await import('./mcp-server.js');
        await startMcpServer();
      } else if (isOpenAI) {
        const portFlagIndex = args.indexOf('--port');
        const portValue = portFlagIndex >= 0 ? Number(args[portFlagIndex + 1]) : undefined;
        const apiKeyFlagIndex = args.indexOf('--api-key');
        const apiKeyValue = apiKeyFlagIndex >= 0 ? args[apiKeyFlagIndex + 1] : undefined;
        if (portValue !== undefined && (!Number.isInteger(portValue) || portValue <= 0 || portValue > 65535)) {
          console.error('Invalid --port value. Use an integer between 1 and 65535.');
          process.exit(1);
        }
        if (apiKeyFlagIndex >= 0 && (!apiKeyValue || apiKeyValue.startsWith('--'))) {
          console.error('Invalid --api-key value. Provide a non-empty key.');
          process.exit(1);
        }

        const { startOpenAIProxy } = await import('./openai-proxy.js');
        await startOpenAIProxy({
          port: portValue,
          apiKey: apiKeyValue,
        });
      } else {
        console.error('Unknown serve mode. Use --mcp or --openai.');
        console.log('Examples: puter-auth serve --mcp | puter-auth serve --openai --port 11434');
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
