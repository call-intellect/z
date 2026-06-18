import { createHmac } from 'node:crypto';

import { Injectable } from '@nestjs/common';

@Injectable()
export class WebhookSigningService {
  sign(args: { secret: string; rawBody: string; timestampSec?: number }): string {
    const t = args.timestampSec ?? Math.floor(Date.now() / 1000);
    const payload = `${t}.${args.rawBody}`;
    const hmac = createHmac('sha256', args.secret).update(payload).digest('hex');
    return `t=${t},v1=${hmac}`;
  }
}
