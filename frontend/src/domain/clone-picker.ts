import type { CloneListItemApi } from "@/api/clones.api";

export const CONCIERGE_TOP_CLONES = 4;

export function topClonesByConfidence(
  list: CloneListItemApi[],
  max: number = CONCIERGE_TOP_CLONES,
): CloneListItemApi[] {
  return list
    .map((clone, index) => ({ clone, index }))
    .sort((a, b) => {
      const byConfidence = (b.clone.confidence ?? 0) - (a.clone.confidence ?? 0);
      return byConfidence !== 0 ? byConfidence : a.index - b.index;
    })
    .slice(0, Math.max(0, max))
    .map((entry) => entry.clone);
}
