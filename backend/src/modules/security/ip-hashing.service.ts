import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { TypedConfigService } from '../../common/config/index';

@Injectable()
export class IpHashingService {
  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {}

  hashIp(ip: string, dateString?: string): string {
    const salt = this.cfg.hashing.ipDailySalt;
    const day = dateString ?? new Date().toISOString().slice(0, 10);
    return createHash('sha256').update(`${ip}|${salt}|${day}`).digest('hex');
  }
}
