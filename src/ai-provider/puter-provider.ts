/**
 * Puter AI SDK Provider
 * 
 * Factory function for creating Puter language models compatible with the AI SDK.
 * This enables Puter.com's FREE AI models to work as a proper provider in OpenCode.
 */

import type { ProviderV3 } from '@ai-sdk/provider';
import { generateId, withoutTrailingSlash } from '@ai-sdk/provider-utils';
import { PuterChatLanguageModel } from './puter-chat-language-model.js';
import type { PuterChatSettings, PuterProviderConfig, PuterChatConfig } from './puter-chat-settings.js';

/**
 * Puter provider interface extending ProviderV3.
 */
export interface PuterProvider extends ProviderV3 {
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
   * Get headers for API requests.
   */
  const getHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add auth token if provided
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
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

  // ProviderV3 specification version
  (provider as any).specificationVersion = 'v3';

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
    const authToken = process.env.PUTER_AUTH_TOKEN;
    if (!authToken) {
      // Return a dummy provider that throws helpful errors
      return {
        languageModel: () => {
          throw new Error(
            'PUTER_AUTH_TOKEN environment variable is required for the default puter provider. ' +
            'Either set the environment variable or use createPuter() with an explicit authToken.'
          );
        },
        chat: () => {
          throw new Error(
            'PUTER_AUTH_TOKEN environment variable is required for the default puter provider. ' +
            'Either set the environment variable or use createPuter() with an explicit authToken.'
          );
        }
      } as any;
    }
    _puterInstance = createPuter({ authToken });
  }
  return _puterInstance;
}

/**
 * Default Puter provider (lazy-loaded).
 * 
 * This is a proxy that lazily creates the provider when first accessed.
 * It requires the PUTER_AUTH_TOKEN environment variable to be set.
 */
export const puter: PuterProvider = new Proxy(
  function() {} as unknown as PuterProvider,
  {
    apply(_target, _thisArg, args: [string, PuterChatSettings?]) {
      return getPuterInstance()(...args);
    },
    get(_target, prop) {
      if (prop === 'languageModel' || prop === 'chat') {
        return (...args: [string, PuterChatSettings?]) => 
          getPuterInstance()[prop](...args);
      }
      if (prop === 'specificationVersion') {
        return 'v3';
      }
      if (prop === 'embeddingModel' || prop === 'imageModel') {
        return () => {
          throw new Error(`Puter does not support ${String(prop).replace('Model', '')} models`);
        };
      }
      return (getPuterInstance() as any)[prop];
    },
  }
);
