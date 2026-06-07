const RELOAD_TS_KEY = 'z_chunk_reload_ts';
/** Минимальный интервал между авто-reload: если упали повторно за это окно — это цикл, не перезагружаем. */
const MIN_RELOAD_INTERVAL_MS = 10_000;

/**
 * ChunkLoadError: динамический import() чанка не загрузился. Частый симптом version
 * skew (старая вкладка тянет чанк, которого нет в новом билде). Ловим по имени и тексту.
 */
export function isChunkLoadError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  const name = e?.name ?? '';
  const msg = e?.message ?? '';
  return (
    name === 'ChunkLoadError' ||
    /Loading chunk [\w-]+ failed/i.test(msg) ||
    /Failed to load chunk/i.test(msg)
  );
}

/**
 * Решает, нужен ли reload сейчас, и фиксирует время. true → вызывающий перезагружает.
 * Анти-цикл: если предыдущий reload был < MIN_RELOAD_INTERVAL_MS назад — false
 * (значит перезагрузка не помогла, показываем экран ошибки). Окно само «перезаряжается».
 */
export function shouldReloadOnChunkError(now: number = Date.now()): boolean {
  if (typeof window === 'undefined') return false;
  const raw = window.sessionStorage.getItem(RELOAD_TS_KEY);
  const last = raw ? Number(raw) : 0;
  if (last && now - last < MIN_RELOAD_INTERVAL_MS) return false;
  window.sessionStorage.setItem(RELOAD_TS_KEY, String(now));
  return true;
}

/** Один тихий reload с анти-циклом. Возвращает true, если перезагрузка запущена. */
export function tryReloadOnce(now: number = Date.now()): boolean {
  if (!shouldReloadOnChunkError(now)) return false;
  window.location.reload();
  return true;
}
