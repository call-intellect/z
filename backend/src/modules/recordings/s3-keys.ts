/**
 * Помощники для конвенций S3-ключей записи встречи.
 *
 * Конвенции:
 *   - composite: `meetings/<meetingId>/composite.mp4`
 *   - audio per-track: `meetings/<meetingId>/audio/<participantIdentity>.ogg`
 *
 * Эти ключи фигурируют:
 *   1) При запросе egress — кладём как `filepath` в `S3Upload`.
 *   2) В webhook'ах egress_ended — `egressInfo.fileResults[0].location` приходит
 *      как полный URL (`https://endpoint/bucket/key` или
 *      `https://bucket.endpoint/key`). `extractKeyFromUrl` достаёт ключ обратно.
 */

export function compositeKey(meetingId: string): string {
  return `meetings/${meetingId}/composite.mp4`;
}

export function audioTrackKey(meetingId: string, participantIdentity: string): string {
  // У livekit identity могут быть символы вроде ":" — оставим как есть,
  // S3 их допускает (RFC 3986 unreserved + некоторые reserved). Если нужна
  // совместимость — `encodeURIComponent` тут небезопасен, поскольку дальше
  // этот же ключ используется при presign и delete. Оставляем «as-is» и
  // полагаемся на нашу конвенцию identity = `host:<userId>` / `guest:<id>`.
  return `meetings/${meetingId}/audio/${participantIdentity}.ogg`;
}

/**
 * Ключ объединённого транскрипта (`merged.json`, формат `{ meetingId, turns }`).
 *
 * Потребители читают его через `S3Service.getJson` по `Transcript.mergedS3Url`:
 * behavior-metrics, quality-score, custom-report, transcript-clean.
 * Источник правды для отображения — БД-колонка `Transcript.turns`; merged.json —
 * S3-зеркало для AI-воркеров, которые исторически читают транскрипт из объекта.
 */
export function transcriptMergedKey(meetingId: string): string {
  return `meetings/${meetingId}/transcripts/merged.json`;
}

/**
 * Извлекает S3-ключ из URL, который пришёл от LiveKit egress.
 *
 * Поддерживаемые форматы:
 *   - path-style: `https://endpoint.tld/<bucket>/<key>`
 *   - virtual-hosted: `https://<bucket>.endpoint.tld/<key>`
 *   - просто `s3://<bucket>/<key>`
 *   - уже «голый» key (нет схемы) — отдаём как есть.
 */
export function extractKeyFromUrl(url: string, bucket: string): string {
  if (!url) return '';

  // Самый «дешёвый» случай — уже передали ключ.
  if (!url.includes('://')) {
    // Защита: если случайно начали с "/" — отрежем.
    return url.replace(/^\/+/, '');
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }

  // Path-стиль: /<bucket>/<key>
  const pathname = parsed.pathname.replace(/^\/+/, '');
  if (pathname.startsWith(`${bucket}/`)) {
    return pathname.slice(bucket.length + 1);
  }
  // Virtual-hosted: bucket в начале host'а.
  if (parsed.host.startsWith(`${bucket}.`)) {
    return pathname;
  }
  // s3://bucket/key
  if (parsed.protocol === 's3:' && parsed.host === bucket) {
    return pathname;
  }
  // Не смогли уверенно определить — возвращаем pathname без bucket'а
  // (на случай нестандартного endpoint'а; вызывающий код должен это понимать).
  return pathname;
}
