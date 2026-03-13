import os from 'node:os';
import path from 'node:path';
import { config as xdgConfig, cache as xdgCache } from 'xdg-basedir';

export function getConfigDir(): string {
  if (xdgConfig) {
    return path.join(xdgConfig, 'opencode');
  }
  return path.join(os.homedir(), '.config', 'opencode');
}

export function getCacheDir(): string {
  if (xdgCache) {
    return path.join(xdgCache, 'opencode');
  }
  return path.join(os.homedir(), '.cache', 'opencode');
}

export function expandTildePath(input: string): string {
  if (!input.startsWith('~/')) return input;
  return path.join(os.homedir(), input.slice(2));
}
