/**
 * Puter AI SDK Provider
 * 
 * Factory function for creating Puter language models compatible with the AI SDK.
 * This enables Puter.com's FREE AI models to work as a proper provider in OpenCode.
 * 
 * Note: We use ProviderV2 because OpenCode's AI SDK 5.x only supports LanguageModelV2.
 */

import type { ProviderV2 } from '@ai-sdk/provider';
import { generateId, withoutTrailingSlash } from '@ai-sdk/provider-utils';
import { PuterChatLanguageModel } from './puter-chat-language-model.js';
import type { PuterChatSettings, PuterProviderConfig, PuterChatConfig } from './puter-chat-settings.js';

/**
 * Puter provider interface extending ProviderV2.
 * Note: We use V2 because OpenCode's AI SDK 5.x only supports LanguageModelV2.
 */
export interface PuterProvider extends ProviderV2 {
  /**
   * Create a Puter chat language model.
   * @param modelId - The model ID (e.g., 'claude-opus-4-5', 'gpt-4o')
   * @param settings - Optional model settings
   */
  (modelId: string, settings?: PuterChatSettings): PuterChatLanguageModel;

  /**
   * Create a Puter chat language model.
   * @param modelId - The model ID (e.g., 'claude-opus-4-5', 'gpt-4o')
   * @param settings - Optional model settings
   */
  languageModel(modelId: string, settings?: PuterChatSettings): PuterChatLanguageModel;

  /**
   * Create a Puter chat language model (alias for languageModel).
   * @param modelId - The model ID
   * @param settings - Optional model settings
   */
  chat(modelId: string, settings?: PuterChatSettings): PuterChatLanguageModel;
}

/**
 * Default Puter API base URL.
 */
const DEFAULT_BASE_URL = 'https://api.puter.com';

/**
 * Default request timeout in milliseconds.
 */
const DEFAULT_TIMEOUT = 120000;

/**
 * Create a Puter provider instance.
 * 
 * @param options - Provider configuration options
 * @returns A Puter provider instance
 * 
 * @example
 * ```typescript
 * import { createPuter } from 'opencode-puter-auth';
 * 
 * const puter = createPuter({
 *   authToken: 'your-puter-auth-token',
 * });
 * 
 * const model = puter('claude-opus-4-5');
 * ```
 */
export function createPuter(options: PuterProviderConfig = {}): PuterProvider {
  // Support both authToken and apiKey (OpenCode uses apiKey)
  const authToken = options.authToken || options.apiKey;
  
  const baseURL = withoutTrailingSlash(options.baseURL) ?? DEFAULT_BASE_URL;
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const fetchFn = options.fetch ?? globalThis.fetch;
  const generateIdFn = options.generateId ?? generateId;

  /**
   * Get auth token dynamically - either from options or from auth file.
   * This allows OpenCode to use the plugin's auth system.
   */
  const getAuthToken = async (): Promise<string | undefined> => {
    if (authToken) {
      return authToken;
    }

    // Try to load from OpenCode's config directory
    try {
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs/promises');
      
      const configDir = path.join(os.homedir(), '.config', 'opencode');
      const authFile = path.join(configDir, 'puter-accounts.json');
      
      const authData = JSON.parse(await fs.readFile(authFile, 'utf-8'));
      const activeAccount = authData.accounts?.[authData.activeIndex];
      return activeAccount?.authToken;
    } catch {
      return undefined;
    }
  };

  /**
   * Get headers for API requests.
   */
  const getHeaders = async (): Promise<Record<string, string>> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Get auth token dynamically
    const token = await getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Add custom headers
    if (options.headers) {
      Object.assign(headers, options.headers);
    }

    return headers;
  };

  /**
   * Create a chat language model configuration.
   */
  const createChatConfig = (): PuterChatConfig => ({
    provider: 'puter',
    baseURL,
    timeout,
    headers: getHeaders,
    fetch: fetchFn,
    generateId: generateIdFn,
    fallback: options.fallback,
  });

  /**
   * Create a chat language model.
   */
  const createChatModel = (
    modelId: string,
    settings: PuterChatSettings = {}
  ): PuterChatLanguageModel => {
    return new PuterChatLanguageModel(modelId, settings, createChatConfig());
  };

  /**
   * Provider function that can be called directly or via methods.
   */
  const provider = function (
    modelId: string,
    settings?: PuterChatSettings
  ): PuterChatLanguageModel {
    if (new.target) {
      throw new Error(
        'The Puter provider function cannot be called with the new keyword.'
      );
    }
    return createChatModel(modelId, settings);
  };

  // Add methods to the provider function
  provider.languageModel = createChatModel;
  provider.chat = createChatModel;

  // ProviderV2 specification version
  (provider as any).specificationVersion = 'v2';

  // Puter only supports chat models, throw for unsupported types
  (provider as any).embeddingModel = () => {
    throw new Error('Puter does not support embedding models');
  };

  (provider as any).imageModel = () => {
    throw new Error('Puter does not support image models');
  };

  return provider as PuterProvider;
}

