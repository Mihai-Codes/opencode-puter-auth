/**
 * Fallback Manager for opencode-puter-auth
 * 
 * Provides automatic model fallback when rate limits are encountered.
 * When a model returns a rate limit error (429/403), the manager:
 * 1. Adds the model to a cooldown list
 * 2. Tries alternative free models in order
 * 3. Returns to the original model after cooldown expires
 * 
 * @example
 * ```ts
 * const manager = new FallbackManager({
 *   fallbackModels: ['openrouter:xiaomi/mimo-v2-flash:free'],
 *   cooldownMs: 60000,
 * });
 * 
 * const result = await manager.executeWithFallback(
 *   'claude-opus-4-5',
 *   async (model) => puter.ai.chat(messages, { model }),
 *   logger
 * );
 * 
 * if (result.wasFallback) {
 *   console.log(`Used fallback model: ${result.usedModel}`);
 * }
 * ```
 */

import type { Logger } from './logger.js';

/**
 * Default fallback models - FREE OpenRouter models via Puter gateway.
 * Ordered by quality/capability (best first).
 * 
 * Note: OpenRouter free models have rate limits:
 * - Without credits: 50 requests/day per model
 * - With 10+ credits purchased: 1000 requests/day per model
 */
export const DEFAULT_FALLBACK_MODELS = [
  // Tier 1: Best free coding models (try these first)
  'openrouter:xiaomi/mimo-v2-flash:free',       // 309B MoE, #1 SWE-bench
  'openrouter:deepseek/deepseek-r1-0528:free',  // 671B MoE, o1-level reasoning
  'openrouter:mistralai/devstral-2512:free',    // 123B, agentic coding
  
  // Tier 2: Quality coding models
  'openrouter:qwen/qwen3-coder:free',           // 480B MoE coding model
  'openrouter:mistralai/devstral-small-2505:free', // Smaller devstral
  'openrouter:qwen/qwen2.5-coder-32b-instruct:free',
  
  // Tier 3: General purpose free models
  'openrouter:google/gemini-2.0-flash-exp:free',// Google's experimental
  'openrouter:meta-llama/llama-4-maverick:free',
  'openrouter:meta-llama/llama-4-scout:free',
  'openrouter:meta-llama/llama-3.3-70b-instruct:free',
  
  // Tier 4: More fallback options
  'openrouter:qwen/qwen3-235b-a22b:free',       // Qwen 235B
  'openrouter:qwen/qwen3-30b-a3b:free',         // Qwen 30B
  'openrouter:deepseek/deepseek-chat-v3.1:free',
  'openrouter:nvidia/llama-3.1-nemotron-ultra-253b-v1:free',
  
  // Tier 5: Last resort models
  'openrouter:openai/gpt-oss-120b:free',
  'openrouter:openai/gpt-oss-20b:free',
  'openrouter:google/gemma-3-27b-it:free',
  'openrouter:mistralai/mistral-small-3.2-24b-instruct:free',
];

/**
 * Default cooldown duration in milliseconds (60 seconds)
 */
export const DEFAULT_COOLDOWN_MS = 60000;

/**
 * Error type classification for better debugging
 */
export type FallbackErrorType = 
  | 'rate_limit'      // 429 - Too Many Requests
  | 'forbidden'       // 403 - Often means model/account restricted
  | 'server_error'    // 500, 502, 503 - Provider issues
  | 'timeout'         // Request timed out
  | 'auth_error'      // 401 - Authentication issue
  | 'not_found'       // 404 - Model not found
  | 'context_length'  // Context too long for model
  | 'unknown';        // Other errors

/**
 * Configuration options for FallbackManager
 */
export interface FallbackOptions {
  /** List of fallback models to try when primary fails */
  fallbackModels?: string[];
  /** Cooldown duration in milliseconds */
  cooldownMs?: number;
  /** Whether fallback is enabled */
  enabled?: boolean;
  /** Verbose logging - show detailed info about each attempt */
  verbose?: boolean;
  /** Quiet mode - only show errors, suppress info/warnings */
  quiet?: boolean;
}

/**
 * Record of a single model attempt
 */
export interface FallbackAttempt {
  /** Model that was tried */
  model: string;
  /** Whether the attempt succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Classified error type */
  errorType?: FallbackErrorType;
  /** HTTP status code if available */
  httpStatus?: number;
  /** Whether the error was a rate limit (deprecated, use errorType) */
  isRateLimit?: boolean;
  /** Duration of the attempt in ms */
  durationMs?: number;
}

