#!/usr/bin/env node

import { spawn } from 'node:child_process';

const DEFAULT_PORT = 11888;
const STARTUP_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 250;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getEnvInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error(`Invalid ${name}: ${raw}`);
  }
  return n;
}

async function waitForHealth(baseUrl, headers) {
  const start = Date.now();

  while (Date.now() - start < STARTUP_TIMEOUT_MS) {
    try {
      const response = await fetch(`${baseUrl}/health`, { headers });
      if (response.ok) return;
    } catch {
      // Server not ready yet.
    }
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for ${baseUrl}/health`);
}

async function main() {
  const port = getEnvInt('PUTER_OPENAI_PROXY_PORT', DEFAULT_PORT);
  const apiKey = process.env.PUTER_OPENAI_PROXY_API_KEY;
  const baseUrl = `http://127.0.0.1:${port}`;

  const cliArgs = ['dist/cli.js', 'serve', '--openai', '--port', String(port)];
  if (apiKey) {
    cliArgs.push('--api-key', apiKey);
  }

  const child = spawn('node', cliArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  let settled = false;
  const cleanup = () => {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));

  try {
    const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;

    await waitForHealth(baseUrl, headers);
    console.log(`[smoke] health check passed: ${baseUrl}/health`);

    const modelsResponse = await fetch(`${baseUrl}/v1/models`, { headers });
    const modelsBody = await modelsResponse.json().catch(() => ({}));

    if (modelsResponse.status === 401) {
      const msg = modelsBody?.error?.message || 'Unauthorized';
      throw new Error(`${msg} (hint: run \`npx opencode-puter-auth login\`)`);
    }

    if (!modelsResponse.ok) {
      throw new Error(`Models endpoint failed (${modelsResponse.status}): ${JSON.stringify(modelsBody)}`);
    }

    if (modelsBody.object !== 'list' || !Array.isArray(modelsBody.data)) {
      throw new Error(`Unexpected /v1/models payload: ${JSON.stringify(modelsBody)}`);
    }

    if (modelsBody.data.length === 0) {
      throw new Error('/v1/models returned an empty data array');
    }

    console.log(`[smoke] model check passed: ${modelsBody.data.length} models`);
    console.log('[smoke] OpenAI proxy smoke test passed');
    settled = true;
  } finally {
    cleanup();
    await new Promise((resolve) => {
      child.once('exit', () => resolve());
      setTimeout(() => resolve(), 1000);
    });
    process.off('SIGINT', cleanup);
    process.off('SIGTERM', cleanup);
  }

  if (!settled) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`[smoke] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
