const TOP_BUCKETS = 100;

export function tenantTopOf(tenantId: string | null | undefined): string {
  if (!tenantId) return 'system';
  const h = fnv1a(tenantId);
  const bucket = h % TOP_BUCKETS;
  return `t${String(bucket).padStart(3, '0')}`;
}

function fnv1a(s: string): number {
  let h = 0x811c_9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x0100_0193);
    h >>>= 0;
  }
  return h >>> 0;
}
