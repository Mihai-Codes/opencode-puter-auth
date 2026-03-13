/**
 * Debug Logger for opencode-puter-auth
 * 
 * Provides consistent, timestamped logging with configurable verbosity.
 * All logs respect the `debug` and `quiet_mode` configuration options.
 * 
 * @example
 * ```ts
 * const logger = createLogger({ debug: true, quiet_mode: false });
 * logger.debug('Request', { model: 'claude-opus-4-5', method: 'complete' });
 * logger.info('Connected to Puter');
 * logger.warn('Rate limited, retrying...');
 * logger.error('Authentication failed', new Error('Invalid token'));
 * ```
 */

import type { PuterConfig } from './types.js';

/**
 * Log levels in order of verbosity
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

/**
 * Logger configuration options
 */
export interface LoggerOptions {
  /** Enable or disable all logging */
  enabled?: boolean;
  /** Enable debug-level logging */
  debug?: boolean;
  /** Suppress all non-error output */
  quiet_mode?: boolean;
  /** Custom prefix for log messages (default: 'puter-auth') */
  prefix?: string;
}

/**
 * Logger interface
 */
export interface Logger {
  /** Log debug-level messages (only when debug: true) */
  debug(message: string, data?: unknown): void;
  /** Log info-level messages (suppressed in quiet_mode) */
  info(message: string, data?: unknown): void;
  /** Log warning messages (suppressed in quiet_mode) */
  warn(message: string, data?: unknown): void;
  /** Log error messages (always shown) */
  error(message: string, error?: Error | unknown): void;
  /** Log request details (debug only) */
  request(method: string, endpoint: string, details?: Record<string, unknown>): void;
  /** Log response details (debug only) */
  response(status: number, message: string, duration?: number): void;
  /** Log retry attempt (debug only) */
  retry(attempt: number, maxAttempts: number, reason: string, delayMs: number): void;
  /** Log auth state change */
  auth(action: string, details?: string): void;
  /** Check if debug logging is enabled */
  isDebugEnabled(): boolean;
}

/**
 * No-op logger that discards all messages
 * Useful for testing or when logging should be completely disabled
 */
export const nullLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  request: () => {},
  response: () => {},
  retry: () => {},
  auth: () => {},
  isDebugEnabled: () => false,
};

/**
 * Format a timestamp as HH:MM:SS
 */
function formatTime(date: Date = new Date()): string {
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Format data for logging
 */
function formatData(data: unknown): string {
  if (data === undefined || data === null) {
    return '';
  }
  
  if (typeof data === 'string') {
    return data;
  }
  
  if (data instanceof Error) {
    return data.message;
  }
  
  try {
    // For objects, format key=value pairs on one line
    if (typeof data === 'object' && !Array.isArray(data)) {
      const entries = Object.entries(data as Record<string, unknown>)
        .map(([key, value]) => {
          if (typeof value === 'string') {
            return `${key}=${value}`;
          }
          if (typeof value === 'number' || typeof value === 'boolean') {
            return `${key}=${value}`;
          }
          return `${key}=${JSON.stringify(value)}`;
        })
        .join(' ');
      return entries;
    }
    
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

/**
 * Create a logger instance
 * 
 * @param options - Logger configuration
 * @returns Logger instance
 * 
 * @example
 * ```ts
 * const logger = createLogger({ debug: true });
 * 
 * // Debug logs (only shown when debug: true)
 * logger.debug('Processing request');
 * 
 * // Request logging
 * logger.request('POST', '/drivers/call', { model: 'claude-opus-4-5' });
 * // Output: [puter-auth] 15:30:45 Request: POST /drivers/call model=claude-opus-4-5
 * 
 * // Response logging with duration
 * logger.response(200, 'OK', 1234);
 * // Output: [puter-auth] 15:30:46 Response: 200 OK (1.2s)
 * 
 * // Retry logging
 * logger.retry(1, 3, 'Rate limited (429)', 1000);
 * // Output: [puter-auth] 15:30:46 Retry 1/3: Rate limited (429), waiting 1000ms
 * ```
 */
const FORCE_DISABLE_LOGGING = true;

export function createLogger(options: LoggerOptions = {}): Logger {
  const {
    enabled = true,
    debug = false,
    quiet_mode = false,
    prefix = 'puter-auth',
  } = options;

  if (FORCE_DISABLE_LOGGING || !enabled) {
    return nullLogger;
  }

  const effectiveLevel = quiet_mode
    ? LogLevel.ERROR
    : debug
      ? LogLevel.DEBUG
      : LogLevel.INFO;

  const formatPrefix = () => `[${prefix}] ${formatTime()}`;

  return {
    debug(message: string, data?: unknown): void {
      if (effectiveLevel > LogLevel.DEBUG) return;
      const dataStr = formatData(data);
      console.log(`${formatPrefix()} ${message}${dataStr ? ' ' + dataStr : ''}`);
    },

    info(message: string, data?: unknown): void {
      if (effectiveLevel > LogLevel.INFO) return;
      const dataStr = formatData(data);
      console.log(`${formatPrefix()} ${message}${dataStr ? ' ' + dataStr : ''}`);
    },

    warn(message: string, data?: unknown): void {
      if (effectiveLevel > LogLevel.WARN) return;
      const dataStr = formatData(data);
      console.warn(`${formatPrefix()} ${message}${dataStr ? ' ' + dataStr : ''}`);
    },

    error(message: string, error?: Error | unknown): void {
      // Errors are always shown
      const errorMsg = error instanceof Error ? error.message : error ? String(error) : '';
      console.error(`${formatPrefix()} ERROR: ${message}${errorMsg ? ' - ' + errorMsg : ''}`);
    },

    request(method: string, endpoint: string, details?: Record<string, unknown>): void {
      if (effectiveLevel > LogLevel.DEBUG) return;
      const detailsStr = details ? ' ' + formatData(details) : '';
      console.log(`${formatPrefix()} Request: ${method} ${endpoint}${detailsStr}`);
    },

    response(status: number, message: string, duration?: number): void {
      if (effectiveLevel > LogLevel.DEBUG) return;
      const durationStr = duration !== undefined ? ` (${(duration / 1000).toFixed(1)}s)` : '';
      console.log(`${formatPrefix()} Response: ${status} ${message}${durationStr}`);
    },

    retry(attempt: number, maxAttempts: number, reason: string, delayMs: number): void {
      if (effectiveLevel > LogLevel.DEBUG) return;
      console.log(`${formatPrefix()} Retry ${attempt}/${maxAttempts}: ${reason}, waiting ${delayMs}ms`);
    },

    auth(action: string, details?: string): void {
      if (effectiveLevel > LogLevel.INFO) return;
      console.log(`${formatPrefix()} Auth: ${action}${details ? ' - ' + details : ''}`);
    },

    isDebugEnabled(): boolean {
      return effectiveLevel <= LogLevel.DEBUG;
    },
  };
}

/**
 * Create a logger from PuterConfig
 * 
 * @param config - Puter configuration object
 * @returns Logger instance
 */
export function createLoggerFromConfig(_config: Partial<PuterConfig> = {}): Logger {
  return nullLogger;
}
