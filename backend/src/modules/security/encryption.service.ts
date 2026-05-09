import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { TypedConfigService } from '../../common/config/index';

/**
 * AES-256-GCM envelope encryption для секретов at-rest.
 *
 * Формат хранения:  `<iv-base64>.<ciphertext-base64>.<tag-base64>`
 *   - iv: 12 байт (рекомендация GCM).
 *   - tag: 16 байт.
 *   - ключ: из ENV `WEBHOOK_SECRETS_ENCRYPTION_KEY` (32 байта, base64).
 *
 * Используется:
 *   - `WebhookSubscription.secretEncrypted` — HMAC secret подписи.
 *   - `IntegrationDestination.config` — telegram bot token, generic webhook URL secret.
 *
 * Безопасность:
 *   - GCM — AEAD: шифр + аутентификация в одном проходе. Tamper detection.
 *   - IV случайный на каждый encrypt → одинаковые plaintext дают разные шифры.
 *   - Никаких IV-derive из plaintext (GCM nonce-misuse — критическая уязвимость).
 */
export class EncryptionTamperError extends Error {
  constructor() {
    super('Encryption tamper detected (auth tag mismatch)');
    this.name = 'EncryptionTamperError';
  }
}

const ALG = 'aes-256-gcm' as const;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(@Inject(TypedConfigService) cfg: TypedConfigService) {
    const raw = cfg.webhooksOut.encryptionKey;
    const buf = Buffer.from(raw, 'base64');
    if (buf.length !== 32) {
      throw new Error(
        `EncryptionService: WEBHOOK_SECRETS_ENCRYPTION_KEY должен быть 32 байта (получено ${buf.length})`,
      );
    }
    this.key = buf;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALG, this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}.${ct.toString('base64')}.${tag.toString('base64')}`;
  }

  decrypt(encrypted: string): string {
    const parts = encrypted.split('.');
    if (parts.length !== 3) {
      throw new EncryptionTamperError();
    }
    const [ivB64, ctB64, tagB64] = parts;
    if (!ivB64 || !ctB64 || !tagB64) {
      throw new EncryptionTamperError();
    }
    const iv = Buffer.from(ivB64, 'base64');
    const ct = Buffer.from(ctB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
      throw new EncryptionTamperError();
    }
    const decipher = createDecipheriv(ALG, this.key, iv);
    decipher.setAuthTag(tag);
    try {
      const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
      return pt.toString('utf8');
    } catch {
      // GCM auth-tag mismatch → final() throws.
      throw new EncryptionTamperError();
    }
  }
}
