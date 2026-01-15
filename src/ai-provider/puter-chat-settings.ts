/**
 * Puter Chat Model Settings
 * 
 * Configuration options for the Puter chat language model.
 */

/**
 * Settings for the Puter chat model.
 */
export interface PuterChatSettings {
  /**
   * The Puter model ID to use.
   * @example 'claude-opus-4-5', 'claude-sonnet-4-5', 'gpt-4o', 'gemini-2.5-pro'
   */
  modelId?: string;

  /**
   * Maximum number of tokens to generate.
   */
  maxTokens?: number;

  /**
   * Temperature for response generation.
   * Higher values make output more random, lower values more deterministic.
   * @default 0.7
   */
  temperature?: number;

  /**
   * Top-p (nucleus) sampling parameter.
   */
  topP?: number;

  /**
   * Top-k sampling parameter.
   */
  topK?: number;

  /**
   * Stop sequences that will halt generation.
   */
  stopSequences?: string[];

  /**
   * Whether to enable streaming responses.
   * @default true
   */
  stream?: boolean;
}

/**
 * Configuration for the Puter provider.
 */
export interface PuterProviderConfig {
  /**
   * The Puter authentication token.
   * Can be obtained by authenticating with Puter.com.
   * Optional - if not provided, will be loaded from OpenCode auth system.
   * Alias: apiKey
   */
  authToken?: string;

  /**
   * Alias for authToken (for OpenCode compatibility).
   */
  apiKey?: string;

  /**
   * Base URL for the Puter API.
   * @default 'https://api.puter.com'
   */
  baseURL?: string;

  /**
   * Request timeout in milliseconds.
   * @default 120000
   */
  timeout?: number;

  /**
   * Custom headers to include in requests.
   */
  headers?: Record<string, string>;

  /**
   * Custom fetch function for making HTTP requests.
   * Useful for testing or custom networking.
   */
  fetch?: typeof globalThis.fetch;

  /**
   * Function to generate unique IDs.
   * Used for tool call IDs and other identifiers.
   */
  generateId?: () => string;
}

/**
 * Internal configuration passed to the chat model.
 */
export interface PuterChatConfig {
  /**
   * Provider identifier.
   */
  provider: string;

  /**
   * Base URL for API calls.
   */
  baseURL: string;

  /**
   * Request timeout in milliseconds.
   */
  timeout: number;

  /**
   * Function to get headers for requests.
   * Can be async to support dynamic auth token loading.
   */
  headers: () => Record<string, string> | Promise<Record<string, string>>;

  /**
   * Fetch function to use for requests.
   */
  fetch: typeof globalThis.fetch;

  /**
   * Function to generate unique IDs.
   */
  generateId: () => string;
}
