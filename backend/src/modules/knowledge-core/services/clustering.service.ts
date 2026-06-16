import { Injectable } from '@nestjs/common';

export interface BlockCluster {
  blockIds: string[];
  representative: string;
}

export interface ClusterableBlock {
  id: string;
  embedding: number[];
}

@Injectable()
export class ClusteringService {
  clusterByEmbedding(
    blocks: ClusterableBlock[],
    threshold: number,
    minClusterSize: number,
  ): BlockCluster[] {
    const n = blocks.length;
    if (n === 0) return [];

    const norms = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      norms[i] = norm(blocks[i]!.embedding);
    }

    const parent = new Int32Array(n);
    const rank = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;

    const find = (x: number): number => {
      let root = x;
      while (parent[root] !== root) root = parent[root]!;
      let cur = x;
      while (parent[cur] !== root) {
        const next = parent[cur]!;
        parent[cur] = root;
        cur = next;
      }
      return root;
    };
    const union = (a: number, b: number): void => {
      const ra = find(a);
      const rb = find(b);
      if (ra === rb) return;
      const raRank = rank[ra]!;
      const rbRank = rank[rb]!;
      if (raRank < rbRank) {
        parent[ra] = rb;
      } else if (raRank > rbRank) {
        parent[rb] = ra;
      } else {
        parent[rb] = ra;
        rank[ra] = raRank + 1;
      }
    };

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const sim = cosineWithNorms(
          blocks[i]!.embedding,
          blocks[j]!.embedding,
          norms[i]!,
          norms[j]!,
        );
        if (sim > threshold) union(i, j);
      }
    }

    const groups = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      const list = groups.get(r);
      if (list) list.push(i);
      else groups.set(r, [i]);
    }

    const result: BlockCluster[] = [];
    for (const indices of groups.values()) {
      if (indices.length < minClusterSize) continue;
      const representative = pickRepresentative(blocks, indices, norms);
      result.push({
        blockIds: indices.map((idx) => blocks[idx]!.id),
        representative,
      });
    }
    return result;
  }
}

function norm(vec: number[]): number {
  let s = 0;
  for (let i = 0; i < vec.length; i++) {
    const v = vec[i]!;
    s += v * v;
  }
  return Math.sqrt(s);
}

function cosineWithNorms(a: number[], b: number[], na: number, nb: number): number {
  if (na === 0 || nb === 0) return 0;
  const len = a.length < b.length ? a.length : b.length;
  let dot = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
  }
  return dot / (na * nb);
}

function pickRepresentative(
  blocks: ClusterableBlock[],
  clusterIndices: number[],
  norms: Float64Array,
): string {
  if (clusterIndices.length === 1) return blocks[clusterIndices[0]!]!.id;

  let bestIdx = clusterIndices[0]!;
  let bestSum = -Infinity;
  for (const i of clusterIndices) {
    let sum = 0;
    for (const j of clusterIndices) {
      if (i === j) continue;
      sum += cosineWithNorms(blocks[i]!.embedding, blocks[j]!.embedding, norms[i]!, norms[j]!);
    }
    if (sum > bestSum) {
      bestSum = sum;
      bestIdx = i;
    }
  }
  return blocks[bestIdx]!.id;
}
