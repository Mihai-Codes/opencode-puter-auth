/**
 * opencode-puter-auth - Puter.com OAuth Plugin for OpenCode
 * 
 * Provides access to Claude Opus 4.5, Sonnet 4.5, GPT-5, Gemini,
 * and 500+ AI models through Puter.com's "User-Pays" model.
 * Free tier available with undocumented limits.
 * 
 * Features automatic model fallback when rate limits are encountered.
 * 
 * @author chindris-mihai-alexandru
 * @license MIT
 */

// Named export - the plugin function for OpenCode
// IMPORTANT: Only export the plugin function, not classes!
// OpenCode's plugin loader calls all exports as functions, so exporting
// classes (PuterClient, PuterAuthManager) causes "cannot call class without new" errors.
// Using plugin.js (not plugin-simple.js) for full OAuth support - see Issue #13
export { PuterAuthPlugin } from './plugin.js';

// Default export for OpenCode plugin loader AND AI SDK provider
// OpenCode calls sdk.languageModel(modelId) on the default export,
// so we export the puter provider instance (not createPuter factory)
export { default } from './ai-provider/index.js';

// AI SDK Provider exports
export { createPuter, puter } from './ai-provider/index.js';
export type { PuterProvider, PuterChatSettings, PuterProviderConfig, PuterChatConfig } from './ai-provider/index.js';

// Logger exports for debug mode
// NOTE: createLogger and createLoggerFromConfig are NOT exported from main entry point
// because OpenCode's provider loader finds exports starting with "create" and calls them.
// It would find createLogger before createPuter alphabetically, causing errors.
// Users needing direct logger access can import from the logger module directly.
export { nullLogger, LogLevel } from './logger.js';
export type { Logger, LoggerOptions } from './logger.js';

// Fallback Manager exports for automatic model fallback
export { 
  FallbackManager, 
  getGlobalFallbackManager, 
  resetGlobalFallbackManager,
  isRateLimitError,
  FallbackExhaustedError,
  DEFAULT_FALLBACK_MODELS,
  DEFAULT_COOLDOWN_MS,
} from './fallback.js';
export type { 
  FallbackOptions, 
  FallbackResult, 
  FallbackAttempt,
} from './fallback.js';

// Account Rotation Manager exports for multi-account support
export {
  AccountRotationManager,
  getGlobalAccountRotationManager,
  resetGlobalAccountRotationManager,
  AllAccountsOnCooldownError,
  DEFAULT_ACCOUNT_COOLDOWN_MS,
} from './account-rotation.js';
export type {
  AccountRotationOptions,
  AccountRotationResult,
  AccountStatus,
  IAuthManager,
} from './account-rotation.js';

// Type exports for TypeScript users (these don't cause runtime issues)
export type { PuterConfig, PuterAccount, PuterChatOptions, PuterChatResponse, PuterChatMessage, PuterChatStreamChunk, PuterModelInfo } from './types.js';

