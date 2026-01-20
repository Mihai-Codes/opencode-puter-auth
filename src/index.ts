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
 * 
 * IMPORTANT: OpenCode's plugin loader iterates through ALL exports and calls them as functions.
 * This means we can ONLY export functions from the main entry point - no classes, no constants,
 * no objects. Exporting non-functions causes errors like:
 * - Classes: "cannot call class constructor without new"
 * - Constants: "fn3 is not a function (fn3 is 300000)"
 * 
 * Users needing other exports (FallbackManager, AccountRotationManager, logger utilities, etc.)
 * should import from submodules:
 * - import { FallbackManager } from 'opencode-puter-auth/fallback'
 * - import { AccountRotationManager } from 'opencode-puter-auth/account-rotation'
 * - import { createLogger } from 'opencode-puter-auth/logger'
 */

// Named export - the plugin function for OpenCode
export { PuterAuthPlugin } from './plugin.js';

// Default export for OpenCode plugin loader AND AI SDK provider
// OpenCode calls sdk.languageModel(modelId) on the default export
export { default } from './ai-provider/index.js';

// AI SDK Provider exports - ONLY functions
export { createPuter, puter } from './ai-provider/index.js';

// Type exports are fine - they're compile-time only and don't exist at runtime
export type { PuterProvider, PuterChatSettings, PuterProviderConfig, PuterChatConfig } from './ai-provider/index.js';
export type { Logger, LoggerOptions } from './logger.js';
export type { FallbackOptions, FallbackResult, FallbackAttempt } from './fallback.js';
export type { AccountRotationOptions, AccountRotationResult, AccountStatus, IAuthManager } from './account-rotation.js';
export type { PuterConfig, PuterAccount, PuterChatOptions, PuterChatResponse, PuterChatMessage, PuterChatStreamChunk, PuterModelInfo } from './types.js';
