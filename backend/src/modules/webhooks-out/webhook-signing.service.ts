import { createHmac } from 'node:crypto';

import { Injectable } from '@nestjs/common';

/**
 * Подпись исходящих webhook'ов. Формат заголовка `X-Z-Signature`:
 *
 *     t=<unix-seconds>,v1=<hex>
 *
 * Алгоритм:
 *     hex = HMAC-SHA256(secret, `${t}.${rawBody}`)
 *
 * Получатель должен:
 *   1. Распарсить t/v1 из заголовка.
 *   2. Проверить t свежий (например, |now - t| < 5 мин).
 *   3. Пересчитать HMAC своим secret и сравнить через timing-safe equal.
 *
 * Этот формат — идиоматичный (Stripe-like), позволяет ротацию через
 * одновременную поддержку 2 v-схем (v1, v2 в будущем).
 */
@Injectable()
export class WebhookSigningService {
  /**
   * Возвращает значение для заголовка `X-Z-Signature`.
   */
  sign(args: { secret: string; rawBody: string; timestampSec?: number }): string {
    const t = args.timestampSec ?? Math.floor(Date.now() / 1000);
    const payload = `${t}.${args.rawBody}`;
    const hmac = createHmac('sha256', args.secret).update(payload).digest('hex');
    return `t=${t},v1=${hmac}`;
  }
}
