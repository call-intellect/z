import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { RedisService } from '../../../common/redis/redis.service';
import { PracticeSkillExtractorService } from '../services/practice-skill-extractor.service';

@Injectable()
export class PracticeSkillExtractWorker {
  private readonly logger = new Logger(PracticeSkillExtractWorker.name);
  private static readonly LOCK_TTL_SEC = 60 * 60;
  private static readonly CONCURRENCY = 2;

  private inFlight = 0;
  private readonly queue: Array<() => Promise<void>> = [];

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PracticeSkillExtractorService)
    private readonly extractor: PracticeSkillExtractorService,
  ) {}

  @OnEvent('skill-trait-concept.normalized')
  async handleNormalized(event: unknown): Promise<void> {
    if (!event || typeof event !== 'object') return;
    const ev = event as { tenantId?: unknown; conceptIds?: unknown };
    if (typeof ev.tenantId !== 'string') return;
    if (!Array.isArray(ev.conceptIds)) return;
    const conceptIds = ev.conceptIds.filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );
    if (conceptIds.length === 0) return;

    this.logger.debug(
      `practice-skill-extract.worker: получено ${conceptIds.length} concept(s) для tenant=${ev.tenantId}`,
    );
    for (const conceptId of conceptIds) {
      void this.enqueue(() => this.processConcept(ev.tenantId as string, conceptId));
    }
  }

  async runForConcept(tenantId: string, conceptId: string): Promise<number> {
    const skills = await this.extractor.extractForConcept({
      tenantId,
      conceptId,
    });
    return skills.length;
  }

  private async processConcept(tenantId: string, conceptId: string): Promise<void> {
    const lockKey = `practice-skill-extract:lock:${tenantId}:${conceptId}`;
    let locked = false;
    try {
      const setRes = await this.redis.client.set(
        lockKey,
        '1',
        'EX',
        PracticeSkillExtractWorker.LOCK_TTL_SEC,
        'NX',
      );
      locked = setRes === 'OK';
      if (!locked) {
        this.logger.debug(`practice-skill-extract: lock busy для ${tenantId}/${conceptId} — skip`);
        return;
      }
      const skills = await this.extractor.extractForConcept({
        tenantId,
        conceptId,
      });
      if (skills.length > 0) {
        this.logger.debug(
          `practice-skill-extract: tenant=${tenantId} concept=${conceptId} → создано/обновлено skills=${skills.length}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `practice-skill-extract: tenant=${tenantId} concept=${conceptId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      if (locked) {
        try {
          await this.redis.client.del(lockKey);
        } catch {}
      }
    }
  }

  private async enqueue(job: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve) => {
      const runWrapped = async () => {
        try {
          await job();
        } finally {
          this.inFlight--;
          resolve();
          this.drain();
        }
      };
      if (this.inFlight < PracticeSkillExtractWorker.CONCURRENCY) {
        this.inFlight++;
        void runWrapped();
      } else {
        this.queue.push(async () => {
          this.inFlight++;
          await runWrapped();
        });
      }
    });
  }

  private drain(): void {
    while (this.inFlight < PracticeSkillExtractWorker.CONCURRENCY && this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) void next();
    }
  }
}
