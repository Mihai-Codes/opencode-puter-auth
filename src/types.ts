/**
 * Type definitions for opencode-puter-auth plugin
 */

import { z } from 'zod';

// Puter Account Schema
export const PuterAccountSchema = z.object({
  username: z.string(),
  email: z.string().email().optional(),
  authToken: z.string(),
  addedAt: z.number(),
  lastUsed: z.number().optional(),
  isTemporary: z.boolean().default(false),
});

export type PuterAccount = z.infer<typeof PuterAccountSchema>;

// Puter Accounts Storage Schema
export const PuterAccountsStorageSchema = z.object({
  version: z.number().default(1),
  accounts: z.array(PuterAccountSchema),
  activeIndex: z.number().default(0),
});

export type PuterAccountsStorage = z.infer<typeof PuterAccountsStorageSchema>;

// Puter Configuration Schema
export const PuterConfigSchema = z.object({
  quiet_mode: z.boolean().default(false),
  debug: z.boolean().default(false),
  log_dir: z.string().optional(),
  auto_update: z.boolean().default(true),
  
  // API Settings
  api_base_url: z.string().default('https://api.puter.com'),
  api_timeout_ms: z.number().default(120000),
  
  // Session Settings
  auto_create_temp_user: z.boolean().default(true),
  
  // Retry Settings
  max_retries: z.number().default(3),
  retry_delay_ms: z.number().default(1000),
  
  // Stream Settings
  stream_buffer_size: z.number().default(1024),
  
  // Cache Settings
  cache_ttl_ms: z.number().default(300000), // 5 minutes
  cache_enabled: z.boolean().default(false),
  cache_max_entries: z.number().default(100),
  cache_directory: z.string().optional(),
  
  // Metrics Settings
  metrics_enabled: z.boolean().default(true),
  metrics_max_samples: z.number().default(200),
  metrics_file: z.string().optional(),
  
  // Fallback Settings
  fallback_enabled: z.boolean().default(true),
  fallback_models: z.array(z.string()).optional(), // Uses DEFAULT_FALLBACK_MODELS if not set
  fallback_cooldown_ms: z.number().default(60000), // 1 minute
  
  // Account Rotation Settings
  account_rotation_enabled: z.boolean().default(true),
  account_rotation_strategy: z.enum(['round-robin', 'least-recently-used']).default('round-robin'),
  account_rotation_cooldown_ms: z.number().default(300000), // 5 minutes
});

export type PuterConfig = z.infer<typeof PuterConfigSchema>;

// Chat Message Types
export interface PuterChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | PuterContentPart[];
  tool_call_id?: string;
  tool_calls?: PuterToolCall[];
}

export interface PuterContentPart {
  type: 'text' | 'file' | 'image_url';
  text?: string;
  puter_path?: string;
  image_url?: { url: string };
}

export interface PuterToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

// Chat Options
export interface PuterChatOptions {
  model?: string;
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  tools?: PuterTool[];
  test_mode?: boolean;
}

export interface PuterTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
  };
}

// Chat Response
export interface PuterChatResponse {
  message: {
    role: 'assistant';
    content: string | null;
    tool_calls?: PuterToolCall[];
  };
  finish_reason: 'stop' | 'tool_calls' | 'length';
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Chat Stream Chunk
export interface PuterChatStreamChunk {
  text?: string;
  reasoning?: string;
  tool_calls?: PuterToolCall[];
  finish_reason?: string;
  done?: boolean;
}

// Model Information
export interface PuterModelInfo {
  id: string;
  name: string;
  provider: string;
  context_window?: number;
  max_output_tokens?: number;
  supports_streaming?: boolean;
  supports_tools?: boolean;
  supports_vision?: boolean;
}

// Auth Result
export interface PuterAuthResult {
  success: boolean;
  account?: PuterAccount;
  error?: string;
}

// Available Claude Models
export const PUTER_CLAUDE_MODELS = [
  'claude-opus-4-5',
  'claude-sonnet-4-5',
  'claude-sonnet-4',
  'claude-opus-4',
  'claude-opus-4-1',
  'claude-haiku-4-5',
] as const;

// Available GPT Models
export const PUTER_GPT_MODELS = [
  'gpt-5-nano',
  'gpt-5',
  'gpt-5.1',
  'gpt-5.2',
  'gpt-4o',
  'gpt-4o-mini',
  'o1',
  'o1-mini',
  'o3-mini',
  'o4',
] as const;

// Available Gemini Models
export const PUTER_GEMINI_MODELS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
] as const;

// Model Type
export type PuterModelId = 
  | typeof PUTER_CLAUDE_MODELS[number]
  | typeof PUTER_GPT_MODELS[number]
  | typeof PUTER_GEMINI_MODELS[number]
  | string;

// Monthly Usage Information (from puter.auth.getMonthlyUsage())
export interface PuterMonthlyUsage {
  /** Information about the user's resource allowance and consumption */
  allowanceInfo: {
    /** Total resource allowance for the month (in microcents: $0.50 = 50,000,000) */
    monthUsageAllowance: number;
    /** The remaining allowance that can be used (in microcents) */
    remaining: number;
  };
  /** Total usage by application. Each key is an application id. */
  appTotals?: Record<string, {
    /** Number of Puter API calls per application */
    count: number;
    /** Total resources consumed per application (in microcents) */
    total: number;
  }>;
  /** Usage information per API. Each key is an API name. */
  usage?: Record<string, {
    /** Total resource consumed by this API (in microcents) */
    cost: number;
    /** Number of times the API is called */
    count: number;
    /** Units of measurement (e.g., tokens for AI calls, bytes for FS operations) */
    units: number;
  }>;
}
