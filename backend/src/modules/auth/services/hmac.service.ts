import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';

@Injectable()
export class HmacService {
  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {}

  verify(input: { body: Buffer; signature: string; timestamp: string; key: string }): boolean {
    const { body, signature, timestamp, key } = input;
    if (!signature || !timestamp || !key) return false;

    const tsNum = Number.parseInt(timestamp, 10);
    if (!Number.isFinite(tsNum)) return false;
    const nowSec = Math.floor(Date.now() / 1000);
    const drift = Math.abs(nowSec - tsNum);
    if (drift > this.cfg.crossmark.hmacTimestampWindowSeconds) return false;

    const expectedHex = createHmac('sha256', key)
      .update(`${timestamp}.${body.toString('utf8')}`)
      .digest('hex');

    return this.safeCompareHex(signature, expectedHex);
  }

  hashKey(plainKey: string): string {
    return createHash('sha256').update(plainKey, 'utf8').digest('hex');
  }

  generateKey(): string {
    return randomBytes(32).toString('hex');
  }

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
