import { createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

/**
 * WebhookSigner — HMAC-SHA256 подпись исходящих webhook'ов трекера.
 *
 * Формат заголовка: `X-Kora-Signature: sha256={hex}`.
 * Тело — raw JSON-строка тела POST'а (важно: byte-for-byte, как уйдёт в `body`).
 */
@Injectable()
export class WebhookSigner {
  /**
   * Подписать raw body выбранным secret'ом. Возвращает значение для
   * заголовка `X-Kora-Signature` (включая префикс `sha256=`).
   */
  sign(rawBody: string, secretKey: string): string {
    const digest = createHmac('sha256', secretKey).update(rawBody).digest('hex');
    return `sha256=${digest}`;
  }

  /**
   * Проверка подписи в constant-time. Используется приёмником, но полезен и
   * на стороне отправителя — для проверки в тестах.
   */
  verify(rawBody: string, secretKey: string, signatureHeader: string): boolean {
    const expected = this.sign(rawBody, secretKey);
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
