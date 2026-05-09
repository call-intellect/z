/**
 * Утилиты форматирования для AI Meeting Workspace v2.
 */

export function fmtTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
    : `${m}:${sec.toString().padStart(2, '0')}`;
}

export function fmtDurationCompact(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || ms <= 0) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}ч ${m.toString().padStart(2, '0')}м` : `${m}м`;
}

export function parseTimeInput(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // mm:ss или hh:mm:ss
  const parts = trimmed.split(':').map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  let seconds = 0;
  if (nums.length === 3) {
    seconds = nums[0]! * 3600 + nums[1]! * 60 + nums[2]!;
  } else {
    seconds = nums[0]! * 60 + nums[1]!;
  }
  return seconds * 1000;
}