/**
 * Result of executeWithFallback
 */
export interface FallbackResult<T> {
  /** The result from the successful model */
  result: T;
  /** The model that was actually used */
  usedModel: string;
  /** Whether a fallback model was used instead of the primary */
  wasFallback: boolean;
  /** All attempts made (for debugging/logging) */
  attempts: FallbackAttempt[];
}

/**
 * Error thrown when all models (primary + fallbacks) have failed
 */
export class FallbackExhaustedError extends Error {
  public readonly attempts: FallbackAttempt[];
  
  constructor(attempts: FallbackAttempt[]) {
    // Build a detailed error message
    const modelsTried = attempts.map(a => a.model).join(', ');
    
    // Summarize error types
    const errorSummary: Record<string, number> = {};
    for (const attempt of attempts) {
      if (!attempt.success && attempt.errorType) {
        errorSummary[attempt.errorType] = (errorSummary[attempt.errorType] || 0) + 1;
      }
    }
    
    const summaryStr = Object.entries(errorSummary)
      .map(([type, count]) => `${type}: ${count}`)
      .join(', ');
    
    // Provide actionable advice based on error types
    let advice = '';
    if (errorSummary['rate_limit'] || errorSummary['forbidden']) {
      advice = '\n\nPossible causes:\n' +
        '• OpenRouter free models have daily rate limits (50 req/day without credits)\n' +
        '• Try waiting a few minutes, or use a different model provider\n' +
        '• Run `npx opencode-puter-auth logout && npx opencode-puter-auth login` to refresh auth';
    } else if (errorSummary['server_error']) {
      advice = '\n\nThe AI provider is experiencing issues. Try again in a few minutes.';
    } else if (errorSummary['auth_error']) {
      advice = '\n\nAuthentication failed. Run `npx opencode-puter-auth login` to re-authenticate.';
    }
    
    super(`All models exhausted. Tried: ${modelsTried}\nErrors: ${summaryStr}${advice}`);
    this.name = 'FallbackExhaustedError';
    this.attempts = attempts;
  }
}

/**
 * Check if an error indicates a rate limit
 * 
 * Detects various rate limit error patterns from different providers:
 * - HTTP 429 (Too Many Requests)
 * - HTTP 403 (Forbidden) - Puter uses this for account limits
 * - Various error message patterns
 * 
 * @param error - The error to check
 * @returns true if the error is a rate limit error
 */
export function isRateLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  
  const message = error.message.toLowerCase();
  
  // HTTP status codes that indicate rate limiting
  if (message.includes('(429)') || message.includes('status 429')) return true;
  if (message.includes('(403)') || message.includes('status 403')) return true;
  
  // Error message patterns from various providers
  const rateLimitPatterns = [
    'rate limit',
    'rate_limit',
    'ratelimit',
    'too many requests',
    'quota exceeded',
    'quota_exceeded',
    'limit exceeded',
    'request limit',
    'credits exhausted',
    'insufficient credits',
    'usage limit',
    'capacity',
    'overloaded',
    'try again later',
  ];
  
  return rateLimitPatterns.some(pattern => message.includes(pattern));
}

/**
 * Extract HTTP status code from error message
 * 
 * @param error - The error to extract status from
 * @returns HTTP status code or undefined
 */
export function extractHttpStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  
  const message = error.message;
  
  // Match patterns like "(429)", "status 429", "HTTP 429", "code: 429"
  const patterns = [
    /\((\d{3})\)/,           // (429)
    /status[:\s]+(\d{3})/i,  // status 429, status: 429
    /HTTP[:\s]+(\d{3})/i,    // HTTP 429, HTTP: 429
    /code[:\s]+(\d{3})/i,    // code 429, code: 429
    /(\d{3})\s+error/i,      // 429 error
  ];
  
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      const status = parseInt(match[1], 10);
      if (status >= 100 && status < 600) {
        return status;
      }
    }
  }
  
  return undefined;
}

/**
 * Classify an error into a FallbackErrorType
 * 
 * @param error - The error to classify
 * @returns The error type classification
 */
