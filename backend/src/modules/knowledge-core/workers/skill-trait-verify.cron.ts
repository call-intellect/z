import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { RedisService } from '../../../common/redis/redis.service';
import { Specialist37Service } from '../services/specialist-3-7-skill.service';

/**
 * Ф3(D) clone-quality-improvements (2026-06-08) — SkillTraitVerifyCron.
 *
 * `@Cron('30 3 * * *')` — daily 03:30, ПОСЛЕ skill-trait-concept-normalizer
 * (03:00) и ДО skill-profile-recalibrate (05:00) и executable-persona-build.
 *
 * Батчит черты `status='pending_verification'` через grounding-проверку
 * (`Specialist37Service.verifyPendingTraits`):
 *   - grounded=true → status='active';
 *   - grounded=false → остаётся pending (decay уберёт);
 *   - ошибка/таймаут LLM → fail-open promote в active (Р2).
 *
 * Global Redis SETNX lock (один pod выполняет проход) на 1 час.
 */
@Injectable()
export class SkillTraitVerifyCron {
  private readonly logger = new Logger(SkillTraitVerifyCron.name);
  private static readonly LOCK_KEY = 'skill-trait-verify:lock';
  private static readonly LOCK_TTL_SEC = 60 * 60;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(Specialist37Service)
    private readonly specialist: Specialist37Service,
  ) {}

  @Cron('30 3 * * *')
  async tick(): Promise<void> {
    let locked = false;
    try {
      const setRes = await this.redis.client.set(
        SkillTraitVerifyCron.LOCK_KEY,
        '1',
        'EX',
        SkillTraitVerifyCron.LOCK_TTL_SEC,
        'NX',
      );
      locked = setRes === 'OK';
      if (!locked) {
        this.logger.debug(
          'skill-trait-verify.cron: lock busy — другой pod выполняет проход, skip',
        );
        return;
      }
      this.logger.log('skill-trait-verify.cron: START');
      const s = await this.specialist.verifyPendingTraits();
      this.logger.log(
        `skill-trait-verify.cron: DONE checked=${s.checked} promoted=${s.promoted} held=${s.held}`,
      );
    } catch (err) {
      this.logger.error(
        `skill-trait-verify.cron: непойманная ошибка: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      if (locked) {
        try {
          await this.redis.client.del(SkillTraitVerifyCron.LOCK_KEY);
        } catch {
          /* TTL подчистит */
        }
      }
    }
  }
}
