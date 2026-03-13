import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getConfigDir } from './paths.js';
import { PuterConfigSchema, type PuterConfig } from './types.js';

export async function loadPuterConfig(configDir = getConfigDir()): Promise<Partial<PuterConfig>> {
  const configPath = path.join(configDir, 'puter.json');
  try {
    const data = await fsPromises.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(data);
    return PuterConfigSchema.partial().parse(parsed);
  } catch {
    return {};
  }
}

export function loadPuterConfigSync(configDir = getConfigDir()): Partial<PuterConfig> {
  const configPath = path.join(configDir, 'puter.json');
  try {
    const data = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(data);
    return PuterConfigSchema.partial().parse(parsed);
  } catch {
    return {};
  }
}
