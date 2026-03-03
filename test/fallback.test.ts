/**
 * Tests for FallbackManager
 * 
 * Tests the automatic model fallback functionality when rate limits are encountered.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  FallbackManager,
  isRateLimitError,
  extractHttpStatus,
  classifyError,
  getErrorTypeDescription,
  FallbackExhaustedError,
  DEFAULT_FALLBACK_MODELS,
  DEFAULT_COOLDOWN_MS,
  getGlobalFallbackManager,
  resetGlobalFallbackManager,
  type FallbackErrorType,
} from '../src/fallback.js';
import { nullLogger } from '../src/logger.js';

describe('isRateLimitError', () => {
  it('should detect HTTP 429 errors', () => {
    expect(isRateLimitError(new Error('Puter API error (429): Too many requests'))).toBe(true);
    expect(isRateLimitError(new Error('Status 429: Rate limited'))).toBe(true);
  });

  it('should detect HTTP 403 errors (Puter account limits)', () => {
    expect(isRateLimitError(new Error('Puter API error (403): Forbidden'))).toBe(true);
    expect(isRateLimitError(new Error('Status 403: Access denied'))).toBe(true);
  });

  it('should detect rate limit error messages', () => {
    expect(isRateLimitError(new Error('Rate limit exceeded'))).toBe(true);
    expect(isRateLimitError(new Error('rate_limit_exceeded'))).toBe(true);
    expect(isRateLimitError(new Error('Too many requests, please try again later'))).toBe(true);
    expect(isRateLimitError(new Error('Quota exceeded for this model'))).toBe(true);
    expect(isRateLimitError(new Error('Credits exhausted'))).toBe(true);
    expect(isRateLimitError(new Error('usage-limited-chat: Permission denied'))).toBe(true);
    expect(isRateLimitError(new Error('You have reached your AI usage limit'))).toBe(true);
    expect(isRateLimitError(new Error('insufficient_quota'))).toBe(true);
  });

  it('should not detect non-rate-limit errors', () => {
    expect(isRateLimitError(new Error('Invalid API key'))).toBe(false);
    expect(isRateLimitError(new Error('Model not found'))).toBe(false);
    expect(isRateLimitError(new Error('Internal server error'))).toBe(false);
    expect(isRateLimitError(new Error('Connection timeout'))).toBe(false);
  });

  it('should handle non-Error values', () => {
    expect(isRateLimitError('rate limit')).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
    expect(isRateLimitError(undefined)).toBe(false);
    expect(isRateLimitError({ message: 'rate limit' })).toBe(false);
  });
});

describe('extractHttpStatus', () => {
  it('should extract status from parentheses format (429)', () => {
    expect(extractHttpStatus(new Error('Puter API error (429): Too many requests'))).toBe(429);
    expect(extractHttpStatus(new Error('Error (500) occurred'))).toBe(500);
    expect(extractHttpStatus(new Error('Something (403) forbidden'))).toBe(403);
  });

  it('should extract status from "status" format', () => {
    expect(extractHttpStatus(new Error('Status 429: Rate limited'))).toBe(429);
    expect(extractHttpStatus(new Error('status: 503 Service Unavailable'))).toBe(503);
    expect(extractHttpStatus(new Error('HTTP status 401'))).toBe(401);
  });

  it('should extract status from "HTTP" format', () => {
    expect(extractHttpStatus(new Error('HTTP 502 Bad Gateway'))).toBe(502);
    expect(extractHttpStatus(new Error('HTTP: 504 timeout'))).toBe(504);
  });

  it('should extract status from "code" format', () => {
    expect(extractHttpStatus(new Error('code: 429'))).toBe(429);
    expect(extractHttpStatus(new Error('Error code 500'))).toBe(500);
  });

  it('should extract status from "NNN error" format', () => {
    expect(extractHttpStatus(new Error('429 error from server'))).toBe(429);
    expect(extractHttpStatus(new Error('503 Error: Service down'))).toBe(503);
  });

  it('should return undefined for non-HTTP status errors', () => {
    expect(extractHttpStatus(new Error('Something went wrong'))).toBeUndefined();
    expect(extractHttpStatus(new Error('Invalid model'))).toBeUndefined();
    expect(extractHttpStatus(new Error(''))).toBeUndefined();
  });

  it('should return undefined for invalid status codes', () => {
    // Status codes must be 100-599
    expect(extractHttpStatus(new Error('Error (999)'))).toBeUndefined();
    expect(extractHttpStatus(new Error('Error (50)'))).toBeUndefined();
  });

  it('should handle non-Error values', () => {
    expect(extractHttpStatus('error (429)')).toBeUndefined();
    expect(extractHttpStatus(null)).toBeUndefined();
    expect(extractHttpStatus(undefined)).toBeUndefined();
  });
});

describe('classifyError', () => {
  it('should classify rate limit errors (429)', () => {
    expect(classifyError(new Error('Error (429): Too many requests'))).toBe('rate_limit');
    expect(classifyError(new Error('Rate limit exceeded'))).toBe('rate_limit');
    expect(classifyError(new Error('quota exceeded'))).toBe('rate_limit');
  });

  it('should classify forbidden errors (403)', () => {
    expect(classifyError(new Error('Error (403): Forbidden'))).toBe('forbidden');
  });

  it('should classify auth errors (401)', () => {
    expect(classifyError(new Error('Error (401): Unauthorized'))).toBe('auth_error');
    expect(classifyError(new Error('Authentication failed'))).toBe('auth_error');
    expect(classifyError(new Error('Unauthorized access'))).toBe('auth_error');
    expect(classifyError(new Error('Invalid key provided'))).toBe('auth_error');
    expect(classifyError(new Error('Invalid token provided'))).toBe('auth_error');
  });

  it('should classify not found errors (404)', () => {
    expect(classifyError(new Error('Error (404): Not found'))).toBe('not_found');
    expect(classifyError(new Error('Model does not exist'))).toBe('not_found');
    expect(classifyError(new Error('Unknown model requested'))).toBe('not_found');
  });

  it('should classify server errors (5xx)', () => {
    expect(classifyError(new Error('Error (500): Internal server error'))).toBe('server_error');
    expect(classifyError(new Error('Error (502): Bad gateway'))).toBe('server_error');
    expect(classifyError(new Error('Error (503): Service unavailable'))).toBe('server_error');
    expect(classifyError(new Error('Error (504): Gateway timeout'))).toBe('server_error');
    expect(classifyError(new Error('Service unavailable'))).toBe('server_error');
  });

  it('should classify timeout errors', () => {
    expect(classifyError(new Error('Request timeout'))).toBe('timeout');
    expect(classifyError(new Error('Connection timed out'))).toBe('timeout');
  });

  it('should classify context length errors', () => {
    expect(classifyError(new Error('Context length exceeded'))).toBe('context_length');
    expect(classifyError(new Error('Context too long for model'))).toBe('context_length');
    expect(classifyError(new Error('Maximum context exceeded'))).toBe('context_length');
  });

  it('should return unknown for unrecognized errors', () => {
    expect(classifyError(new Error('Something random happened'))).toBe('unknown');
    expect(classifyError(new Error(''))).toBe('unknown');
  });

  it('should handle non-Error values', () => {
    expect(classifyError('rate limit')).toBe('unknown');
    expect(classifyError(null)).toBe('unknown');
    expect(classifyError(undefined)).toBe('unknown');
  });
});

describe('getErrorTypeDescription', () => {
  it('should return human-readable descriptions for all error types', () => {
    const types: FallbackErrorType[] = [
      'rate_limit', 'forbidden', 'server_error', 'timeout',
      'auth_error', 'not_found', 'context_length', 'unknown'
    ];
    
    const descriptions: Record<FallbackErrorType, string> = {
      'rate_limit': 'Rate Limited',
      'forbidden': 'Access Denied',
      'server_error': 'Server Error',
      'timeout': 'Timeout',
      'auth_error': 'Auth Error',
      'not_found': 'Not Found',
      'context_length': 'Context Too Long',
      'unknown': 'Error',
    };
    
    for (const type of types) {
      expect(getErrorTypeDescription(type)).toBe(descriptions[type]);
    }
  });
});

describe('FallbackManager', () => {
  let manager: FallbackManager;

  beforeEach(() => {
    manager = new FallbackManager({
      fallbackModels: ['fallback-model-1', 'fallback-model-2'],
      cooldownMs: 1000, // 1 second for faster tests
    });
  });

  describe('constructor', () => {
    it('should use default values when no options provided', () => {
      const defaultManager = new FallbackManager();
      const config = defaultManager.getConfig();
      
      expect(config.fallbackModels).toEqual(DEFAULT_FALLBACK_MODELS);
      expect(config.cooldownMs).toBe(DEFAULT_COOLDOWN_MS);
      expect(config.enabled).toBe(true);
    });

    it('should accept custom options', () => {
      const customManager = new FallbackManager({
        fallbackModels: ['custom-model'],
        cooldownMs: 5000,
        enabled: false,
      });
      const config = customManager.getConfig();
      
      expect(config.fallbackModels).toEqual(['custom-model']);
      expect(config.cooldownMs).toBe(5000);
      expect(config.enabled).toBe(false);
    });
  });

  describe('cooldown management', () => {
    it('should not have models on cooldown initially', () => {
      expect(manager.isModelOnCooldown('claude-opus-4-5')).toBe(false);
      expect(manager.getCooldownRemaining('claude-opus-4-5')).toBe(0);
    });

    it('should add models to cooldown', () => {
      manager.addToCooldown('claude-opus-4-5', 'Rate limited');
      
      expect(manager.isModelOnCooldown('claude-opus-4-5')).toBe(true);
      expect(manager.getCooldownRemaining('claude-opus-4-5')).toBeGreaterThan(0);
      expect(manager.getCooldownRemaining('claude-opus-4-5')).toBeLessThanOrEqual(1000);
    });

    it('should remove models from cooldown', () => {
      manager.addToCooldown('claude-opus-4-5', 'Rate limited');
      expect(manager.isModelOnCooldown('claude-opus-4-5')).toBe(true);
      
      manager.removeFromCooldown('claude-opus-4-5');
      expect(manager.isModelOnCooldown('claude-opus-4-5')).toBe(false);
    });

    it('should expire cooldowns automatically', async () => {
      manager = new FallbackManager({
        fallbackModels: ['fallback-model-1'],
        cooldownMs: 50, // Very short cooldown
      });
      
      manager.addToCooldown('test-model', 'Rate limited');
      expect(manager.isModelOnCooldown('test-model')).toBe(true);
      
      // Wait for cooldown to expire
      await new Promise(resolve => setTimeout(resolve, 60));
      
      expect(manager.isModelOnCooldown('test-model')).toBe(false);
    });

    it('should support custom cooldown duration per model', () => {
      manager.addToCooldown('model-a', 'Rate limited', 500);
      manager.addToCooldown('model-b', 'Rate limited', 2000);
      
      expect(manager.getCooldownRemaining('model-a')).toBeLessThanOrEqual(500);
      expect(manager.getCooldownRemaining('model-b')).toBeGreaterThan(500);
    });

    it('should return cooldown status for all models', () => {
      manager.addToCooldown('model-a', 'Error A');
      manager.addToCooldown('model-b', 'Error B');
      
      const status = manager.getCooldownStatus();
      
      expect(status.size).toBe(2);
      expect(status.get('model-a')?.reason).toBe('Error A');
      expect(status.get('model-b')?.reason).toBe('Error B');
    });

    it('should clear all cooldowns', () => {
      manager.addToCooldown('model-a', 'Error');
      manager.addToCooldown('model-b', 'Error');
      
      expect(manager.getCooldownStatus().size).toBe(2);
      
      manager.clearCooldowns();
      
      expect(manager.getCooldownStatus().size).toBe(0);
    });
  });

  describe('buildModelQueue', () => {
    it('should include primary model first when not on cooldown', () => {
      const queue = manager.buildModelQueue('primary-model');
      
      expect(queue[0]).toBe('primary-model');
      expect(queue).toContain('fallback-model-1');
      expect(queue).toContain('fallback-model-2');
    });

    it('should exclude primary model when on cooldown', () => {
      manager.addToCooldown('primary-model', 'Rate limited');
      
      const queue = manager.buildModelQueue('primary-model');
      
      expect(queue[0]).not.toBe('primary-model');
      expect(queue).toContain('fallback-model-1');
    });

    it('should exclude fallback models that are on cooldown', () => {
      manager.addToCooldown('fallback-model-1', 'Rate limited');
      
      const queue = manager.buildModelQueue('primary-model');
      
      expect(queue).toContain('primary-model');
      expect(queue).not.toContain('fallback-model-1');
      expect(queue).toContain('fallback-model-2');
    });

    it('should add primary model if all others are on cooldown', () => {
      manager.addToCooldown('primary-model', 'Rate limited');
      manager.addToCooldown('fallback-model-1', 'Rate limited');
      manager.addToCooldown('fallback-model-2', 'Rate limited');
      
      const queue = manager.buildModelQueue('primary-model');
      
      // Should still have primary as last resort
      expect(queue).toContain('primary-model');
    });

    it('should not duplicate primary model in queue', () => {
      // If primary model is also in fallback list
      manager = new FallbackManager({
        fallbackModels: ['primary-model', 'fallback-model-1'],
        cooldownMs: 1000,
      });
      
      const queue = manager.buildModelQueue('primary-model');
      
      // Primary should only appear once
      expect(queue.filter(m => m === 'primary-model').length).toBe(1);
    });
  });

  describe('executeWithFallback', () => {
    it('should return result from successful primary model', async () => {
      const operation = vi.fn().mockResolvedValue('success');
      
      const result = await manager.executeWithFallback(
        'primary-model',
        operation,
        nullLogger
      );
      
      expect(result.result).toBe('success');
      expect(result.usedModel).toBe('primary-model');
      expect(result.wasFallback).toBe(false);
      expect(result.attempts).toHaveLength(1);
      expect(result.attempts[0].success).toBe(true);
    });

    it('should fallback to next model on rate limit error', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('Rate limit exceeded (429)'))
        .mockResolvedValue('success from fallback');
      
      const result = await manager.executeWithFallback(
        'primary-model',
        operation,
        nullLogger
      );
      
      expect(result.result).toBe('success from fallback');
      expect(result.usedModel).toBe('fallback-model-1');
      expect(result.wasFallback).toBe(true);
      expect(result.attempts).toHaveLength(2);
      expect(result.attempts[0].success).toBe(false);
      expect(result.attempts[0].isRateLimit).toBe(true);
      expect(result.attempts[1].success).toBe(true);
    });

    it('should add rate-limited models to cooldown', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('Rate limit exceeded (429)'))
        .mockResolvedValue('success');
      
      await manager.executeWithFallback('primary-model', operation, nullLogger);
      
      expect(manager.isModelOnCooldown('primary-model')).toBe(true);
    });

    it('should try multiple fallbacks if needed', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('Rate limit exceeded (429)'))
        .mockRejectedValueOnce(new Error('Rate limit exceeded (429)'))
        .mockResolvedValue('success from second fallback');
      
      const result = await manager.executeWithFallback(
        'primary-model',
        operation,
        nullLogger
      );
      
      expect(result.result).toBe('success from second fallback');
      expect(result.usedModel).toBe('fallback-model-2');
      expect(result.attempts).toHaveLength(3);
    });

    it('should throw FallbackExhaustedError when all models fail', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Rate limit exceeded (429)'));
      
      await expect(
        manager.executeWithFallback('primary-model', operation, nullLogger)
      ).rejects.toThrow(FallbackExhaustedError);
    });

    it('should include all attempts in FallbackExhaustedError', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Rate limit exceeded (429)'));
      
      try {
        await manager.executeWithFallback('primary-model', operation, nullLogger);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(FallbackExhaustedError);
        const fallbackError = error as FallbackExhaustedError;
        expect(fallbackError.attempts).toHaveLength(3); // primary + 2 fallbacks
      }
    });

    it('should skip models already on cooldown', async () => {
      manager.addToCooldown('primary-model', 'Already limited');
      
      const operation = vi.fn().mockResolvedValue('success');
      
      const result = await manager.executeWithFallback(
        'primary-model',
        operation,
        nullLogger
      );
      
      // Should skip primary and go directly to fallback
      expect(result.usedModel).toBe('fallback-model-1');
      expect(result.wasFallback).toBe(true);
      expect(operation).toHaveBeenCalledWith('fallback-model-1');
      expect(operation).not.toHaveBeenCalledWith('primary-model');
    });

    it('should pass correct model to operation function', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('Rate limit exceeded (429)'))
        .mockResolvedValue('success');
      
      await manager.executeWithFallback('primary-model', operation, nullLogger);
      
      expect(operation).toHaveBeenCalledWith('primary-model');
      expect(operation).toHaveBeenCalledWith('fallback-model-1');
    });

    it('should handle non-rate-limit errors gracefully', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('Invalid model'))
        .mockResolvedValue('success from fallback');
      
      const result = await manager.executeWithFallback(
        'primary-model',
        operation,
        nullLogger
      );
      
      // Should still fallback on non-rate-limit errors
      expect(result.wasFallback).toBe(true);
      expect(result.attempts[0].isRateLimit).toBe(false);
      
      // But should not add to cooldown
      expect(manager.isModelOnCooldown('primary-model')).toBe(false);
    });

    it('should skip fallback when disabled', async () => {
      manager = new FallbackManager({
        fallbackModels: ['fallback-model-1'],
        cooldownMs: 1000,
        enabled: false,
      });
      
      const operation = vi.fn().mockRejectedValue(new Error('Rate limit exceeded (429)'));
      
      // Should throw immediately without trying fallbacks
      await expect(
        manager.executeWithFallback('primary-model', operation, nullLogger)
      ).rejects.toThrow('Rate limit exceeded');
      
      // Should only have called operation once
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should include errorType and httpStatus in FallbackAttempt', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('Error (429): Rate limit exceeded'))
        .mockResolvedValue('success');
      
      const result = await manager.executeWithFallback(
        'primary-model',
        operation,
        nullLogger
      );
      
      const failedAttempt = result.attempts[0];
      expect(failedAttempt.success).toBe(false);
      expect(failedAttempt.errorType).toBe('rate_limit');
      expect(failedAttempt.httpStatus).toBe(429);
      expect(failedAttempt.isRateLimit).toBe(true);
      expect(failedAttempt.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should classify different error types correctly in attempts', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('Error (403): Forbidden'))
        .mockRejectedValueOnce(new Error('Error (500): Server error'))
        .mockResolvedValue('success');
      
      manager = new FallbackManager({
        fallbackModels: ['fallback-1', 'fallback-2'],
        cooldownMs: 1000,
      });
      
      const result = await manager.executeWithFallback(
        'primary-model',
        operation,
        nullLogger
      );
      
      expect(result.attempts[0].errorType).toBe('forbidden');
      expect(result.attempts[0].httpStatus).toBe(403);
      expect(result.attempts[1].errorType).toBe('server_error');
      expect(result.attempts[1].httpStatus).toBe(500);
    });
  });

  describe('verbose and quiet modes', () => {
    it('should accept verbose option in constructor', () => {
      const verboseManager = new FallbackManager({ verbose: true });
      expect(verboseManager.getConfig().verbose).toBe(true);
    });

    it('should accept quiet option in constructor', () => {
      const quietManager = new FallbackManager({ quiet: true });
      expect(quietManager.getConfig().quiet).toBe(true);
    });

    it('should default verbose and quiet to false', () => {
      const defaultManager = new FallbackManager();
      expect(defaultManager.getConfig().verbose).toBe(false);
      expect(defaultManager.getConfig().quiet).toBe(false);
    });

    it('should configure verbose mode', () => {
      manager.configure({ verbose: true });
      expect(manager.getConfig().verbose).toBe(true);
    });

    it('should configure quiet mode', () => {
      manager.configure({ quiet: true });
      expect(manager.getConfig().quiet).toBe(true);
    });

    it('should execute successfully in verbose mode', async () => {
      manager = new FallbackManager({
        fallbackModels: ['fallback-model-1'],
        cooldownMs: 1000,
        verbose: true,
      });
      
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('Rate limit exceeded (429)'))
        .mockResolvedValue('success');
      
      const result = await manager.executeWithFallback(
        'primary-model',
        operation,
        nullLogger
      );
      
      expect(result.wasFallback).toBe(true);
      expect(result.result).toBe('success');
    });

    it('should execute successfully in quiet mode', async () => {
      manager = new FallbackManager({
        fallbackModels: ['fallback-model-1'],
        cooldownMs: 1000,
        quiet: true,
      });
      
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('Rate limit exceeded (429)'))
        .mockResolvedValue('success');
      
      const result = await manager.executeWithFallback(
        'primary-model',
        operation,
        nullLogger
      );
      
      expect(result.wasFallback).toBe(true);
      expect(result.result).toBe('success');
    });
  });

  describe('configure', () => {
    it('should update fallback models', () => {
      manager.configure({ fallbackModels: ['new-model'] });
      
      const config = manager.getConfig();
      expect(config.fallbackModels).toEqual(['new-model']);
    });

    it('should update cooldown duration', () => {
      manager.configure({ cooldownMs: 5000 });
      
      const config = manager.getConfig();
      expect(config.cooldownMs).toBe(5000);
    });

    it('should update enabled state', () => {
      manager.configure({ enabled: false });
      
      const config = manager.getConfig();
      expect(config.enabled).toBe(false);
    });
  });
});

describe('Global FallbackManager', () => {
  beforeEach(() => {
    resetGlobalFallbackManager();
  });

  it('should create global instance with defaults', () => {
    const manager = getGlobalFallbackManager();
    
    expect(manager).toBeInstanceOf(FallbackManager);
    expect(manager.getConfig().fallbackModels).toEqual(DEFAULT_FALLBACK_MODELS);
  });

  it('should return same instance on subsequent calls', () => {
    const manager1 = getGlobalFallbackManager();
    const manager2 = getGlobalFallbackManager();
    
    expect(manager1).toBe(manager2);
  });

  it('should apply options when creating', () => {
    const manager = getGlobalFallbackManager({
      fallbackModels: ['custom-model'],
      cooldownMs: 5000,
    });
    
    const config = manager.getConfig();
    expect(config.fallbackModels).toEqual(['custom-model']);
    expect(config.cooldownMs).toBe(5000);
  });

  it('should update config when called with options on existing instance', () => {
    const manager1 = getGlobalFallbackManager({ cooldownMs: 1000 });
    expect(manager1.getConfig().cooldownMs).toBe(1000);
    
    // Update existing instance
    const manager2 = getGlobalFallbackManager({ cooldownMs: 5000 });
    expect(manager2.getConfig().cooldownMs).toBe(5000);
    
    // Same instance
    expect(manager1).toBe(manager2);
  });

  it('should reset global instance', () => {
    const manager1 = getGlobalFallbackManager();
    manager1.addToCooldown('test-model', 'Error');
    
    resetGlobalFallbackManager();
    
    const manager2 = getGlobalFallbackManager();
    expect(manager2).not.toBe(manager1);
    expect(manager2.isModelOnCooldown('test-model')).toBe(false);
  });
});

describe('FallbackExhaustedError', () => {
  it('should include attempts in error', () => {
    const attempts = [
      { model: 'model-a', success: false, error: 'Error A', isRateLimit: true },
      { model: 'model-b', success: false, error: 'Error B', isRateLimit: true },
    ];
    
    const error = new FallbackExhaustedError(attempts);
    
    expect(error.attempts).toEqual(attempts);
    expect(error.message).toContain('model-a');
    expect(error.message).toContain('model-b');
    expect(error.message).toContain('What to try next');
    expect(error.name).toBe('FallbackExhaustedError');
  });
});
