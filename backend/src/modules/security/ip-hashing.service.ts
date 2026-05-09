import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { TypedConfigService } from '../../common/config/index';

/**
 * Анти-cheat хеширование IP. Хранение «сырого» IP запрещено GDPR-friendly
 * политикой проекта Z, поэтому для подсчёта unique-views и rate-limit per-IP
 * используем хеш с daily salt.
 *
 * Формат: `sha256(ip + dailySalt + dateString)`. Daily-rotated значит, что
 * один и тот же IP в течение 24 часов даёт одинаковый хеш (можно посчитать
 * unique-views), но через сутки — другой (нельзя восстановить юзера).
 *
 * Используется:
 *   - `MeetingShareView.ipHash` (M3b/shares)
 *   - `AuditLog.ipHash`
 *   - `ApiAccessLog.ipHash`
 */
@Injectable()
export class IpHashingService {
  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {}

  hashIp(ip: string, dateString?: string): string {
    const salt = this.cfg.hashing.ipDailySalt;
    const day = dateString ?? new Date().toISOString().slice(0, 10);
    return createHash('sha256').update(`${ip}|${salt}|${day}`).digest('hex');
  }
}
