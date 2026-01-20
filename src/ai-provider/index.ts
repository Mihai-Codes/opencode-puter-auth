/**
 * Puter AI SDK Provider
 * 
 * This module exports the Puter provider for use with the Vercel AI SDK.
 * It enables FREE, UNLIMITED access to Claude Opus 4.5, Sonnet 4.5, GPT-5,
 * Gemini, and 500+ AI models through Puter.com's "User-Pays" model.
 * 
 * @example
 * ```typescript
 * import { createPuter, puter } from 'opencode-puter-auth/ai-provider';
 * 
 * // Create a custom provider instance
 * const myPuter = createPuter({
 *   authToken: 'your-puter-auth-token',
 * });
 * 
 * // Use the model
 * const model = myPuter('claude-opus-4-5');
 * 
 * // Or use the default provider (requires PUTER_AUTH_TOKEN env var)
 * const defaultModel = puter('claude-opus-4-5');
 * ```
 */

// Provider exports
export { createPuter, puter } from './puter-provider.js';
// Default export is the lazy-loaded puter provider instance
// OpenCode calls sdk.languageModel(modelId) on the default export,
// so we export the puter instance (not createPuter factory)
export { puter as default } from './puter-provider.js';
export type { PuterProvider } from './puter-provider.js';

// Model exports
export { PuterChatLanguageModel } from './puter-chat-language-model.js';

// Settings exports - only types, no classes
export type {
  PuterChatSettings,
  PuterProviderConfig,
  PuterChatConfig,
} from './puter-chat-settings.js';
