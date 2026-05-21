/**
 * Ошибки парсера документов (Фаза 0b knowledge-core).
 *
 * Намеренно — обычные классы Error (не Nest HttpException): парсер работает
 * как из HTTP-контекста (валидация при upload'е), так и из BullMQ-воркера
 * (где Nest exceptions не имеют смысла). Адаптер сам решает, превратить
 * ошибку в HTTP-ответ или просто пометить документ как `failed`.
 */

/** Парсер не уложился в `cfg.document.parseTimeoutMs` (default 30s). */
export class ParseTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Превышено время парсинга документа (${timeoutMs} мс)`);
    this.name = 'ParseTimeoutError';
  }
}

/** Размер документа превысил `cfg.document.maxSizeMb` (default 50 MiB). */
export class ParseSizeError extends Error {
  constructor(actualBytes: number, maxBytes: number) {
    super(
      `Превышен лимит размера документа: ${actualBytes} байт > ${maxBytes} байт`,
    );
    this.name = 'ParseSizeError';
  }
}

/**
 * Парсер упал во время разбора (повреждённый PDF, неподдерживаемый кодек DOCX,
 * битый markdown). Содержит оригинальную ошибку как `cause` — для логов.
 */
export class DocumentParseFailedError extends Error {
  constructor(message: string, cause?: unknown) {
    super(`Не удалось распарсить документ: ${message}`);
    this.name = 'DocumentParseFailedError';
    if (cause !== undefined) {
      // node 16.9+ Error.cause
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}