/**
 * Lazy-loaded default Puter provider instance.
 * 
 * This provider is only instantiated when actually used, avoiding errors
 * when the PUTER_AUTH_TOKEN environment variable is not set at import time.
 * 
 * Note: Requires the PUTER_AUTH_TOKEN environment variable to be set when used.
 * 
 * @example
 * ```typescript
 * import { puter } from 'opencode-puter-auth';
 * 
 * // Requires PUTER_AUTH_TOKEN environment variable
 * const model = puter('claude-opus-4-5');
 * ```
 */
let _puterInstance: PuterProvider | null = null;

function getPuterInstance(): PuterProvider {
  if (!_puterInstance) {
    // Check for auth token in environment variable first
    const authToken = process.env.PUTER_AUTH_TOKEN;
    
    // Create the provider - it will dynamically load auth from:
    // 1. The authToken passed here (from env var)
    // 2. The config file (~/.config/opencode/puter-accounts.json) if no authToken
    // This allows OpenCode's auth.loader to inject the token dynamically
    _puterInstance = createPuter({ authToken });
  }
  return _puterInstance;
}

/**
 * Default Puter provider (lazy-loaded).
 * 
 * This is a proxy that lazily creates the provider when first accessed.
 * It requires the PUTER_AUTH_TOKEN environment variable to be set.
 * 
 * IMPORTANT: OpenCode's plugin loader iterates through exports and may try to access
 * properties like `.config` expecting a function. We must explicitly return undefined
 * for properties that aren't part of the ProviderV3 interface to avoid leaking
 * internal properties from the underlying provider.
 */
export const puter: PuterProvider = new Proxy(
  function() {} as unknown as PuterProvider,
  {
    apply(_target, _thisArg, args: [string, PuterChatSettings?]) {
      return getPuterInstance()(...args);
    },
    get(_target, prop) {
      // ProviderV3 interface methods
      if (prop === 'languageModel' || prop === 'chat') {
        return (...args: [string, PuterChatSettings?]) => 
          getPuterInstance()[prop](...args);
      }
      if (prop === 'specificationVersion') {
        return 'v2';
      }
      if (prop === 'embeddingModel' || prop === 'imageModel') {
        return () => {
          throw new Error(`Puter does not support ${String(prop).replace('Model', '')} models`);
        };
      }
      
      // OpenCode plugin loader checks for these - return undefined to avoid errors
      // The loader expects hooks to have .config() method but we're not a hook
      if (prop === 'config' || prop === 'event' || prop === 'auth' || prop === 'tool') {
        return undefined;
      }
      
      // Standard function/object properties that should work normally
      if (prop === 'name' || prop === 'length' || prop === 'prototype' || 
          prop === 'call' || prop === 'apply' || prop === 'bind' ||
          prop === Symbol.toStringTag || prop === Symbol.iterator ||
          prop === 'then' || prop === 'catch' || prop === 'finally') {
        return undefined;
      }
      
      // For any other property, return undefined rather than leaking internal state
      // This prevents errors when OpenCode iterates through exports
      return undefined;
    },
  }
);
