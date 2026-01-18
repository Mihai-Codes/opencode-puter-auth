# opencode-puter-auth

[![npm version](https://img.shields.io/npm/v/opencode-puter-auth.svg)](https://www.npmjs.com/package/opencode-puter-auth)
[![CI](https://github.com/Mihai-Codes/opencode-puter-auth/actions/workflows/ci.yml/badge.svg)](https://github.com/Mihai-Codes/opencode-puter-auth/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/chindrismihai)

> Access Claude Opus 4.5, Sonnet 4.5, GPT-5, Gemini, DeepSeek, and 500+ AI models through Puter.com OAuth. Includes 400+ FREE OpenRouter models. No API keys needed - free tier available with undocumented limits.

Enable OpenCode to authenticate with [Puter.com](https://puter.com) via OAuth, giving you access to premium AI models through your Puter account. Ideal for app developers using the "User-Pays" model where each user covers their own AI costs.

## What You Get

- **Claude Opus 4.5, Sonnet 4.5** - Best coding AI models
- **GPT-5.2, o3-mini, o4-mini** - OpenAI's latest models
- **Gemini 2.5 Pro** - 1M context window
- **DeepSeek R1** - Advanced reasoning model
- **500+ More Models** - Mistral, Llama, Grok, and more
- **400+ FREE OpenRouter Models** - Including MiMo-V2-Flash (#1 on SWE-bench), Qwen3 Coder, and GPT-OSS
- **Real-time SSE Streaming** - Full streaming support
- **Tool Calling** - Native function calling support
- **Vision Support** - Image analysis capabilities

## How It Works

Puter.com uses a **"User-Pays" model**:

1. **No API keys** - Just sign in with your Puter account
2. **Users pay their own usage** - Each Puter account has its own credit allocation
3. **Free tier available** - New accounts get free credits to start
4. **Credits run out** - When exhausted, you pay Puter directly or create a new account

> **Important Reality Check:** Puter's marketing says "Free, Unlimited" but this is misleading. In practice:
> - Free tier limits exist but are **undocumented** ([GitHub Issue #1704](https://github.com/HeyPuter/puter/issues/1704))
> - Users report limits trigger after "minimal usage" ([GitHub Issue #1291](https://github.com/HeyPuter/puter/issues/1291))
> - When limits hit, you'll see: `"usage-limited-chat": Permission denied`

## Understanding the "User-Pays" Model

### For App Developers (Building apps for others)
**Great fit!** Your infrastructure cost is $0. Each of YOUR users authenticates with their OWN Puter account and pays for their own AI usage.

### For Personal/Development Use (Using it yourself)
**Caution:** When YOU use this plugin during development, YOU are the user. YOUR Puter account's free tier gets consumed. Based on community reports, the free tier is limited and undocumented.

### Free Tier Reality

| Aspect | What Puter Claims | What Actually Happens |
|--------|-------------------|----------------------|
| **Pricing** | "Free, Unlimited" | Free tier exists but has limits |
| **Limits** | "No usage restrictions" | Undocumented limits trigger unexpectedly |
| **Documentation** | Not specified | Limits are not publicly documented |
| **When exceeded** | Not mentioned | Error: `usage-limited-chat: Permission denied` |

**Estimated free tier:** ~100 requests/day (unconfirmed, based on third-party reports)

## Installation

### Option A: Let an LLM do it (Easiest)

Paste this into any LLM agent (Claude Code, OpenCode, Cursor, etc.):

```
Install the opencode-puter-auth plugin and configure Puter.com models
in ~/.config/opencode/opencode.json by following:
https://raw.githubusercontent.com/Mihai-Codes/opencode-puter-auth/main/README.md
```

### Option B: Manual Setup

1. **Add the complete configuration to your opencode.json** (`~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-puter-auth"],
  "provider": {
    "puter": {
      "npm": "opencode-puter-auth",
      "name": "Puter.com (500+ AI Models)",
      "models": {
        "claude-opus-4-5": {
          "name": "Claude Opus 4.5 (via Puter)",
          "limit": { "context": 200000, "output": 64000 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] }
        },
        "claude-sonnet-4-5": {
          "name": "Claude Sonnet 4.5 (via Puter)",
          "limit": { "context": 200000, "output": 64000 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] }
        },
        "claude-sonnet-4": {
          "name": "Claude Sonnet 4 (via Puter)",
          "limit": { "context": 200000, "output": 64000 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] }
        },
        "claude-haiku-4-5": {
          "name": "Claude Haiku 4.5 (via Puter - Fast)",
          "limit": { "context": 200000, "output": 64000 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] }
        },
        "gpt-5.2": {
          "name": "GPT-5.2 (via Puter)",
          "limit": { "context": 128000, "output": 32768 },
          "modalities": { "input": ["text", "image"], "output": ["text"] }
        },
        "gpt-4.1-nano": {
          "name": "GPT-4.1 Nano (via Puter - Ultra Fast)",
          "limit": { "context": 128000, "output": 16384 },
          "modalities": { "input": ["text", "image"], "output": ["text"] }
        },
        "gpt-4o": {
          "name": "GPT-4o (via Puter)",
          "limit": { "context": 128000, "output": 16384 },
          "modalities": { "input": ["text", "image"], "output": ["text"] }
        },
        "o3-mini": {
          "name": "o3-mini (via Puter - Reasoning)",
          "limit": { "context": 128000, "output": 32768 },
          "modalities": { "input": ["text"], "output": ["text"] }
        },
        "o4-mini": {
          "name": "o4-mini (via Puter - Reasoning)",
          "limit": { "context": 128000, "output": 32768 },
          "modalities": { "input": ["text"], "output": ["text"] }
        },
        "deepseek-r1": {
          "name": "DeepSeek R1 (via Puter - Reasoning)",
          "limit": { "context": 128000, "output": 32768 },
          "modalities": { "input": ["text"], "output": ["text"] }
        },
        "google/gemini-2.5-pro": {
          "name": "Gemini 2.5 Pro (via Puter - 1M Context)",
          "limit": { "context": 1000000, "output": 65536 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] }
        },
        "google/gemini-2.5-flash": {
          "name": "Gemini 2.5 Flash (via Puter)",
          "limit": { "context": 1000000, "output": 65536 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] }
        }
      }
    }
  }
}
```

2. **Authenticate with Puter:**

```bash
# Using the included CLI
npx opencode-puter-auth login

# Or if you have the plugin installed globally
puter-auth login
```

This opens a browser window for Puter.com login. Enter your Puter username and password.

> **Note:** Puter is a custom provider, so it won't appear in `opencode auth login`. Use the CLI above to authenticate.

3. **Verify authentication:**

```bash
puter-auth status
# Or: npx opencode-puter-auth status
```

4. **Use it:**

```bash
opencode --model=puter/claude-opus-4-5
```

## Available Models (January 2026)

### Anthropic (Claude) - Best for Coding

| Model | Description | Context | Best For |
|-------|-------------|---------|----------|
| `puter/claude-opus-4-5` | **Best coding model in the world** | 200K | Complex reasoning, agentic coding |
| `puter/claude-sonnet-4-5` | Balanced performance | 200K | General coding tasks |
| `puter/claude-sonnet-4` | Previous gen Sonnet | 200K | Fast coding |
| `puter/claude-haiku-4-5` | Fastest Claude | 200K | Simple tasks, quick responses |

### OpenAI (GPT) - Latest Models

| Model | Description | Context | Best For |
|-------|-------------|---------|----------|
| `puter/gpt-5.2` | Latest GPT model | 128K | Advanced tasks |
| `puter/gpt-4.1-nano` | Ultra-fast | 128K | Quick responses |
| `puter/gpt-4o` | Multimodal GPT | 128K | Vision tasks |
| `puter/o3-mini` | Reasoning model | 128K | Complex logic |
| `puter/o4-mini` | Latest reasoning model | 128K | Advanced reasoning |

### Google (Gemini) - Massive Context

| Model | Description | Context | Best For |
|-------|-------------|---------|----------|
| `puter/google/gemini-2.5-pro` | Best Gemini | 1M | Huge codebases |
| `puter/google/gemini-2.5-flash` | Fast Gemini | 1M | Quick analysis |

### DeepSeek - Advanced Reasoning

| Model | Description | Context | Best For |
|-------|-------------|---------|----------|
| `puter/deepseek-r1` | Advanced reasoning | 128K | Complex problem solving |

## OpenRouter Models (400+ Free Models via Puter)

Puter acts as a gateway to **OpenRouter**, giving you access to 400+ additional models. Many of these have FREE tiers (`:free` suffix) with more generous limits than premium models.

### How It Works

Use the `openrouter:` prefix to access any OpenRouter model through Puter:

```bash
# Format: puter/openrouter:provider/model-name
opencode --model=puter/openrouter:deepseek/deepseek-r1-0528:free
```

### Configuration for OpenRouter Models

Add these to your `opencode.json` models section:

```json
{
  "provider": {
    "puter": {
      "npm": "opencode-puter-auth",
      "name": "Puter.com (500+ AI Models)",
      "models": {
        "openrouter:xiaomi/mimo-v2-flash:free": {
          "name": "MiMo-V2-Flash (Free - Best Open Source)",
          "limit": { "context": 262000, "output": 32768 },
          "modalities": { "input": ["text"], "output": ["text"] }
        },
        "openrouter:mistralai/devstral-2512:free": {
          "name": "Devstral 2 (Free - Agentic Coding)",
          "limit": { "context": 262000, "output": 32768 },
          "modalities": { "input": ["text"], "output": ["text"] }
        },
        "openrouter:deepseek/deepseek-r1-0528:free": {
          "name": "DeepSeek R1 0528 (Free - o1-level Reasoning)",
          "limit": { "context": 164000, "output": 32768 },
          "modalities": { "input": ["text"], "output": ["text"] }
        },
        "openrouter:qwen/qwen3-coder:free": {
          "name": "Qwen3 Coder 480B (Free - Massive Coder)",
          "limit": { "context": 262000, "output": 32768 },
          "modalities": { "input": ["text"], "output": ["text"] }
        },
        "openrouter:meta-llama/llama-3.3-70b-instruct:free": {
          "name": "Llama 3.3 70B (Free - Multilingual)",
          "limit": { "context": 131000, "output": 32768 },
          "modalities": { "input": ["text"], "output": ["text"] }
        },
        "openrouter:google/gemma-3-27b-it:free": {
          "name": "Gemma 3 27B (Free - Multimodal)",
          "limit": { "context": 131000, "output": 32768 },
          "modalities": { "input": ["text", "image"], "output": ["text"] }
        },
        "openrouter:openai/gpt-oss-120b:free": {
          "name": "GPT-OSS 120B (Free - OpenAI Open Weights)",
          "limit": { "context": 131000, "output": 32768 },
          "modalities": { "input": ["text"], "output": ["text"] }
        },
        "openrouter:google/gemini-2.0-flash-exp:free": {
          "name": "Gemini 2.0 Flash Exp (Free - 1M Context)",
          "limit": { "context": 1050000, "output": 65536 },
          "modalities": { "input": ["text", "image"], "output": ["text"] }
        }
      }
    }
  }
}
```

### Top Free OpenRouter Models (January 2026)

These models are completely FREE via Puter's OpenRouter gateway:

| Model | Parameters | Context | Best For |
|-------|------------|---------|----------|
| `puter/openrouter:xiaomi/mimo-v2-flash:free` | 309B MoE | 262K | **#1 on SWE-bench** - Comparable to Claude Sonnet 4.5 |
| `puter/openrouter:mistralai/devstral-2512:free` | 123B | 262K | Agentic coding, multi-file changes |
| `puter/openrouter:deepseek/deepseek-r1-0528:free` | 671B MoE | 164K | o1-level reasoning, fully open-source |
| `puter/openrouter:qwen/qwen3-coder:free` | 480B MoE | 262K | Massive coding model, tool use |
| `puter/openrouter:openai/gpt-oss-120b:free` | 117B MoE | 131K | OpenAI's open-weight model |
| `puter/openrouter:openai/gpt-oss-20b:free` | 21B MoE | 131K | Lightweight, single-GPU deployable |
| `puter/openrouter:meta-llama/llama-3.3-70b-instruct:free` | 70B | 131K | Multilingual, general purpose |
| `puter/openrouter:google/gemma-3-27b-it:free` | 27B | 131K | Vision + 140 languages |
| `puter/openrouter:google/gemini-2.0-flash-exp:free` | - | 1M | Fastest Gemini, huge context |
| `puter/openrouter:nousresearch/hermes-3-llama-3.1-405b:free` | 405B | 131K | Frontier-level, agentic |

### Why Use OpenRouter Models?

1. **More Generous Free Limits** - The `:free` models often have better rate limits than premium Puter models
2. **Open Source** - Many are fully open-source with transparent weights
3. **Specialized** - Models optimized for specific tasks (coding, reasoning, etc.)
4. **Fallback Options** - When premium models are rate-limited, fall back to free alternatives

### Accessing Any OpenRouter Model

You can use ANY model from [OpenRouter's catalog](https://openrouter.ai/models) by adding it to your config:

```json
"openrouter:anthropic/claude-opus-4.5": {
  "name": "Claude Opus 4.5 (via OpenRouter)",
  "limit": { "context": 200000, "output": 64000 },
  "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] }
}
```

Note: Non-free models will consume your Puter credits based on OpenRouter pricing.

## AI SDK Provider (Standalone Usage)

You can also use the Puter AI SDK provider directly in your own applications:

```typescript
import { createPuter } from 'opencode-puter-auth';

// Create a Puter provider instance
const puter = createPuter({
  authToken: 'your-puter-auth-token',
});

// Use with AI SDK
const model = puter('claude-opus-4-5');

// Or use specific methods
const chatModel = puter.chat('claude-sonnet-4-5');
const languageModel = puter.languageModel('gpt-4o');
```

This implements the full AI SDK v3 specification with:
- Non-streaming and streaming generation
- Tool/function calling support
- Reasoning/thinking token support
- Proper finish reason mapping

## Configuration

Create `~/.config/opencode/puter.json` for advanced settings:

```json
{
  "quiet_mode": false,
  "debug": false,
  "api_timeout_ms": 120000,
  "auto_create_temp_user": true,
  "max_retries": 3,
  "cache_ttl_ms": 300000
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `quiet_mode` | `false` | Suppress status messages |
| `debug` | `false` | Enable verbose debug logging (see below) |
| `api_timeout_ms` | `120000` | Request timeout (2 min) |
| `auto_create_temp_user` | `true` | Auto-create temp account |
| `max_retries` | `3` | Retry failed requests |
| `cache_ttl_ms` | `300000` | Model list cache TTL (5 min) |
| `fallback_enabled` | `true` | Enable automatic model fallback on rate limits |
| `fallback_models` | See below | Custom list of fallback models |
| `fallback_cooldown_ms` | `60000` | Cooldown period for rate-limited models (1 min) |
| `account_rotation_enabled` | `true` | Enable automatic account rotation |
| `account_rotation_strategy` | `round-robin` | Strategy: `round-robin` or `least-recently-used` |
| `account_rotation_cooldown_ms` | `300000` | Cooldown for rate-limited accounts (5 min) |

## Automatic Model Fallback

When a model returns HTTP 429 (rate limited) or 403 (forbidden), the plugin automatically tries free OpenRouter models. This keeps your workflow running even when premium models are temporarily unavailable.

### How It Works

1. You request a model (e.g., `claude-opus-4-5`)
2. If that model returns a rate limit error, it goes into "cooldown"
3. The plugin automatically tries the next available free model
4. A warning is logged showing which fallback model was used
5. Your request completes without manual intervention

### Default Fallback Models

When rate limits are hit, these free models are tried in order:

| Priority | Model | Description |
|----------|-------|-------------|
| 1 | `openrouter:xiaomi/mimo-v2-flash:free` | #1 on SWE-bench, Claude Sonnet 4.5 level |
| 2 | `openrouter:deepseek/deepseek-r1-0528:free` | o1-level reasoning |
| 3 | `openrouter:mistralai/devstral-2512:free` | Agentic coding specialist |
| 4 | `openrouter:qwen/qwen3-coder:free` | 480B MoE coding model |
| 5 | `openrouter:google/gemini-2.0-flash-exp:free` | 1M context, fast |
| 6 | `openrouter:meta-llama/llama-4-maverick:free` | General purpose |
| 7 | `openrouter:openai/gpt-oss-120b:free` | OpenAI open weights |

### Configuration

In `~/.config/opencode/puter.json`:

```json
{
  "fallback_enabled": true,
  "fallback_cooldown_ms": 60000,
  "fallback_models": [
    "openrouter:xiaomi/mimo-v2-flash:free",
    "openrouter:deepseek/deepseek-r1-0528:free",
    "openrouter:mistralai/devstral-2512:free"
  ]
}
```

### Disable Fallback

To disable fallback globally:

```json
{
  "fallback_enabled": false
}
```

To disable fallback for a specific request (programmatic usage):

```typescript
import { createPuter } from 'opencode-puter-auth';

const puter = createPuter({ authToken: 'your-token' });
const model = puter('claude-opus-4-5', { disableFallback: true });
```

### Cooldown Behavior

- Rate-limited models are put on cooldown for `fallback_cooldown_ms` (default: 1 minute)
- Models on cooldown are skipped in favor of available models
- Cooldown automatically expires, allowing the model to be retried
- If all models (including fallbacks) are exhausted, the original error is thrown

## Account Rotation (Multi-Account Support)

For even more resilience, you can configure multiple Puter accounts. When one account hits rate limits, the plugin automatically rotates to the next available account.

### How It Works

1. Add multiple Puter accounts using `puter-auth login`
2. When the active account hits a rate limit, it goes into "cooldown"
3. The plugin automatically switches to the next available account
4. Your request continues without interruption
5. Cooldown accounts become available again after the cooldown period

### Adding Multiple Accounts

```bash
# Add your first account
puter-auth login

# Add additional accounts (opens browser for each)
puter-auth login

# View all accounts
puter-auth status
```

### Rotation Strategies

The plugin supports two rotation strategies:

| Strategy | Description | Best For |
|----------|-------------|----------|
| `round-robin` (default) | Cycles through accounts in order | Even distribution |
| `least-recently-used` | Picks the account used longest ago | Maximizing cooldown recovery |

### Configuration

In `~/.config/opencode/puter.json`:

```json
{
  "account_rotation_enabled": true,
  "account_rotation_strategy": "round-robin",
  "account_rotation_cooldown_ms": 300000
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `account_rotation_enabled` | `true` | Enable automatic account rotation |
| `account_rotation_strategy` | `round-robin` | Strategy: `round-robin` or `least-recently-used` |
| `account_rotation_cooldown_ms` | `300000` | Cooldown duration for rate-limited accounts (5 min) |

### Cooldown Behavior

Account cooldowns use exponential backoff:
- First rate limit: 1x cooldown (5 minutes)
- Second consecutive: 2x cooldown (10 minutes)
- Third consecutive: 3x cooldown (15 minutes)
- Fourth+ consecutive: 4x cooldown (20 minutes max)

This prevents hammering accounts that are consistently being rate-limited.

### Fallback vs Rotation

The plugin supports both **model fallback** and **account rotation**, and they work together:

| Feature | Model Fallback | Account Rotation |
|---------|---------------|------------------|
| **Scope** | Different models, same account | Same model, different accounts |
| **Use case** | Premium model unavailable | Account rate-limited |
| **Default cooldown** | 1 minute | 5 minutes |
| **Order of operations** | Tried first | Tried after fallback exhausted |

When a request fails:
1. First, model fallback tries different models on the current account
2. If all models fail, account rotation switches to a different account
3. Model fallback then runs again on the new account

### Programmatic Usage

```typescript
import { 
  AccountRotationManager, 
  getGlobalAccountRotationManager,
  AllAccountsOnCooldownError 
} from 'opencode-puter-auth';

// Get the global rotation manager
const rotation = getGlobalAccountRotationManager(authManager, {
  cooldownMs: 300000,
  strategy: 'least-recently-used',
});

// Check current status
const summary = rotation.getSummary();
console.log(`${summary.availableAccounts}/${summary.totalAccounts} accounts available`);

// Handle rate limit errors
try {
  await makeRequest();
} catch (error) {
  const result = await rotation.handleRateLimitError(error);
  if (result) {
    console.log(`Rotated to account: ${result.account.username}`);
    await makeRequest(); // Retry with new account
  } else {
    throw new AllAccountsOnCooldownError(rotation.getAccountStatuses());
  }
}
```

### Debug Logging

When `debug: true` is set, the plugin outputs detailed logs with timestamps:

```
[puter-auth] 15:30:45 Request: POST /drivers/call method=complete model=claude-opus-4-5 stream=true messages=3
[puter-auth] 15:30:45 Stream connected duration=234ms
[puter-auth] 15:30:47 Response: 200 Stream complete (2.1s)
```

If a request fails and retries:

```
[puter-auth] 15:30:45 Request: POST /drivers/call method=complete model=claude-opus-4-5
[puter-auth] 15:30:45 Retry 1/3: Rate limited (429), waiting 1000ms
[puter-auth] 15:30:46 Retry 2/3: Rate limited (429), waiting 2000ms
[puter-auth] 15:30:48 Response: 200 OK (3.2s)
```

Auth state changes:

```
[puter-auth] 15:30:45 Auth: Account added - username
[puter-auth] 15:30:45 Auth: Switched account - other_user
```

Fallback behavior:

```
[puter-auth] 15:30:45 Request: claude-opus-4-5
[puter-auth] 15:30:45 Rate limited (429), adding to cooldown
[puter-auth] 15:30:45 Fallback: trying openrouter:xiaomi/mimo-v2-flash:free
[puter-auth] 15:30:47 Response: 200 OK (used fallback model)
```

## Custom Tools

The plugin adds these tools to OpenCode:

- **`puter-models`** - List all available Puter models
- **`puter-account`** - Show current account info

## Comparison: Puter vs Antigravity vs Alternatives

| Feature | Puter | Antigravity | Netlify AI Gateway |
|---------|-------|-------------|-------------------|
| **Free Quota** | Undocumented limits | ~300K tokens/day | 300 credits/mo |
| **Limits Documented?** | No | Unofficial | Yes |
| **Claude Opus 4.5** | Yes | Yes | Yes |
| **Claude Sonnet 4.5** | Yes | Yes | Yes |
| **GPT-5** | Yes | No | No |
| **DeepSeek R1** | Yes | No | No |
| **Gemini 3** | No | Yes | No |
| **Best For** | App builders | Dev work | Very light use |

### Recommendations by Use Case

| Use Case | Recommended Provider |
|----------|---------------------|
| **Building apps** (users pay their own usage) | **Puter** |
| **Development/testing** (you are the user) | **Antigravity** (more predictable) |
| **Heavy development work** | Paid API (Anthropic, OpenAI) |
| **Occasional Claude access** | Puter (while free tier lasts) |
| **GPT-5 / DeepSeek access** | **Puter** (only option) |

**Bottom line**: 
- Use **Puter** for building apps where your users authenticate with their own accounts
- Use **Antigravity** for your own development (more predictable ~300K tokens/day)
- Use **Puter** if you specifically need GPT-5 or DeepSeek (not available elsewhere free)

## Migrating from Old Config (v1.0.27 and earlier)

If you were using the old configuration format that piggybacked on Google (`google/puter-*` models), you need to update to the new standalone provider format.

### Old Format (Deprecated)

```json
{
  "plugin": ["opencode-puter-auth"],
  "provider": {
    "google": {
      "models": {
        "puter-claude-opus-4-5": { ... }
      }
    }
  }
}
```

### New Format (v1.0.32+)

```json
{
  "plugin": ["opencode-puter-auth"],
  "provider": {
    "puter": {
      "npm": "opencode-puter-auth",
      "name": "Puter.com (500+ AI Models)",
      "models": {
        "claude-opus-4-5": { ... }
      }
    }
  }
}
```

### Migration Steps

1. **Clear the plugin cache:**
   ```bash
   rm -rf ~/.cache/opencode/node_modules/opencode-puter-auth
   rm -rf ~/.config/opencode/node_modules/opencode-puter-auth
   ```

2. **Update your `opencode.json`:**
   - Change `provider.google.models.puter-*` to `provider.puter.models.*`
   - Add `"npm": "opencode-puter-auth"` to the puter provider section
   - Remove the `puter-` prefix from model names

3. **Update your model references:**
   - Old: `google/puter-claude-opus-4-5`
   - New: `puter/claude-opus-4-5`

4. **Re-authenticate:**
   ```bash
   npx opencode-puter-auth login
   # Or: puter-auth login
   ```

### Why the Change?

The new standalone provider offers:
- **Direct API access** - No routing through Google/Antigravity infrastructure
- **Dedicated CLI** - Use `puter-auth login` for authentication
- **Better reliability** - Direct connection to Puter's API
- **Cleaner model names** - `puter/claude-opus-4-5` instead of `google/puter-claude-opus-4-5`

## Troubleshooting

### "usage-limited-chat: Permission denied" or "You have reached your AI usage limit"

This means your Puter account has exhausted its free tier credits. Despite Puter's "Free Unlimited" marketing, limits do exist.

**Solutions:**
1. **Switch to FREE OpenRouter models** - Use `puter/openrouter:xiaomi/mimo-v2-flash:free` or other `:free` models (see OpenRouter section above)
2. **Wait** - Limits may reset (timing undocumented)
3. **Add credits** on [Puter.com](https://puter.com) (paid)
4. **New account** - Create a new Puter account (new accounts get free credits)
5. **Switch providers** - Use Antigravity, OpenRouter free tier, or other free providers
6. **Use lighter models** - Haiku/Flash models may consume fewer credits than Opus

### Clear cached plugin and reinstall

```bash
# macOS/Linux
rm -rf ~/.cache/opencode/node_modules/opencode-puter-auth
rm -rf ~/.config/opencode/node_modules/opencode-puter-auth

# Windows (PowerShell)
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\opencode\node_modules\opencode-puter-auth" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$env:APPDATA\opencode\node_modules\opencode-puter-auth" -ErrorAction SilentlyContinue

# Restart opencode
opencode
```

### Browser doesn't open for auth

```bash
# Manually visit:
http://localhost:19847
```

### "Not authenticated" error

```bash
npx opencode-puter-auth login
# Or: puter-auth login
```

> **Note:** Puter is a custom provider and won't appear in `opencode auth login`. You must use the plugin's CLI.

### API timeout errors

Increase timeout in `puter.json`:

```json
{
  "api_timeout_ms": 300000
}
```

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Before your first PR can be merged, you'll need to sign our simple Contributor License Agreement (CLA) - just reply to the bot's comment.

### Contributors

<!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
[![All Contributors](https://img.shields.io/badge/all_contributors-3-orange.svg?style=flat-square)](#contributors)
<!-- ALL-CONTRIBUTORS-BADGE:END -->

Thanks to these wonderful people:

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/chindris-mihai-alexandru"><img src="https://avatars.githubusercontent.com/u/12643176?v=4?s=100" width="100px;" alt="Mihai Chindris"/><br /><sub><b>Mihai Chindris</b></sub></a><br /><a href="#code-chindris-mihai-alexandru" title="Code">💻</a> <a href="#doc-chindris-mihai-alexandru" title="Documentation">📖</a> <a href="#maintenance-chindris-mihai-alexandru" title="Maintenance">🚧</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/EldoDebug"><img src="https://avatars.githubusercontent.com/u/75922660?v=4?s=100" width="100px;" alt="EldoDebug"/><br /><sub><b>EldoDebug</b></sub></a><br /><a href="#ideas-EldoDebug" title="Ideas & Feedback">🤔</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/icytz"><img src="https://avatars.githubusercontent.com/u/30925199?v=4?s=100" width="100px;" alt="icytz"/><br /><sub><b>icytz</b></sub></a><br /><a href="#ideas-icytz" title="Ideas & Feedback">🤔</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

## Support the Project

If this plugin helps you, consider supporting its development:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/mihai_chindris)

## Credits

- [Puter.com](https://puter.com) - The amazing "Internet Computer" platform with 500+ AI models
- [OpenCode](https://opencode.ai) - The best AI coding agent
- [OpenRouter](https://openrouter.ai) - Unified API for 400+ AI models with generous free tiers
- [opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth) - Inspiration for plugin architecture
- [opencode-openai-codex-auth](https://github.com/numman-ali/opencode-openai-codex-auth) - Inspiration for installer and configuration patterns

## License

MIT - See [LICENSE](LICENSE)

---

**Made with love by [@chindris-mihai-alexandru](https://github.com/chindris-mihai-alexandru)**