export function classifyError(error: unknown): FallbackErrorType {
  if (!(error instanceof Error)) return 'unknown';
  
  const message = error.message.toLowerCase();
  const httpStatus = extractHttpStatus(error);
  
  // Check by HTTP status first
  if (httpStatus) {
    switch (httpStatus) {
      case 429: return 'rate_limit';
      case 403: return 'forbidden';
      case 401: return 'auth_error';
      case 404: return 'not_found';
      case 500:
      case 502:
      case 503:
      case 504: return 'server_error';
    }
  }
  
  // Check by message patterns
  if (isRateLimitError(error)) return 'rate_limit';
  
  if (message.includes('timeout') || message.includes('timed out')) {
    return 'timeout';
  }
  
  if (message.includes('context') && (message.includes('length') || message.includes('too long') || message.includes('exceed'))) {
    return 'context_length';
  }
  
  if (message.includes('auth') || message.includes('unauthorized') || message.includes('invalid key') || message.includes('invalid token')) {
    return 'auth_error';
  }
  
  if (message.includes('not found') || message.includes('does not exist') || message.includes('unknown model')) {
    return 'not_found';
  }
  
  if (message.includes('internal') || message.includes('server error') || message.includes('unavailable')) {
    return 'server_error';
  }
  
  return 'unknown';
}

/**
 * Get a human-readable description of an error type
 */
export function getErrorTypeDescription(errorType: FallbackErrorType): string {
  switch (errorType) {
    case 'rate_limit': return 'Rate Limited';
    case 'forbidden': return 'Access Denied';
    case 'server_error': return 'Server Error';
    case 'timeout': return 'Timeout';
    case 'auth_error': return 'Auth Error';
    case 'not_found': return 'Not Found';
    case 'context_length': return 'Context Too Long';
    case 'unknown': return 'Error';
  }
}

/**
 * Format a duration in milliseconds to a human-readable string
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainingSecs = secs % 60;
  return remainingSecs > 0 ? `${mins}m ${remainingSecs}s` : `${mins}m`;
}

/**
 * Cooldown entry storing when a model will be available again
 */
interface CooldownEntry {
  /** Timestamp when cooldown expires */
  expiresAt: number;
  /** Reason for cooldown */
  reason: string;
}

/**
 * Manages automatic model fallback when rate limits are encountered.
 * 
 * This is a singleton-style class designed to be shared across all
 * PuterChatLanguageModel instances so cooldown state is consistent.
 */
export class FallbackManager {
  private cooldownMap: Map<string, CooldownEntry> = new Map();
  private fallbackModels: string[];
  private cooldownMs: number;
  private enabled: boolean;
  private verbose: boolean;
  private quiet: boolean;
  
  constructor(options: FallbackOptions = {}) {
    this.fallbackModels = options.fallbackModels ?? DEFAULT_FALLBACK_MODELS;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.enabled = options.enabled ?? true;
    this.verbose = options.verbose ?? false;
    this.quiet = options.quiet ?? false;
  }
  
  /**
   * Check if a model is currently on cooldown
   * 
   * @param model - Model ID to check
   * @returns true if the model is on cooldown
   */
  public isModelOnCooldown(model: string): boolean {
    const entry = this.cooldownMap.get(model);
    if (!entry) return false;
    
    // Check if cooldown has expired
    if (Date.now() >= entry.expiresAt) {
      this.cooldownMap.delete(model);
      return false;
    }
    
    return true;
  }
  
  /**
   * Get remaining cooldown time for a model in milliseconds
   * 
   * @param model - Model ID to check
   * @returns Remaining cooldown in ms, or 0 if not on cooldown
   */
  public getCooldownRemaining(model: string): number {
    const entry = this.cooldownMap.get(model);
    if (!entry) return 0;
    
    const remaining = entry.expiresAt - Date.now();
    if (remaining <= 0) {
      this.cooldownMap.delete(model);
      return 0;
    }
    
    return remaining;
  }
  
  /**
   * Add a model to the cooldown list
   * 
   * @param model - Model ID to add to cooldown
   * @param reason - Reason for the cooldown (e.g., error message)
   * @param durationMs - Optional custom cooldown duration
   */
  public addToCooldown(model: string, reason: string, durationMs?: number): void {
    this.cooldownMap.set(model, {
      expiresAt: Date.now() + (durationMs ?? this.cooldownMs),
      reason,
    });
  }
  
  /**
   * Remove a model from cooldown (e.g., if it's working again)
   * 
   * @param model - Model ID to remove from cooldown
   */
  public removeFromCooldown(model: string): void {
    this.cooldownMap.delete(model);
  }
  
