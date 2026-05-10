import { Injectable } from '@nestjs/common';

/**
 * Один кластер блоков. `representative` — id блока, у которого максимальная
 * сумма косинусной близости к остальным членам кластера (центрoид по сути).
 */
export interface BlockCluster {
  blockIds: string[];
  representative: string;
}

/**
 * Входной блок для кластеризации: id + 1536-мерный embedding (число с плавающей).
 */
export interface ClusterableBlock {
  id: string;
  embedding: number[];
}

/**
 * ClusteringService — KNN-greedy кластеризация блоков по косинусу эмбеддингов.
 *
 * Алгоритм (union-find):
 *   1. Каждый блок начинает в собственном singleton-кластере.
 *   2. Для каждой пары (i, j), i < j: если cosine(emb[i], emb[j]) > threshold —
 *      объединить их кластеры через DSU.
 *   3. После прохода — отфильтровать кластеры с size < minClusterSize.
 *   4. В каждом оставшемся кластере выбрать representative — блок с максимальной
 *      суммой cosine ко всем остальным в кластере.
 *
 * Сложность — O(N²) по парам и O(N²·D) по dot-product (D=1536). Для N≤1000
 * это ~миллион пар × 1536 умножений ≈ 1.5 секунды на M2 — приемлемо для
 * фонового cron'а раз в час. На больших Org (>5–10k canonical-блоков
 * без темы) — заменить на pgvector-side нативный KNN; подробности в TODO.
 */
@Injectable()
export class ClusteringService {
  /**
   * Запуск KNN-greedy. Возвращает массив кластеров размера ≥ `minClusterSize`.
   * Не мутирует входной массив.
   */
  clusterByEmbedding(
    blocks: ClusterableBlock[],
    threshold: number,
    minClusterSize: number,
  ): BlockCluster[] {
    const n = blocks.length;
    if (n === 0) return [];

    // Pre-compute нормы — экономим один корень на каждом cosine.
    const norms = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      norms[i] = norm(blocks[i]!.embedding);
    }

    // DSU (union-find) с rank-оптимизацией.
    const parent = new Int32Array(n);
    const rank = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;

    const find = (x: number): number => {
      let root = x;
      while (parent[root] !== root) root = parent[root]!;
      // Path compression.
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

    // O(N²) проход. Pairwise cosine, объединяем при превышении порога.
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

    // Группируем индексы по корню DSU.
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

function cosineWithNorms(
  a: number[],
  b: number[],
  na: number,
  nb: number,
): number {
  if (na === 0 || nb === 0) return 0;
  const len = a.length < b.length ? a.length : b.length;
  let dot = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
  }
  return dot / (na * nb);
}

/**
 * Выбираем representative — индекс блока с максимальной суммой cosine
 * ко всем остальным в кластере. Возвращаем его id.
 */
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
      sum += cosineWithNorms(
        blocks[i]!.embedding,
        blocks[j]!.embedding,
        norms[i]!,
        norms[j]!,
      );
    }
    if (sum > bestSum) {
      bestSum = sum;
      bestIdx = i;
    }
  }
  return blocks[bestIdx]!.id;
}
