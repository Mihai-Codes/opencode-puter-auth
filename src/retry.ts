/**
 * Retry utilities with exponential backoff and jitter
 * 
 * Provides robust retry logic for handling transient failures
 * in API calls to Puter.com
 */

/**
 * Configuration options for retry behavior
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelay?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelay?: number;
  /** Backoff multiplier (default: 2) */
  backoffFactor?: number;
  /** Add random jitter to delays (default: true) */
  jitter?: boolean;
  /** HTTP status codes that should trigger a retry (default: [429, 500, 502, 503, 504]) */
  retryableStatuses?: number[];
  /** Callback called before each retry attempt */
  onRetry?: (attempt: number, error: Error, delay: number) => void;
}

/**
 * Error class for retry-related failures
 */
export class RetryError extends Error {
  public readonly attempts: number;
  public readonly lastError: Error;

  constructor(message: string, attempts: number, lastError: Error) {
    super(message);
    this.name = 'RetryError';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

/**
 * Default retry options
 */
const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, 'onRetry'>> = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffFactor: 2,
  jitter: true,
  retryableStatuses: [429, 500, 502, 503, 504],
};

/**
 * Calculate delay with exponential backoff and optional jitter
 * 
 * @param attempt - Current attempt number (0-indexed)
 * @param options - Retry options
 * @returns Delay in milliseconds
 * 
 * @example
 * ```ts
 * // Attempt 0: ~1000ms
 * // Attempt 1: ~2000ms
 * // Attempt 2: ~4000ms
 * const delay = calculateDelay(2, { initialDelay: 1000, backoffFactor: 2 });
 * ```
 */
export function calculateDelay(
  attempt: number,
  options: Pick<RetryOptions, 'initialDelay' | 'maxDelay' | 'backoffFactor' | 'jitter'> = {}
): number {
  const {
    initialDelay = DEFAULT_RETRY_OPTIONS.initialDelay,
    maxDelay = DEFAULT_RETRY_OPTIONS.maxDelay,
    backoffFactor = DEFAULT_RETRY_OPTIONS.backoffFactor,
    jitter = DEFAULT_RETRY_OPTIONS.jitter,
  } = options;

  // Calculate base delay with exponential backoff
  const baseDelay = initialDelay * Math.pow(backoffFactor, attempt);
  
  // Cap at maxDelay
  const cappedDelay = Math.min(baseDelay, maxDelay);
  
  // Add jitter (±25% randomness) to prevent thundering herd
  if (jitter) {
    const jitterRange = cappedDelay * 0.25;
    const randomJitter = (Math.random() - 0.5) * 2 * jitterRange;
    return Math.max(0, Math.round(cappedDelay + randomJitter));
  }
  
  return Math.round(cappedDelay);
}

/**
 * Sleep for a specified duration
 * 
 * @param ms - Duration in milliseconds
 * @returns Promise that resolves after the delay
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if an error is retryable based on HTTP status
 * 
 * @param error - The error to check
 * @param retryableStatuses - List of HTTP status codes that should trigger retry
 * @returns true if the error should trigger a retry
 */
export function isRetryableError(
  error: unknown,
  retryableStatuses: number[] = DEFAULT_RETRY_OPTIONS.retryableStatuses
): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    
    // Check for status codes in error message
    for (const status of retryableStatuses) {
      if (message.includes(`(${status})`) || message.includes(`status ${status}`)) {
        return true;
      }
    }
    
    // Check for common transient error patterns
    if (
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('network') ||
      message.includes('socket hang up') ||
      message.includes('rate limit') ||
      message.includes('too many requests')
    ) {
      return true;
    }
  }
  
  return false;
}

/**
 * Execute an async operation with retry logic
 * 
 * Uses exponential backoff with jitter to handle transient failures.
 * Only retries on specific error conditions (rate limits, server errors, network issues).
 * 
 * @param operation - Async function to execute
 * @param options - Retry configuration options
 * @returns Result of the operation
 * @throws RetryError if all retry attempts fail
 * 
 * @example
 * ```ts
 * const result = await withRetry(
 *   () => fetch('https://api.example.com/data'),
 *   {
 *     maxRetries: 3,
 *     onRetry: (attempt, error, delay) => {
 *       console.log(`Retry ${attempt} after ${delay}ms: ${error.message}`);
 *     }
 *   }
 * );
 * ```
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = DEFAULT_RETRY_OPTIONS.maxRetries,
    initialDelay = DEFAULT_RETRY_OPTIONS.initialDelay,
    maxDelay = DEFAULT_RETRY_OPTIONS.maxDelay,
    backoffFactor = DEFAULT_RETRY_OPTIONS.backoffFactor,
    jitter = DEFAULT_RETRY_OPTIONS.jitter,
    retryableStatuses = DEFAULT_RETRY_OPTIONS.retryableStatuses,
    onRetry,
  } = options;

  let lastError: Error = new Error('Unknown error');

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if we should retry
      const isLastAttempt = attempt === maxRetries;
      const shouldRetry = !isLastAttempt && isRetryableError(error, retryableStatuses);
      
      if (!shouldRetry) {
        throw lastError;
      }
      
      // Calculate delay for next attempt
      const delay = calculateDelay(attempt, { initialDelay, maxDelay, backoffFactor, jitter });
      
      // Call onRetry callback if provided
      if (onRetry) {
        onRetry(attempt + 1, lastError, delay);
      }
      
      // Wait before retrying
      await sleep(delay);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw new RetryError(
    `Operation failed after ${maxRetries + 1} attempts`,
    maxRetries + 1,
    lastError
  );
}

/**
 * Create a fetch wrapper with built-in retry logic
 * 
 * @param options - Retry configuration options
 * @returns A fetch function with retry capabilities
 * 
 * @example
 * ```ts
 * const fetchWithRetry = createRetryFetch({ maxRetries: 3 });
 * const response = await fetchWithRetry('https://api.example.com/data');
 * ```
 */
export function createRetryFetch(options: RetryOptions = {}) {
  return async function retryFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    return withRetry(async () => {
      const response = await fetch(input, init);
      
      // Check if response status indicates a retryable error
      const retryableStatuses = options.retryableStatuses || DEFAULT_RETRY_OPTIONS.retryableStatuses;
      if (retryableStatuses.includes(response.status)) {
        throw new Error(`HTTP error (${response.status}): ${response.statusText}`);
      }
      
      return response;
    }, options);
  };
}
