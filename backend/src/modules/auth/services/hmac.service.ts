import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';

/**
 * HMAC-сервис для Crossmark-интеграции.
 *
 * Конвенция подписи (stripe-like):
 *   `signed_payload = `${timestamp}.${rawBody}``
 *   `signature      = hex(hmacSha256(integrationKey, signed_payload))`
 *
 * Дополнительно сравниваем `Date.now()/1000 - timestamp` с допустимым окном
 * `cfg.crossmark.hmacTimestampWindowSeconds` (защита от replay-атак).
 *
 * Все сравнения — `timingSafeEqual` (защита от timing-side-channel).
 */
@Injectable()
export class HmacService {
  constructor(private readonly cfg: TypedConfigService) {}

  /**
   * Проверяет подпись запроса. Никогда не throw — возвращает `false` на любой
   * формальный косяк (пустой signature/timestamp, неправильный hex, неподходящая длина).
   */
  verify(input: { body: Buffer; signature: string; timestamp: string; key: string }): boolean {
    const { body, signature, timestamp, key } = input;
    if (!signature || !timestamp || !key) return false;

    // 1. Проверка окна timestamp.
    const tsNum = Number.parseInt(timestamp, 10);
    if (!Number.isFinite(tsNum)) return false;
    const nowSec = Math.floor(Date.now() / 1000);
    const drift = Math.abs(nowSec - tsNum);
    if (drift > this.cfg.crossmark.hmacTimestampWindowSeconds) return false;

    // 2. Вычисляем ожидаемую подпись.
    const expectedHex = createHmac('sha256', key)
      .update(`${timestamp}.${body.toString('utf8')}`)
      .digest('hex');

    // 3. timing-safe compare.
    return this.safeCompareHex(signature, expectedHex);
  }

  /**
   * Хеш ключа для хранения в `IntegrationKey.keyHash`.
   * Сырой ключ — НЕ хранится. Партнёр получает его один раз при выдаче.
   */
  hashKey(plainKey: string): string {
    return createHash('sha256').update(plainKey, 'utf8').digest('hex');
  }

  /**
   * Генерирует новый ключ для партнёра — 64 случайных hex-символа (32 байта энтропии).
   */
  generateKey(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * timing-safe сравнение двух hex-строк. Возвращает `false` при разной длине
   * (без раннего выхода, ведущего к timing-различиям после побайтового сравнения —
   * длины уже фиксированы выше: для одной и той же подписи это `sha256.hex` = 64 chars).
   */
  private safeCompareHex(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let bufA: Buffer;
    let bufB: Buffer;
    try {
      bufA = Buffer.from(a, 'hex');
      bufB = Buffer.from(b, 'hex');
    } catch {
      return false;
    }
    if (bufA.length === 0 || bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
