import fs from 'node:fs/promises';
import path from 'node:path';
import { classifyError } from './fallback.js';
import { expandTildePath, getConfigDir } from './paths.js';

export interface ModelMetrics {
  model: string;
  requestCount: number;
  successCount: number;
  failureCount: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  avgTokensPerSecond: number;
  lastUsed?: string;
  errorTypes: Record<string, number>;
}

interface ModelMetricsEntry extends ModelMetrics {
  latencySamples: number[];
  tpsSamples: number[];
  lastUsed?: string;
}

interface MetricsFile {
  version: number;
  models: Record<string, ModelMetricsEntry>;
}

export interface MetricsOptions {
  enabled: boolean;
  maxSamples: number;
  filePath?: string;
}

function percentile(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * pct)));
  return sorted[idx];
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  const total = values.reduce((sum, v) => sum + v, 0);
  return total / values.length;
}

export class ModelMetricsStore {
  private enabled: boolean;
  private maxSamples: number;
  private filePath?: string;

  constructor(options: Partial<MetricsOptions> = {}) {
    this.enabled = options.enabled ?? true;
    this.maxSamples = options.maxSamples ?? 200;
    this.filePath = options.filePath;
  }

  private resolveFilePath(): string {
    if (this.filePath) {
      return expandTildePath(this.filePath);
    }
    return path.join(getConfigDir(), 'puter-metrics.json');
  }

  private async load(): Promise<MetricsFile> {
    const filePath = this.resolveFilePath();
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as MetricsFile;
      if (!parsed.models) {
        return { version: 1, models: {} };
      }
      return parsed;
    } catch {
      return { version: 1, models: {} };
    }
  }

  private async save(data: MetricsFile): Promise<void> {
    const filePath = this.resolveFilePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private getEntry(data: MetricsFile, model: string): ModelMetricsEntry {
    if (!data.models[model]) {
      data.models[model] = {
        model,
        requestCount: 0,
        successCount: 0,
        failureCount: 0,
        avgLatencyMs: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        avgTokensPerSecond: 0,
        errorTypes: {},
        latencySamples: [],
        tpsSamples: [],
      };
    }
    return data.models[model];
  }

  private updateStats(entry: ModelMetricsEntry): void {
    entry.avgLatencyMs = average(entry.latencySamples);
    entry.p50LatencyMs = percentile(entry.latencySamples, 0.5);
    entry.p95LatencyMs = percentile(entry.latencySamples, 0.95);
    entry.avgTokensPerSecond = average(entry.tpsSamples);
  }

  private pushSample(list: number[], value: number): void {
    list.push(value);
    if (list.length > this.maxSamples) {
      list.splice(0, list.length - this.maxSamples);
    }
  }

  async recordSuccess(model: string, latencyMs: number, usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }): Promise<void> {
    if (!this.enabled) return;
    const data = await this.load();
    const entry = this.getEntry(data, model);

    entry.requestCount += 1;
    entry.successCount += 1;
    entry.lastUsed = new Date().toISOString();

    if (Number.isFinite(latencyMs) && latencyMs >= 0) {
      this.pushSample(entry.latencySamples, latencyMs);
    }

    const totalTokens = usage?.total_tokens ?? usage?.completion_tokens ?? usage?.prompt_tokens;
    if (totalTokens && latencyMs > 0) {
      const tps = totalTokens / (latencyMs / 1000);
      this.pushSample(entry.tpsSamples, tps);
    }

    this.updateStats(entry);
    await this.save(data);
  }

  async recordFailure(model: string, latencyMs: number, error: unknown): Promise<void> {
    if (!this.enabled) return;
    const data = await this.load();
    const entry = this.getEntry(data, model);

    entry.requestCount += 1;
    entry.failureCount += 1;
    entry.lastUsed = new Date().toISOString();

    if (Number.isFinite(latencyMs) && latencyMs >= 0) {
      this.pushSample(entry.latencySamples, latencyMs);
    }

    const errorType = classifyError(error);
    entry.errorTypes[errorType] = (entry.errorTypes[errorType] ?? 0) + 1;

    this.updateStats(entry);
    await this.save(data);
  }

  async getMetrics(model?: string): Promise<ModelMetrics[] | ModelMetrics | null> {
    const data = await this.load();
    if (model) {
      return data.models[model] ?? null;
    }
    return Object.values(data.models);
  }

  async reset(model?: string): Promise<void> {
    if (!this.enabled) return;
    if (model) {
      const data = await this.load();
      delete data.models[model];
      await this.save(data);
      return;
    }
    await this.save({ version: 1, models: {} });
  }
}
