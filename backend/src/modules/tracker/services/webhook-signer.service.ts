import { createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

@Injectable()
export class WebhookSigner {
  sign(rawBody: string, secretKey: string): string {
    const digest = createHmac('sha256', secretKey).update(rawBody).digest('hex');
    return `sha256=${digest}`;
  }

  verify(rawBody: string, secretKey: string, signatureHeader: string): boolean {
    const expected = this.sign(rawBody, secretKey);
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
