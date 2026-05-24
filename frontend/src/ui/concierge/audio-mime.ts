/**
 * Утилита выбора MIME-типа для MediaRecorder в Concierge.
 *
 * Браузерная поддержка различается:
 *   - Chrome/Edge: `audio/webm;codecs=opus` (предпочтительно).
 *   - Firefox: `audio/ogg;codecs=opus`.
 *   - Safari (desktop + iOS): `audio/webm` НЕ поддерживается → fallback на
 *     `audio/mp4` (AAC внутри). Это известная mobile Safari quirk —
 *     учитываем перебором кандидатов в порядке предпочтения.
 *
 * Возвращает `null` если ни один из кандидатов не поддерживается или
 * `MediaRecorder` глобально недоступен (например, тест/SSR).
 */
export function pickSupportedMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
  ];
  for (const t of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      // ignore — Safari старых версий бросает на неизвестных MIME.
    }
  }
  return null;
}
