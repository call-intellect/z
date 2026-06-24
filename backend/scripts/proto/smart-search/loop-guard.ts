export function fingerprint(q: string): string {
  return q.toLowerCase().replace(/[^a-zа-я0-9]+/gi, ' ').trim();
}

export class LoopGuard {
  private readonly seen = new Set<string>();
  private hits = 0;

  firstTime(q: string): boolean {
    const fp = fingerprint(q);
    if (this.seen.has(fp)) {
      this.hits++;
      return false;
    }
    this.seen.add(fp);
    return true;
  }

  get hitCount(): number {
    return this.hits;
  }
}
