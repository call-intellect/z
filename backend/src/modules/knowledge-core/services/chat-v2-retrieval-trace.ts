export interface RetrievalTraceHit {
  blockId: string;
  name: string;
  score: number;
}

export interface RetrievalTracePerQuery {
  query: string;
  semanticHits: RetrievalTraceHit[];
  structuralHits?: RetrievalTraceHit[];
}

export interface RetrievalTraceNeighbor {
  blockId: string;
  name: string;
  viaRelation: string;
  fromBlockId: string;
  confidence: number;
  viaSource?: 'block-link' | 'entity-link' | 'age-cypher';
}

export interface RetrievalTraceGraphExpansion {
  ran: boolean;
  skippedReason?: string;
  seedBlockIds: string[];
  neighborsAdded: RetrievalTraceNeighbor[];
}

export interface RetrievalTrace {
  queries: string[];
  route: 'semantic-only' | 'both';
  graphHops: number;
  perQuery: RetrievalTracePerQuery[];
  poolAfterFusion: RetrievalTraceHit[];
  graphExpansion: RetrievalTraceGraphExpansion;
  afterRerank: RetrievalTraceHit[];
  usedBlockIds: string[];
}

const NAME_MAX = 60;

function clampName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > NAME_MAX ? `${trimmed.slice(0, NAME_MAX)}…` : trimmed;
}

interface RawHit {
  blockId: string;
  score: number;
}

interface RawPerQuery {
  query: string;
  semanticHits: RawHit[];
  structuralHits?: RawHit[];
}

interface RawNeighbor {
  blockId: string;
  viaRelation: string;
  fromBlockId: string;
  confidence: number;
  viaSource?: 'block-link' | 'entity-link' | 'age-cypher';
}

export class RetrievalTraceSink {
  private queries: string[] = [];
  private route: 'semantic-only' | 'both' = 'semantic-only';
  private graphHops = 0;
  private readonly perQuery: RawPerQuery[] = [];
  private poolAfterFusion: RawHit[] = [];
  private graphExpansion: {
    ran: boolean;
    skippedReason?: string;
    seedBlockIds: string[];
    neighborsAdded: RawNeighbor[];
  } = { ran: false, seedBlockIds: [], neighborsAdded: [] };
  private afterRerank: RawHit[] = [];
  private usedBlockIds: string[] = [];

  setQueries(queries: ReadonlyArray<string>): void {
    this.queries = [...queries];
  }

  setRoute(route: 'semantic-only' | 'both'): void {
    this.route = route;
  }

  setGraphHops(graphHops: number): void {
    this.graphHops = graphHops;
  }

  addDoorHits(
    query: string,
    kind: 'semantic' | 'structural',
    hits: ReadonlyArray<RawHit>,
  ): void {
    const entry = this.perQuery.find((p) => p.query === query);
    if (kind === 'semantic') {
      if (entry) entry.semanticHits = [...hits];
      else this.perQuery.push({ query, semanticHits: [...hits] });
    } else {
      if (entry) entry.structuralHits = [...hits];
      else this.perQuery.push({ query, semanticHits: [], structuralHits: [...hits] });
    }
  }

  setStructuralAggregateHits(label: string, hits: ReadonlyArray<RawHit>): void {
    const query = `[структурный маршрут: ${label}]`;
    const existing = this.perQuery.find((p) => p.query === query);
    if (existing) existing.structuralHits = [...hits];
    else this.perQuery.push({ query, semanticHits: [], structuralHits: [...hits] });
  }

  setPool(pool: ReadonlyArray<RawHit>): void {
    this.poolAfterFusion = [...pool];
  }

  markGraphSkipped(reason: string): void {
    this.graphExpansion = {
      ran: false,
      skippedReason: reason,
      seedBlockIds: [],
      neighborsAdded: [],
    };
  }

  addGraphExpansion(seedBlockIds: ReadonlyArray<string>, neighbors: ReadonlyArray<RawNeighbor>): void {
    this.graphExpansion = {
      ran: true,
      seedBlockIds: [...new Set([...this.graphExpansion.seedBlockIds, ...seedBlockIds])],
      neighborsAdded: [...this.graphExpansion.neighborsAdded, ...neighbors],
    };
  }

  setRerank(ids: ReadonlyArray<RawHit>): void {
    this.afterRerank = [...ids];
  }

  setUsedBlockIds(ids: ReadonlyArray<string>): void {
    this.usedBlockIds = [...ids];
  }

  collectBlockIds(): string[] {
    const ids = new Set<string>();
    for (const p of this.perQuery) {
      for (const h of p.semanticHits) ids.add(h.blockId);
      for (const h of p.structuralHits ?? []) ids.add(h.blockId);
    }
    for (const h of this.poolAfterFusion) ids.add(h.blockId);
    for (const s of this.graphExpansion.seedBlockIds) ids.add(s);
    for (const n of this.graphExpansion.neighborsAdded) {
      ids.add(n.blockId);
      ids.add(n.fromBlockId);
    }
    for (const h of this.afterRerank) ids.add(h.blockId);
    for (const id of this.usedBlockIds) ids.add(id);
    return [...ids];
  }

  build(names: ReadonlyMap<string, string>): RetrievalTrace {
    const nameOf = (id: string): string => clampName(names.get(id) ?? id);
    const hit = (h: RawHit): RetrievalTraceHit => ({
      blockId: h.blockId,
      name: nameOf(h.blockId),
      score: h.score,
    });
    return {
      queries: this.queries,
      route: this.route,
      graphHops: this.graphHops,
      perQuery: this.perQuery.map((p) => ({
        query: p.query,
        semanticHits: p.semanticHits.map(hit),
        ...(p.structuralHits ? { structuralHits: p.structuralHits.map(hit) } : {}),
      })),
      poolAfterFusion: this.poolAfterFusion.map(hit),
      graphExpansion: {
        ran: this.graphExpansion.ran,
        ...(this.graphExpansion.skippedReason
          ? { skippedReason: this.graphExpansion.skippedReason }
          : {}),
        seedBlockIds: this.graphExpansion.seedBlockIds,
        neighborsAdded: this.graphExpansion.neighborsAdded.map((n) => ({
          blockId: n.blockId,
          name: nameOf(n.blockId),
          viaRelation: n.viaRelation,
          fromBlockId: n.fromBlockId,
          confidence: n.confidence,
          ...(n.viaSource ? { viaSource: n.viaSource } : {}),
        })),
      },
      afterRerank: this.afterRerank.map(hit),
      usedBlockIds: this.usedBlockIds,
    };
  }
}
