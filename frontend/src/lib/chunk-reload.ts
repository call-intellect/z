const RELOAD_TS_KEY = "z_chunk_reload_ts";
const MIN_RELOAD_INTERVAL_MS = 10_000;

export function isChunkLoadError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  const name = e?.name ?? "";
  const msg = e?.message ?? "";
  return (
    name === "ChunkLoadError" ||
    /Loading chunk [\w-]+ failed/i.test(msg) ||
    /Failed to load chunk/i.test(msg)
  );
}

export function shouldReloadOnChunkError(now: number = Date.now()): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.sessionStorage.getItem(RELOAD_TS_KEY);
  const last = raw ? Number(raw) : 0;
  if (last && now - last < MIN_RELOAD_INTERVAL_MS) return false;
  window.sessionStorage.setItem(RELOAD_TS_KEY, String(now));
  return true;
}

export function tryReloadOnce(now: number = Date.now()): boolean {
  if (!shouldReloadOnChunkError(now)) return false;
  window.location.reload();
  return true;
}
