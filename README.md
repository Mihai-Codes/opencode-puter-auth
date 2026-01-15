# opencode-puter-auth

[![npm version](https://img.shields.io/npm/v/opencode-puter-auth.svg)](https://www.npmjs.com/package/opencode-puter-auth)
[![CI](https://github.com/Mihai-Codes/opencode-puter-auth/actions/workflows/ci.yml/badge.svg)](https://github.com/Mihai-Codes/opencode-puter-auth/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/chindrismihai)

> **FREE, UNLIMITED access to Claude Opus 4.5, Sonnet 4.5, GPT-5, Gemini, and 500+ AI models** through Puter.com's revolutionary "User-Pays" model.

Enable OpenCode to authenticate with [Puter.com](https://puter.com) via OAuth, giving you unlimited access to the world's best AI coding models - **completely free**.

## What You Get

- **FREE, UNLIMITED Claude Opus 4.5** - The best coding AI model available
- **FREE, UNLIMITED Claude Sonnet 4.5** - Fast, powerful reasoning
- **FREE, UNLIMITED GPT-5.2, o3-mini** - OpenAI's latest models
- **FREE, UNLIMITED Gemini 2.5 Pro** - 1M context window
- **500+ More Models** - DeepSeek, Mistral, Llama, and more
- **No Rate Limits** - Puter's "User-Pays" model means truly unlimited usage
- **Real-time SSE Streaming** - Full streaming support
- **Tool Calling** - Native function calling support
- **Vision Support** - Image analysis capabilities

## How It Works

Puter.com uses the innovative **"User-Pays" model**:

1. **You (the developer)** pay nothing for infrastructure
2. **Users** cover their own AI usage costs through their Puter account
3. **For personal use**, you ARE the user - so it's FREE for you!

This means whether you have 1 or 1 million users, you pay $0 for AI infrastructure.

## Installation

### Option A: Let an LLM do it (Easiest)

Paste this into any LLM agent (Claude Code, OpenCode, Cursor, etc.):

```
Install the opencode-puter-auth plugin and configure Puter.com models 
in ~/.config/opencode/opencode.json by following:
https://raw.githubusercontent.com/Mihai-Codes/opencode-puter-auth/main/README.md
```

### Option B: Manual Setup

1. **Add the plugin to your config** (`~/.config/opencode/opencode.json`):

```json
{
  "plugin": ["opencode-puter-auth"]
}
```

2. **Authenticate with Puter (Manual Setup):**

Since OpenCode's plugin auth system is still being integrated, use manual authentication:

```bash
# The plugin will auto-create a temp account on first use
# Or manually authenticate:
node -e "const {PuterAuthManager}=require('opencode-puter-auth');const m=new PuterAuthManager(require('os').homedir()+'/.config/opencode');m.init().then(()=>m.login())"
```

3. **Add model definitions:**

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-puter-auth"],
  "provider": {
    "puter": {
      "models": {
        "claude-opus-4-5": {
          "name": "Claude Opus 4.5 (FREE via Puter)",
          "limit": { "context": 200000, "output": 64000 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] }
        },
        "claude-sonnet-4-5": {
          "name": "Claude Sonnet 4.5 (FREE via Puter)",
          "limit": { "context": 200000, "output": 64000 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] }
        },
        "claude-sonnet-4": {
          "name": "Claude Sonnet 4 (FREE via Puter)",
          "limit": { "context": 200000, "output": 64000 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] }
        },
        "claude-haiku-4-5": {
          "name": "Claude Haiku 4.5 (FREE via Puter - Fast)",
          "limit": { "context": 200000, "output": 64000 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] }
        },
        "gpt-5.2": {
          "name": "GPT-5.2 (FREE via Puter)",
          "limit": { "context": 128000, "output": 32768 },
          "modalities": { "input": ["text", "image"], "output": ["text"] }
        },
        "gpt-5-nano": {
          "name": "GPT-5 Nano (FREE via Puter - Fast)",
          "limit": { "context": 128000, "output": 16384 },
          "modalities": { "input": ["text", "image"], "output": ["text"] }
        },
        "o3-mini": {
          "name": "o3-mini (FREE via Puter)",
          "limit": { "context": 128000, "output": 32768 },
          "modalities": { "input": ["text"], "output": ["text"] }
        },
        "gemini-2.5-pro": {
          "name": "Gemini 2.5 Pro (FREE via Puter - 1M Context)",
          "limit": { "context": 1000000, "output": 65536 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] }
        },
        "gemini-2.5-flash": {
          "name": "Gemini 2.5 Flash (FREE via Puter)",
          "limit": { "context": 1000000, "output": 65536 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] }
        }
      }
    }
  }
}
```

4. **Use it:**

```bash
opencode run "Hello" --model=puter/claude-opus-4-5
```

## Available Models

### Anthropic (Claude)

| Model | Description | Context | Best For |
|-------|-------------|---------|----------|
| `puter/claude-opus-4-5` | Most capable Claude model | 200K | Complex reasoning, coding |
| `puter/claude-sonnet-4-5` | Balanced performance | 200K | General coding tasks |
| `puter/claude-sonnet-4` | Previous gen Sonnet | 200K | Fast coding |
| `puter/claude-haiku-4-5` | Fastest Claude | 200K | Simple tasks |

### OpenAI (GPT)

| Model | Description | Context | Best For |
|-------|-------------|---------|----------|
| `puter/gpt-5.2` | Latest GPT model | 128K | Advanced tasks |
| `puter/gpt-5-nano` | Ultra-fast GPT | 128K | Quick responses |
| `puter/o3-mini` | Reasoning model | 128K | Complex logic |
| `puter/gpt-4o` | Multimodal GPT | 128K | Vision tasks |

### Google (Gemini)

| Model | Description | Context | Best For |
|-------|-------------|---------|----------|
| `puter/gemini-2.5-pro` | Best Gemini | 1M | Huge context |
| `puter/gemini-2.5-flash` | Fast Gemini | 1M | Quick analysis |

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
  "max_retries": 3
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `quiet_mode` | `false` | Suppress status messages |
| `debug` | `false` | Enable debug logging |
| `api_timeout_ms` | `120000` | Request timeout (2 min) |
| `auto_create_temp_user` | `true` | Auto-create temp account |
| `max_retries` | `3` | Retry failed requests |

## Custom Tools

The plugin adds these tools to OpenCode:

- **`puter-models`** - List all available Puter models
- **`puter-account`** - Show current account info

## Comparison: Puter vs Antigravity

| Feature | Puter | Antigravity |
|---------|-------|-------------|
| **Cost** | FREE | FREE |
| **Rate Limits** | **NONE** | Weekly quotas |
| **Claude Opus 4.5** | ✅ Unlimited | ✅ Limited |
| **Claude Sonnet 4.5** | ✅ Unlimited | ✅ Limited |
| **GPT-5** | ✅ Unlimited | ❌ No |
| **Gemini 3** | ❌ No | ✅ Limited |
| **Multi-Account** | N/A (unlimited) | Required for quota |
| **Auth Method** | Puter OAuth | Google OAuth |

**Bottom line**: Use Puter for unlimited Claude/GPT access, Antigravity for Gemini 3.

## Troubleshooting

### Browser doesn't open for auth

```bash
# Manually visit:
http://localhost:19847
```

### "Not authenticated" error

```bash
opencode auth login
# Select "Puter.com (FREE Unlimited)"
```

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
[![All Contributors](https://img.shields.io/badge/all_contributors-1-orange.svg?style=flat-square)](#contributors)
<!-- ALL-CONTRIBUTORS-BADGE:END -->

Thanks to these wonderful people:

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/chindris-mihai-alexandru"><img src="https://avatars.githubusercontent.com/u/12643176?v=4?s=100" width="100px;" alt="Mihai Chindris"/><br /><sub><b>Mihai Chindris</b></sub></a><br /><a href="#code-chindris-mihai-alexandru" title="Code">💻</a> <a href="#doc-chindris-mihai-alexandru" title="Documentation">📖</a> <a href="#maintenance-chindris-mihai-alexandru" title="Maintenance">🚧</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

## Support the Project

If this plugin helps you, consider supporting its development:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/chindrismihai)

## Credits

- [Puter.com](https://puter.com) - The amazing "Internet Computer" platform
- [OpenCode](https://opencode.ai) - The best AI coding agent
- [opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth) - Inspiration for plugin architecture

## License

MIT - See [LICENSE](LICENSE)

---

**Made with ❤️ by [@chindris-mihai-alexandru](https://github.com/chindris-mihai-alexandru)**