  /**
   * Get all models currently on cooldown
   * 
   * @returns Map of model IDs to their cooldown info
   */
  public getCooldownStatus(): Map<string, { remainingMs: number; reason: string }> {
    const status = new Map<string, { remainingMs: number; reason: string }>();
    const now = Date.now();
    
    for (const [model, entry] of this.cooldownMap) {
      const remaining = entry.expiresAt - now;
      if (remaining > 0) {
        status.set(model, { remainingMs: remaining, reason: entry.reason });
      } else {
        // Clean up expired entries
        this.cooldownMap.delete(model);
      }
    }
    
    return status;
  }
  
  /**
   * Build the queue of models to try, respecting cooldowns
   * 
   * @param primaryModel - The primary model requested
   * @returns Ordered array of models to try
   */
  public buildModelQueue(primaryModel: string): string[] {
    const queue: string[] = [];
    
    // Add primary model first if not on cooldown
    if (!this.isModelOnCooldown(primaryModel)) {
      queue.push(primaryModel);
    }
    
    // Add fallback models that aren't on cooldown
    for (const model of this.fallbackModels) {
      // Skip if it's the primary (already added) or on cooldown
      if (model === primaryModel) continue;
      if (this.isModelOnCooldown(model)) continue;
      queue.push(model);
    }
    
    // If primary was on cooldown but we have no fallbacks, add it anyway
    // (better to try and fail than to give up immediately)
    if (queue.length === 0 && this.isModelOnCooldown(primaryModel)) {
      queue.push(primaryModel);
    }
    
    return queue;
  }
  
