/**
 * Tests for retry utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calculateDelay,
  sleep,
  isRetryableError,
  withRetry,
  RetryError,
} from '../src/retry.js';

describe('calculateDelay', () => {
  it('should calculate exponential backoff', () => {
    const delay0 = calculateDelay(0, { initialDelay: 1000, backoffFactor: 2, jitter: false });
    const delay1 = calculateDelay(1, { initialDelay: 1000, backoffFactor: 2, jitter: false });
    const delay2 = calculateDelay(2, { initialDelay: 1000, backoffFactor: 2, jitter: false });
    
    expect(delay0).toBe(1000);
    expect(delay1).toBe(2000);
    expect(delay2).toBe(4000);
  });

  it('should cap delay at maxDelay', () => {
    const delay = calculateDelay(10, { initialDelay: 1000, maxDelay: 5000, backoffFactor: 2, jitter: false });
    expect(delay).toBe(5000);
  });

  it('should add jitter when enabled', () => {
    const delays = new Set<number>();
    for (let i = 0; i < 10; i++) {
      delays.add(calculateDelay(0, { initialDelay: 1000, jitter: true }));
    }
    // With jitter, we should get different values
    expect(delays.size).toBeGreaterThan(1);
  });

  it('should use default values', () => {
    const delay = calculateDelay(0);
    // Default initialDelay is 1000, with jitter it should be around 750-1250
    expect(delay).toBeGreaterThanOrEqual(750);
    expect(delay).toBeLessThanOrEqual(1250);
  });
});

describe('sleep', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should resolve after specified duration', async () => {
    const promise = sleep(1000);
    vi.advanceTimersByTime(1000);
    await expect(promise).resolves.toBeUndefined();
  });
});

describe('isRetryableError', () => {
  it('should return true for rate limit errors', () => {
    expect(isRetryableError(new Error('Puter API error (429): Too many requests'))).toBe(true);
    expect(isRetryableError(new Error('rate limit exceeded'))).toBe(true);
    expect(isRetryableError(new Error('too many requests'))).toBe(true);
  });

  it('should return true for server errors', () => {
    expect(isRetryableError(new Error('Puter API error (500): Internal server error'))).toBe(true);
    expect(isRetryableError(new Error('Puter API error (502): Bad gateway'))).toBe(true);
    expect(isRetryableError(new Error('Puter API error (503): Service unavailable'))).toBe(true);
    expect(isRetryableError(new Error('Puter API error (504): Gateway timeout'))).toBe(true);
  });

  it('should return true for network errors', () => {
    expect(isRetryableError(new Error('timeout'))).toBe(true);
    expect(isRetryableError(new Error('ECONNRESET'))).toBe(true);
    expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
    expect(isRetryableError(new Error('network error'))).toBe(true);
    expect(isRetryableError(new Error('socket hang up'))).toBe(true);
  });

  it('should return false for client errors', () => {
    expect(isRetryableError(new Error('Puter API error (400): Bad request'))).toBe(false);
    expect(isRetryableError(new Error('Puter API error (401): Unauthorized'))).toBe(false);
    expect(isRetryableError(new Error('Puter API error (403): Forbidden'))).toBe(false);
    expect(isRetryableError(new Error('Puter API error (404): Not found'))).toBe(false);
  });

  it('should return false for non-Error values', () => {
    expect(isRetryableError('string error')).toBe(false);
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
  });

  it('should use custom retryable statuses', () => {
    expect(isRetryableError(new Error('status 418'), [418])).toBe(true);
    expect(isRetryableError(new Error('status 500'), [418])).toBe(false);
  });
});

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return result on first success', async () => {
    const operation = vi.fn().mockResolvedValue('success');
    
    const result = await withRetry(operation);
    
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should retry on retryable errors', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('Puter API error (500): Server error'))
      .mockResolvedValueOnce('success');
    
    const promise = withRetry(operation, { maxRetries: 3, initialDelay: 100, jitter: false });
    
    // First call fails immediately
    await vi.advanceTimersByTimeAsync(0);
    
    // Wait for retry delay
    await vi.advanceTimersByTimeAsync(100);
    
    const result = await promise;
    
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('should not retry on non-retryable errors', async () => {
    const operation = vi.fn()
      .mockRejectedValue(new Error('Puter API error (401): Unauthorized'));
    
    await expect(withRetry(operation, { maxRetries: 3 }))
      .rejects.toThrow('Unauthorized');
    
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should throw after max retries', async () => {
    // Use real timers for this test to avoid unhandled rejection issues
    vi.useRealTimers();
    
    const error = new Error('Puter API error (500): Server error');
    let callCount = 0;
    const operation = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.reject(error);
    });
    
    // Use very short delays for fast test execution
    await expect(
      withRetry(operation, { maxRetries: 2, initialDelay: 1, maxDelay: 5, jitter: false })
    ).rejects.toThrow('Server error');
    
    expect(callCount).toBe(3); // Initial + 2 retries
    
    // Restore fake timers for other tests
    vi.useFakeTimers();
  });

  it('should call onRetry callback', async () => {
    const onRetry = vi.fn();
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('Puter API error (500): Server error'))
      .mockResolvedValueOnce('success');
    
    const promise = withRetry(operation, { 
      maxRetries: 3, 
      initialDelay: 100, 
      jitter: false,
      onRetry 
    });
    
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);
    
    await promise;
    
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), 100);
  });

  it('should use exponential backoff', async () => {
    const onRetry = vi.fn();
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('Puter API error (500): Error'))
      .mockRejectedValueOnce(new Error('Puter API error (500): Error'))
      .mockResolvedValueOnce('success');
    
    const promise = withRetry(operation, { 
      maxRetries: 3, 
      initialDelay: 100,
      backoffFactor: 2,
      jitter: false,
      onRetry 
    });
    
    await vi.advanceTimersByTimeAsync(0);   // First attempt fails
    await vi.advanceTimersByTimeAsync(100); // First retry (100ms delay)
    await vi.advanceTimersByTimeAsync(200); // Second retry (200ms delay)
    
    await promise;
    
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error), 100);
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error), 200);
  });
});

describe('RetryError', () => {
  it('should contain attempt count and last error', () => {
    const lastError = new Error('Original error');
    const retryError = new RetryError('Failed after retries', 3, lastError);
    
    expect(retryError.name).toBe('RetryError');
    expect(retryError.message).toBe('Failed after retries');
    expect(retryError.attempts).toBe(3);
    expect(retryError.lastError).toBe(lastError);
  });
});
