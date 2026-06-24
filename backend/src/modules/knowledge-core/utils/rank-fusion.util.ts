export interface RankedItem {
  id: string;
}

export function reciprocalRankFusion(
  lists: Array<ReadonlyArray<RankedItem>>,
  k = 60,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank];
      if (!item) continue;
      const contribution = 1 / (k + rank + 1);
      scores.set(item.id, (scores.get(item.id) ?? 0) + contribution);
    }
  }
  return scores;
}

export function fuseRankedLists(
  lists: Array<ReadonlyArray<RankedItem>>,
  k = 60,
): string[] {
  const scores = reciprocalRankFusion(lists, k);
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