  /**
   * Execute an operation with automatic model fallback
   * 
   * Tries the primary model first, and if it fails with a rate limit error,
   * automatically tries fallback models in order.
   * 
   * @param primaryModel - The primary model to try first
   * @param operation - Function that performs the API call with the given model
   * @param logger - Optional logger for debugging
   * @returns Result including which model was used and all attempts
   * @throws FallbackExhaustedError if all models fail
   * 
   * @example
   * ```ts
   * const result = await manager.executeWithFallback(
   *   'claude-opus-4-5',
   *   async (model) => {
   *     return await puter.ai.chat(messages, { model });
   *   },
   *   logger
   * );
   * ```
   */
  public async executeWithFallback<T>(
    primaryModel: string,
    operation: (model: string) => Promise<T>,
    logger?: Logger
  ): Promise<FallbackResult<T>> {
    // If fallback is disabled, just run the operation directly
    if (!this.enabled) {
      const startTime = Date.now();
      try {
        const result = await operation(primaryModel);
        return {
          result,
          usedModel: primaryModel,
          wasFallback: false,
          attempts: [{
            model: primaryModel,
            success: true,
            durationMs: Date.now() - startTime,
          }],
        };
      } catch (error) {
        throw error;
      }
    }
    
    const modelQueue = this.buildModelQueue(primaryModel);
    const attempts: FallbackAttempt[] = [];
    const totalModels = modelQueue.length;
    
    // Log queue info in verbose mode
    if (this.verbose && !this.quiet) {
      logger?.debug(`Fallback queue: [${modelQueue.join(' → ')}] (${totalModels} models)`);
      
      // Show any models on cooldown
      const cooldownStatus = this.getCooldownStatus();
      if (cooldownStatus.size > 0) {
        for (const [model, status] of cooldownStatus) {
          logger?.debug(`  ⏳ ${model} on cooldown (${formatDuration(status.remainingMs)} remaining)`);
        }
      }
    }
    
    for (let i = 0; i < modelQueue.length; i++) {
      const model = modelQueue[i];
      const attemptNum = i + 1;
      const startTime = Date.now();
      const isFallback = model !== primaryModel;
      const progress = `[${attemptNum}/${totalModels}]`;
      
      // Log attempt start (only if not quiet)
      if (!this.quiet) {
        if (isFallback) {
          logger?.info(`${progress} Trying fallback: ${this.formatModelName(model)}`);
        } else if (this.verbose) {
          logger?.debug(`${progress} Trying primary: ${this.formatModelName(model)}`);
        }
      }
      
      try {
        const result = await operation(model);
        const durationMs = Date.now() - startTime;
        
        // Success! Log it (unless quiet)
        if (!this.quiet) {
          if (isFallback) {
            logger?.info(`${progress} ✓ Fallback succeeded: ${this.formatModelName(model)} (${formatDuration(durationMs)})`);
          } else if (this.verbose) {
            logger?.debug(`${progress} ✓ Primary succeeded: ${this.formatModelName(model)} (${formatDuration(durationMs)})`);
          }
        }
        
        attempts.push({
          model,
          success: true,
          durationMs,
        });
        
        return {
          result,
          usedModel: model,
          wasFallback: isFallback,
          attempts,
        };
      } catch (error) {
        const durationMs = Date.now() - startTime;
        const errorType = classifyError(error);
        const httpStatus = extractHttpStatus(error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorDesc = getErrorTypeDescription(errorType);
        
        // Should we add to cooldown?
        const shouldCooldown = errorType === 'rate_limit' || errorType === 'forbidden' || errorType === 'server_error';
        
        attempts.push({
          model,
          success: false,
          error: errorMessage,
          errorType,
          httpStatus,
          isRateLimit: errorType === 'rate_limit',
          durationMs,
        });
        
        if (shouldCooldown) {
          this.addToCooldown(model, errorMessage);
          const cooldownRemaining = formatDuration(this.cooldownMs);
          
          if (!this.quiet) {
            const statusStr = httpStatus ? ` (${httpStatus})` : '';
            logger?.warn(`${progress} ✗ ${this.formatModelName(model)}: ${errorDesc}${statusStr} → cooldown ${cooldownRemaining}`);
          }
        } else {
          // Non-cooldown error - log differently
          if (!this.quiet) {
            const statusStr = httpStatus ? ` (${httpStatus})` : '';
            logger?.warn(`${progress} ✗ ${this.formatModelName(model)}: ${errorDesc}${statusStr}`);
          }
          
          // For verbose mode, also show the full error message
          if (this.verbose && !this.quiet) {
            logger?.debug(`  Error details: ${errorMessage.substring(0, 200)}`);
          }
        }
        
        // Continue to next model in queue
      }
    }
    
    // All models exhausted
    const exhaustedError = new FallbackExhaustedError(attempts);
    logger?.error(`All ${totalModels} models failed`, exhaustedError);
    throw exhaustedError;
  }
  
  /**
   * Format a model name for display (truncate long OpenRouter names)
   */
  private formatModelName(model: string): string {
    // Remove 'openrouter:' prefix for cleaner display
    if (model.startsWith('openrouter:')) {
      return model.replace('openrouter:', '');
    }
    return model;
  }
  
  /**
   * Clear all cooldowns (useful for testing or manual reset)
   */
  public clearCooldowns(): void {
    this.cooldownMap.clear();
  }
  
  /**
   * Update configuration
   */
  public configure(options: Partial<FallbackOptions>): void {
    if (options.fallbackModels !== undefined) {
      this.fallbackModels = options.fallbackModels;
    }
    if (options.cooldownMs !== undefined) {
      this.cooldownMs = options.cooldownMs;
    }
    if (options.enabled !== undefined) {
      this.enabled = options.enabled;
    }
    if (options.verbose !== undefined) {
      this.verbose = options.verbose;
    }
    if (options.quiet !== undefined) {
      this.quiet = options.quiet;
    }
  }
  
  /**
   * Get current configuration
   */
  public getConfig(): Required<FallbackOptions> {
    return {
      fallbackModels: [...this.fallbackModels],
      cooldownMs: this.cooldownMs,
      enabled: this.enabled,
      verbose: this.verbose,
      quiet: this.quiet,
    };
  }
}

/**
 * Global FallbackManager instance shared across all model instances.
 * This ensures cooldown state is consistent across the application.
 */
let globalFallbackManager: FallbackManager | null = null;

/**
 * Get the global FallbackManager instance, creating it if needed
 * 
 * @param options - Configuration options (only used when creating)
 * @returns The global FallbackManager instance
 */
export function getGlobalFallbackManager(options?: FallbackOptions): FallbackManager {
  if (!globalFallbackManager) {
    globalFallbackManager = new FallbackManager(options);
  } else if (options) {
    // Update config if options provided
    globalFallbackManager.configure(options);
  }
  return globalFallbackManager;
}

/**
 * Reset the global FallbackManager (useful for testing)
 */
export function resetGlobalFallbackManager(): void {
  globalFallbackManager = null;
}
