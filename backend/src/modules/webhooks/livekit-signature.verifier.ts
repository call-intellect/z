import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { type WebhookEvent } from 'livekit-server-sdk';

import { TypedConfigService } from '../../common/config/index';
import { IntegrationKeyInvalidError } from '../../common/errors/domain-errors';

/**
 * Верификатор LiveKit-вебхуков.
 *
 * Контракт LiveKit:
 *   - заголовок `Authorization: <jwt>` (без префикса `Bearer`);
 *   - JWT подписан `LIVEKIT_WEBHOOK_API_SECRET` (HS256);
 *   - в claim'ах `sha256` (base64) от тела запроса.
 *
 * Шаги:
 *   1. Парс JWT.
 *   2. Сравнить claim `sha256` с фактическим sha256(rawBody) (base64).
 *   3. Парсить тело как `WebhookEvent`.
 *
 * На любую ошибку — `IntegrationKeyInvalidError('webhook_signature_invalid')`.
 */
@Injectable()
export class LivekitSignatureVerifier {
  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {}

  verify(input: { rawBody: Buffer; authHeader: string | undefined }): WebhookEvent {
    const { rawBody, authHeader } = input;
    if (!authHeader) {
      throw new IntegrationKeyInvalidError('webhook_signature_invalid');
    }

    // LiveKit шлёт JWT прямо в Authorization (без `Bearer`). На всякий случай
    // снимем префикс, если когда-нибудь появится.
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : authHeader.trim();
    if (!token) {
      throw new IntegrationKeyInvalidError('webhook_signature_invalid');
    }

    let decoded: unknown;
    try {
      decoded = jwt.verify(token, this.cfg.livekit.webhookApiSecret, {
        algorithms: ['HS256'],
      });
    } catch {
      throw new IntegrationKeyInvalidError('webhook_signature_invalid');
    }

    if (typeof decoded !== 'object' || decoded === null) {
      throw new IntegrationKeyInvalidError('webhook_signature_invalid');
    }

    const claimSha = (decoded as Record<string, unknown>)['sha256'];
    if (typeof claimSha !== 'string') {
      throw new IntegrationKeyInvalidError('webhook_signature_invalid');
    }

    const actualSha = createHash('sha256').update(rawBody).digest('base64');
    if (claimSha !== actualSha) {
      throw new IntegrationKeyInvalidError('webhook_signature_invalid');
    }

    // Парсим тело как WebhookEvent. Сам тип `WebhookEvent` из livekit-server-sdk —
    // discriminated union по полю `event`.
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new IntegrationKeyInvalidError('webhook_signature_invalid');
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new IntegrationKeyInvalidError('webhook_signature_invalid');
    }

    return parsed as WebhookEvent;
  }
}
