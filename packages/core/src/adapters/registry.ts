import { AppError } from '../errors.js';
import type { CliAdapter } from './types.js';

export class AdapterRegistry {
  private readonly adapters = new Map<string, CliAdapter>();

  register(type: string, adapter: CliAdapter): void {
    this.adapters.set(type, adapter);
  }
  get(type: string): CliAdapter {
    const a = this.adapters.get(type);
    if (!a) throw new AppError('unknown_cli_type', `Unknown cli type: ${type}`);
    return a;
  }
  has(type: string): boolean { return this.adapters.has(type); }
  list(): string[] { return [...this.adapters.keys()]; }
  async listAvailable(): Promise<{ type: string; available: boolean }[]> {
    const out: { type: string; available: boolean }[] = [];
    for (const [type, adapter] of this.adapters) {
      out.push({ type, available: (await adapter.detect()).available });
    }
    return out;
  }
}
