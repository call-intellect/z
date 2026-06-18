import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { type WebhookEvent } from 'livekit-server-sdk';

import { TypedConfigService } from '../../common/config/index';
import { IntegrationKeyInvalidError } from '../../common/errors/domain-errors';

@Injectable()
export class LivekitSignatureVerifier {
  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {}

  verify(input: { rawBody: Buffer; authHeader: string | undefined }): WebhookEvent {
    const { rawBody, authHeader } = input;
    if (!authHeader) {
      throw new IntegrationKeyInvalidError('webhook_signature_invalid');
    }

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
