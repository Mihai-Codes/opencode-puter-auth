import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expandTildePath, getCacheDir } from './paths.js';

export interface ResponseCacheOptions {
  enabled: boolean;
  ttlMs: number;
  maxEntries: number;
  directory?: string;
}

interface CacheEntry<T> {
  timestamp: number;
  value: T;
}

export interface CacheStats {
  entries: number;
  bytes: number;
  directory: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeForKey(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === 'function') return undefined;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof URL) return value.toString();
  if (value instanceof Uint8Array) {
    return { __type: 'Uint8Array', data: Buffer.from(value).toString('base64') };
  }
  if (value instanceof ArrayBuffer) {
    return { __type: 'ArrayBuffer', data: Buffer.from(value).toString('base64') };
  }
  if (Array.isArray(value)) {
    return value.map(item => normalizeForKey(item));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    const keys = Object.keys(value).sort();
    for (const key of keys) {
      const normalized = normalizeForKey(value[key]);
      if (normalized !== undefined) {
        out[key] = normalized;
      }
    }
    return out;
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForKey(value));
}

export function buildCacheKey(input: unknown): string {
  const raw = stableStringify(input);
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export class ResponseCache<T> {
  private enabled: boolean;
  private ttlMs: number;
  private maxEntries: number;
  private directory?: string;

  constructor(options: Partial<ResponseCacheOptions> = {}) {
    this.enabled = options.enabled ?? false;
    this.ttlMs = options.ttlMs ?? 300000;
    this.maxEntries = options.maxEntries ?? 100;
    this.directory = options.directory;
  }

  private resolveDirectory(): string {
    if (this.directory) {
      return expandTildePath(this.directory);
    }
    return path.join(getCacheDir(), 'puter-responses');
  }

  private async ensureDir(): Promise<string> {
    const dir = this.resolveDirectory();
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  private getEntryPath(dir: string, key: string): string {
    return path.join(dir, `${key}.json`);
  }

  async get(key: string): Promise<T | null> {
    if (!this.enabled) return null;
    const dir = this.resolveDirectory();
    const filePath = this.getEntryPath(dir, key);
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const entry = JSON.parse(data) as CacheEntry<T>;
      if (!entry?.timestamp) return null;
      const age = Date.now() - entry.timestamp;
      if (age > this.ttlMs) {
        await fs.rm(filePath, { force: true });
        return null;
      }
      return entry.value ?? null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: T): Promise<void> {
    if (!this.enabled) return;
    const dir = await this.ensureDir();
    const filePath = this.getEntryPath(dir, key);
    const entry: CacheEntry<T> = {
      timestamp: Date.now(),
      value,
    };
    await fs.writeFile(filePath, JSON.stringify(entry), 'utf-8');
    await this.prune(dir);
  }

  async clear(): Promise<void> {
    const dir = this.resolveDirectory();
    try {
      const entries = await fs.readdir(dir);
      await Promise.all(entries.map(entry => fs.rm(path.join(dir, entry), { force: true, recursive: true })));
    } catch {
      // ignore if missing
    }
  }

  async getStats(): Promise<CacheStats> {
    const dir = this.resolveDirectory();
    try {
      const entries = await fs.readdir(dir);
      let bytes = 0;
      await Promise.all(
        entries.map(async (entry) => {
          try {
            const stat = await fs.stat(path.join(dir, entry));
            bytes += stat.size;
          } catch {
            // ignore
          }
        })
      );
      return { entries: entries.length, bytes, directory: dir };
    } catch {
      return { entries: 0, bytes: 0, directory: dir };
    }
  }

  private async prune(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir);
      const now = Date.now();
      const withTimestamps: Array<{ file: string; timestamp: number }> = [];

      for (const entry of entries) {
        const filePath = path.join(dir, entry);
        try {
          const raw = await fs.readFile(filePath, 'utf-8');
          const data = JSON.parse(raw) as CacheEntry<T>;
          if (!data?.timestamp) {
            await fs.rm(filePath, { force: true });
            continue;
          }
          if (now - data.timestamp > this.ttlMs) {
            await fs.rm(filePath, { force: true });
            continue;
          }
          withTimestamps.push({ file: filePath, timestamp: data.timestamp });
        } catch {
          await fs.rm(filePath, { force: true });
        }
      }

      if (withTimestamps.length <= this.maxEntries) return;

      withTimestamps.sort((a, b) => a.timestamp - b.timestamp);
      const toRemove = withTimestamps.slice(0, withTimestamps.length - this.maxEntries);
      await Promise.all(toRemove.map(entry => fs.rm(entry.file, { force: true })));
    } catch {
      // ignore pruning errors
    }
  }
}
