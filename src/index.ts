/**
 * opencode-puter-auth - Puter.com OAuth Plugin for OpenCode
 * 
 * Provides FREE, UNLIMITED access to Claude Opus 4.5, Sonnet 4.5, GPT-5, Gemini,
 * and 500+ AI models through Puter.com's "User-Pays" model.
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
// OpenCode will use this as the provider factory when npm field is set
export { createPuter as default } from './ai-provider/index.js';

// AI SDK Provider exports
export { createPuter } from './ai-provider/index.js';
export type { PuterProvider, PuterChatSettings, PuterProviderConfig, PuterChatConfig } from './ai-provider/index.js';

// Type exports for TypeScript users (these don't cause runtime issues)
export type { PuterConfig, PuterAccount, PuterChatOptions, PuterChatResponse, PuterChatMessage, PuterChatStreamChunk, PuterModelInfo } from './types.js';

