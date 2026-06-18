export class ParseTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Превышено время парсинга документа (${timeoutMs} мс)`);
    this.name = 'ParseTimeoutError';
  }
}

export class ParseSizeError extends Error {
  constructor(actualBytes: number, maxBytes: number) {
    super(`Превышен лимит размера документа: ${actualBytes} байт > ${maxBytes} байт`);
    this.name = 'ParseSizeError';
  }
}

export class DocumentParseFailedError extends Error {
  constructor(message: string, cause?: unknown) {
    super(`Не удалось распарсить документ: ${message}`);
    this.name = 'DocumentParseFailedError';
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}
