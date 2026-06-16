import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../config/index';

@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private masterKey: Buffer | null = null;

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {}

  encrypt(plaintext: string): string {
    const key = this.getMasterKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `gcm:v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('base64')}`;
  }

  decrypt(encoded: string): string {
    const key = this.getMasterKey();
    const parts = encoded.split(':');
    if (parts.length !== 5 || parts[0] !== 'gcm' || parts[1] !== 'v1') {
      throw new Error('CryptoService.decrypt: невалидный формат шифротекста');
    }
    const [, , ivHex, tagHex, ctB64] = parts;
    if (!ivHex || !tagHex || !ctB64) {
      throw new Error('CryptoService.decrypt: отсутствует часть шифротекста');
    }
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ciphertext = Buffer.from(ctB64, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  }

  isEncrypted(value: string): boolean {
    return value.startsWith('gcm:v1:');
  }

  private getMasterKey(): Buffer {
    if (this.masterKey) return this.masterKey;
    const raw = this.cfg.crypto.masterKey;
    if (!raw || raw.length === 0) {
      throw new Error(
        'CryptoService: ENV CRYPTO_MASTER_KEY не задан. ' + 'Сгенерируй: openssl rand -base64 32',
      );
    }
    let buf: Buffer;
    try {
      buf = Buffer.from(raw, 'base64');
    } catch (err) {
      throw new Error(
        `CryptoService: CRYPTO_MASTER_KEY не парсится как base64: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    if (buf.length !== 32) {
      throw new Error(
        `CryptoService: CRYPTO_MASTER_KEY должен быть 32 байта (256 бит) после base64-декодирования, получено ${buf.length}`,
      );
    }
    this.masterKey = buf;
    return buf;
  }
}
