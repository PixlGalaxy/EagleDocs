import type { Logger, SearchHit, SearchPort } from '../ports.js';

/** One search backend in a chain. */
export interface SearchProvider {
  /** Shown in logs and in `lastProvider`, e.g. "searxng". */
  name: string;
  search: SearchPort['search'];
  /** Checked before each search: false skips it (e.g. a paid API with no key set). Default: always on. */
  enabled?: () => boolean | Promise<boolean>;
}

export interface SearchChainOptions {
  /** How long a provider that failed is skipped. Default 5 minutes. */
  cooldownMs?: number;
  logger?: Logger;
  /** For tests. */
  now?: () => number;
}

/**
 * Tries search providers in order and returns the first results: a provider
 * that throws (blocked, rate limited, down) is skipped for a while; one that
 * finds nothing passes the query on without a penalty. Providers are listed
 * cheapest first, so a paid API or a real browser only runs when the free ones
 * cannot answer. Only when every provider fails does the search throw.
 */
export class SearchChain implements SearchPort {
  private failedAt = new Map<string, number>();
  private cooldownMs: number;
  private now: () => number;
  /** The provider that answered the last search (for logs and tests). */
  lastProvider: string | null = null;

  constructor(
    private providers: SearchProvider[],
    private options: SearchChainOptions = {},
  ) {
    this.cooldownMs = options.cooldownMs ?? 5 * 60_000;
    this.now = options.now ?? Date.now;
  }

  async search(query: string, options: Parameters<SearchPort['search']>[1]): Promise<SearchHit[]> {
    const errors: string[] = [];
    let emptyFrom: string | null = null;
    const usable: SearchProvider[] = [];
    for (const p of this.providers) if ((await p.enabled?.()) ?? true) usable.push(p);
    // Cooling providers go last instead of out: when every other one fails, they still get a chance.
    const cooling = (p: SearchProvider) => this.now() - (this.failedAt.get(p.name) ?? -Infinity) < this.cooldownMs;
    const ordered = [...usable.filter((p) => !cooling(p)), ...usable.filter(cooling)];
    for (const provider of ordered) {
      if (options.signal.aborted) break;
      try {
        const hits = await provider.search(query, options);
        this.failedAt.delete(provider.name);
        if (hits.length) {
          this.lastProvider = provider.name;
          return hits;
        }
        emptyFrom ??= provider.name;
      } catch (err) {
        if (options.signal.aborted) throw err;
        this.failedAt.set(provider.name, this.now());
        const message = (err as Error).message;
        errors.push(`${provider.name}: ${message}`);
        this.options.logger?.warn(`Web search with ${provider.name} failed, trying the next one: ${message}`);
      }
    }
    this.lastProvider = emptyFrom;
    // Someone answered with no results: that is the answer. Otherwise nobody could search.
    if (emptyFrom || usable.length === 0) {
      if (usable.length === 0) throw new Error('No web search provider is available');
      return [];
    }
    throw new Error(`Web search is not available right now (${errors.join('; ')})`);
  }
}
