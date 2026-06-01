/**
 * LoggingModule — маскирование секретов и ограничение размера payload.
 *
 * Принцип: до записи в БД любой `details`/`body` проходит через
 * `sanitizePayload` (рекурсивная редакция чувствительных ключей + усечение),
 * затем через `capPayloadSize` (жёсткий лимит байт). Никогда не бросает.
 * См. plans/tz/2026-06-01-logging-module.md §4.
 */

export const REDACTED = '[REDACTED]';

/** Подстроки (lower-case) в имени ключа → значение маскируется целиком. */
export const SENSITIVE_KEY_PATTERNS: readonly string[] = [
  'password',
  'passwd',
  'secret',
  'token',
  'authorization',
  'cookie',
  'set-cookie',
  'apikey',
  'api_key',
  'api-key',
  'x-api-key',
  'accesskey',
  'privatekey',
  'private_key',
  'refresh',
  'otp',
  'pin',
  'cvv',
  'cvc',
  'cardnumber',
  'card_number',
  'pan',
  'signature',
  'webhooksecret',
  'clientsecret',
  'sessiontoken',
  'bearer',
  'idempotency-key',
  'passport',
  'snils',
  // домен-специфика Коры
  'jwt',
  'livekit',
  'hmac',
];

const DEFAULT_MAX_STRING = 2000;
const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 200;

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Рекурсивно редактирует чувствительные ключи и ограничивает размеры.
 * - ключ совпал по подстроке → `[REDACTED]`;
 * - строки длиннее лимита усекаются (с пометкой `…[+N]`);
 * - глубина > MAX_DEPTH → `[TRUNCATED_DEPTH]`;
 * - массивы — максимум MAX_ARRAY_ITEMS элементов;
 * - Date → ISO; функции/symbol/bigint → String().
 */
export function sanitizePayload(
  value: unknown,
  maxStringLength: number = DEFAULT_MAX_STRING,
  depth = 0,
): unknown {
  if (depth > MAX_DEPTH) return '[TRUNCATED_DEPTH]';

  if (value === null || value === undefined) return value;

  const t = typeof value;

  if (t === 'string') {
    return truncateString(value as string, maxStringLength);
  }
  if (t === 'number' || t === 'boolean') return value;
  if (t === 'bigint' || t === 'symbol' || t === 'function') return String(value);

  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    const limited = value.slice(0, MAX_ARRAY_ITEMS).map((v) =>
      sanitizePayload(v, maxStringLength, depth + 1),
    );
    if (value.length > MAX_ARRAY_ITEMS) {
      limited.push(`[+${value.length - MAX_ARRAY_ITEMS} more]`);
    }
    return limited;
  }

  if (t === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key)
        ? REDACTED
        : sanitizePayload(val, maxStringLength, depth + 1);
    }
    return out;
  }

  return String(value);
}

function truncateString(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…[+${s.length - max}]`;
}

const DEFAULT_MAX_BYTES = 16_000;
const PREVIEW_CHARS = 1000;

/**
 * Жёсткий лимит на сериализованный размер payload. Если `JSON.stringify`
 * превышает лимит — возвращает заглушку с превью. При ошибке сериализации —
 * `[UNSERIALIZABLE_PAYLOAD]`. Никогда не бросает.
 */
export function capPayloadSize(
  value: unknown,
  maxBytes: number = DEFAULT_MAX_BYTES,
): unknown {
  if (value === null || value === undefined) return value;
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return { _note: '[UNSERIALIZABLE_PAYLOAD]' };
  }
  if (json === undefined) return value;
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes <= maxBytes) return value;
  return {
    _note: '[PAYLOAD_TOO_LARGE]',
    _bytes: bytes,
    _preview: json.slice(0, PREVIEW_CHARS),
  };
}
