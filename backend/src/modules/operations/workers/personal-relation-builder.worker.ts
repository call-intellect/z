import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { type EntityLinkType, Prisma } from '@prisma/client';
import { type Job } from 'bullmq';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { type SpecialistRoutingJobData } from '../../core-queue/queues';
import { RouterService } from '../../knowledge-core/services/router.service';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

@Injectable()
export class PersonalRelationBuilderWorker {
  private readonly logger = new Logger(PersonalRelationBuilderWorker.name);

  static readonly SPECIALIST_NAME = RouterService.SPECIALIST.PERSONAL_RELATION;
  private static readonly MIN_CONFIDENCE = 0.6;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async handle(job: Job<SpecialistRoutingJobData>): Promise<void> {
    await this.pipe.job(
      SystemLogPipeline.KNOWLEDGE_GRAPH,
      'operations.personal-relation',
      job,
      () => this.process(job),
    );
  }

  private async process(job: Job<SpecialistRoutingJobData>): Promise<void> {
    const { blockId, tenantId, signalType } = job.data;
    const tenantTop = resolveOperationsTenantTop(tenantId);

    try {
      const block = await this.prisma.ideaBlock.findUnique({
        where: { id: blockId },
        include: {
          entities: {
            include: {
              entity: { select: { id: true, type: true, name: true } },
            },
          },
        },
      });
      if (!block) {
        this.metrics.incPersonalRelationBuilderRun({
          tenantTop,
          result: 'skipped_no_pair',
        });
        this.metrics.incCoreSpecialistSkipped({
          specialist: PersonalRelationBuilderWorker.SPECIALIST_NAME,
          reason: 'block_not_found',
        });
        return;
      }
      if (block.tenantId !== tenantId) {
        this.metrics.incPersonalRelationBuilderRun({
          tenantTop,
          result: 'error',
        });
        this.metrics.incCoreSpecialistSkipped({
          specialist: PersonalRelationBuilderWorker.SPECIALIST_NAME,
          reason: 'tenant_mismatch',
        });
        return;
      }
      if (block.status !== 'canonical') {
        this.metrics.incCoreSpecialistSkipped({
          specialist: PersonalRelationBuilderWorker.SPECIALIST_NAME,
          reason: 'not_canonical',
        });
        return;
      }

      const personEntities = block.entities.filter((be) => be.entity?.type === 'person');
      if (personEntities.length < 2) {
        this.metrics.incPersonalRelationBuilderRun({
          tenantTop,
          result: 'skipped_no_pair',
        });
        this.metrics.incCoreSpecialistSkipped({
          specialist: PersonalRelationBuilderWorker.SPECIALIST_NAME,
          reason: 'signal_out_of_scope',
        });
        return;
      }

      const isFriction = signalType === 'team_friction' || signalType === 'process_friction';
      if (!isFriction) {
        this.metrics.incPersonalRelationBuilderRun({
          tenantTop,
          result: 'skipped_low_confidence',
        });
        this.metrics.incCoreSpecialistSkipped({
          specialist: PersonalRelationBuilderWorker.SPECIALIST_NAME,
          reason: 'signal_out_of_scope',
        });
        return;
      }

      const relationType: EntityLinkType = 'conflicted_with';
      const confidence = 0.65;
      if (confidence < PersonalRelationBuilderWorker.MIN_CONFIDENCE) {
        this.metrics.incPersonalRelationBuilderRun({
          tenantTop,
          result: 'skipped_low_confidence',
        });
        this.metrics.incCoreSpecialistSkipped({
          specialist: PersonalRelationBuilderWorker.SPECIALIST_NAME,
          reason: 'signal_out_of_scope',
        });
        return;
      }

      let linksProcessed = 0;
      for (let i = 0; i < personEntities.length; i++) {
        for (let j = i + 1; j < personEntities.length; j++) {
          const a = personEntities[i]?.entity;
          const b = personEntities[j]?.entity;
          if (!a || !b) continue;
          const [from, to] = a.id < b.id ? [a, b] : [b, a];
          await this.upsertLink({
            tenantId,
            fromEntityId: from.id,
            toEntityId: to.id,
            relationType,
            confidence,
            blockId: block.id,
            blockSignalType: signalType,
          });
          linksProcessed++;
        }
      }

      this.metrics.incPersonalRelationBuilderRun({
        tenantTop,
        result: linksProcessed > 0 ? 'link_created' : 'skipped_no_pair',
      });
      this.logger.debug(
        { blockId: block.id, linksProcessed, signalType },
        'personal-relation-builder: обработан блок',
      );
    } catch (err) {
      this.metrics.incPersonalRelationBuilderRun({
        tenantTop,
        result: 'error',
      });
      throw err;
    }
  }

  private async upsertLink(args: {
    tenantId: string;
    fromEntityId: string;
    toEntityId: string;
    relationType: EntityLinkType;
    confidence: number;
    blockId: string;
    blockSignalType: string;
  }): Promise<void> {
    const explanation = `Авто-извлечение из блока signalType=${args.blockSignalType} (β-8 PersonalRelationBuilder).`;
    await this.prisma.entityLink.upsert({
      where: {
        fromEntityId_fromType_toEntityId_toType_relationType: {
          fromEntityId: args.fromEntityId,
          fromType: 'entity',
          toEntityId: args.toEntityId,
          toType: 'entity',
          relationType: args.relationType,
        },
      },
      create: {
        tenantId: args.tenantId,
        fromEntityId: args.fromEntityId,
        fromType: 'entity',
        toEntityId: args.toEntityId,
        toType: 'entity',
        relationType: args.relationType,
        confidence: new Prisma.Decimal(args.confidence.toFixed(3)),
        explanation,
        createdBy: 'linker',
        status: 'active',
        properties: {
          sourceBlockId: args.blockId,
          sourceSignalType: args.blockSignalType,
        } as Prisma.InputJsonValue,
      },
      update: {
        confidence: new Prisma.Decimal(args.confidence.toFixed(3)),
        explanation,
        status: 'active',
        properties: {
          sourceBlockId: args.blockId,
          sourceSignalType: args.blockSignalType,
        } as Prisma.InputJsonValue,
      },
    });
  }
}

@Injectable()
export class CheckInConflictDetectorCron {
  private readonly logger = new Logger(CheckInConflictDetectorCron.name);
  private static readonly WINDOW_24H_MS = 24 * 60 * 60 * 1000;
  private static readonly CONFIDENCE = 0.55;
  private static readonly SNIPPET_LIMIT = 200;

  private static readonly CONFLICT_PATTERNS: ReadonlyArray<RegExp> = [
    /(?:^|[^а-яёА-ЯЁ])конфликт(?:[а-яё]+)?\s+с\s+([А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ][а-яё-]+)?)/gi,
    /(?:^|[^а-яёА-ЯЁ])спор(?:[а-яё]+)?\s+с\s+([А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ][а-яё-]+)?)/gi,
    /(?:^|[^а-яёА-ЯЁ])спорю\s+с\s+([А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ][а-яё-]+)?)/gi,
    /(?:^|[^а-яёА-ЯЁ])недовольств(?:[а-яё]+)?\s+(?:со\s+стороны|на|с)\s+([А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ][а-яё-]+)?)/gi,
    /(?:^|[^а-яёА-ЯЁ])трени[яей]\s+с\s+([А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ][а-яё-]+)?)/gi,
    /(?:^|[^а-яёА-ЯЁ])ругаюсь\s+с\s+([А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ][а-яё-]+)?)/gi,
    /(?:^|[^а-яёА-ЯЁ])ссор(?:[а-яё]+)?\s+с\s+([А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ][а-яё-]+)?)/gi,
  ];

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 4 * * *')
  async run(): Promise<void> {
    try {
      const stats = await this.runOnce();
      this.logger.debug(stats, 'checkin-conflict-detector: проход завершён');
    } catch (err) {
      this.logger.error(
        `checkin-conflict-detector fail: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async runOnce(): Promise<{
    checkInsScanned: number;
    matchesFound: number;
    linksCreated: number;
    errors: number;
  }> {
    const since = new Date(Date.now() - CheckInConflictDetectorCron.WINDOW_24H_MS);

    const checkIns = await this.prisma.dailyCheckIn.findMany({
      where: { createdAt: { gte: since } },
      select: {
        id: true,
        tenantId: true,
        personId: true,
        rawResponseText: true,
        plansJson: true,
        donesJson: true,
        blockersJson: true,
      },
    });

    let checkInsScanned = 0;
    let matchesFound = 0;
    let linksCreated = 0;
    let errors = 0;

    for (const ci of checkIns) {
      const tenantTop = resolveOperationsTenantTop(ci.tenantId);
      try {
        const blob = this.assembleTextBlob(ci);
        if (!blob) continue;
        checkInsScanned++;
        this.metrics.incPersonalRelationBuilderRun({
          tenantTop,
          result: 'checkin_scanned',
        });

        const candidateNames = this.extractCandidateNames(blob);
        if (candidateNames.size === 0) continue;

        const author = await this.prisma.person.findFirst({
          where: { id: ci.personId, tenantId: ci.tenantId, deletedAt: null },
          select: { id: true, entityId: true, name: true },
        });
        if (!author || !author.entityId) continue;

        const allOrgPersons = await this.prisma.person.findMany({
          where: {
            tenantId: ci.tenantId,
            deletedAt: null,
          },
          select: { id: true, entityId: true, name: true },
        });
        const matches = this.matchPersonsByRoot(allOrgPersons, candidateNames);

        for (const m of matches) {
          if (m.id === author.id) continue;
          if (!m.entityId) continue;
          matchesFound++;

          const snippet = this.makeSnippet(blob, m.name);
          await this.upsertConflictLink({
            tenantId: ci.tenantId,
            fromEntityId: author.entityId,
            toEntityId: m.entityId,
            sourceCheckInId: ci.id,
            sourceText: snippet,
          });
          linksCreated++;
          this.metrics.incPersonalRelationBuilderRun({
            tenantTop,
            result: 'checkin_conflict_detected',
          });
        }
      } catch (err) {
        errors++;
        this.metrics.incPersonalRelationBuilderRun({
          tenantTop,
          result: 'error',
        });
        this.logger.warn(
          `checkin-conflict-detector checkin ${ci.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { checkInsScanned, matchesFound, linksCreated, errors };
  }

  private assembleTextBlob(ci: {
    rawResponseText: string | null;
    plansJson: unknown;
    donesJson: unknown;
    blockersJson: unknown;
  }): string {
    const parts: string[] = [];
    if (ci.rawResponseText && ci.rawResponseText.trim()) {
      parts.push(ci.rawResponseText);
    }
    for (const src of [ci.plansJson, ci.donesJson, ci.blockersJson]) {
      if (!Array.isArray(src)) continue;
      for (const item of src) {
        if (item && typeof item === 'object') {
          const obj = item as { text?: unknown };
          if (typeof obj.text === 'string' && obj.text.trim()) {
            parts.push(obj.text);
          }
        }
      }
    }
    return parts.join('\n').trim();
  }

  private extractCandidateNames(blob: string): Set<string> {
    const names = new Set<string>();
    for (const pattern of CheckInConflictDetectorCron.CONFLICT_PATTERNS) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(blob)) !== null) {
        const raw = m[1]?.trim().replace(/\s+/g, ' ');
        if (raw && raw.length >= 2 && raw.length <= 80) {
          names.add(raw);
        }
        if (pattern.lastIndex === m.index) {
          pattern.lastIndex++;
        }
      }
    }
    return names;
  }

  private matchPersonsByRoot(
    persons: Array<{ id: string; entityId: string | null; name: string }>,
    candidates: Set<string>,
  ): Array<{ id: string; entityId: string | null; name: string }> {
    const ROOT_LEN = 3;
    const normalize = (s: string): string => s.toLowerCase().replace(/ё/g, 'е');
    const candidateRoots: Array<{ first: string; last: string | null }> = [];
    for (const c of candidates) {
      const parts = normalize(c).split(/\s+/);
      const first = (parts[0] ?? '').slice(0, ROOT_LEN);
      const last = parts[1] ? parts[1].slice(0, ROOT_LEN) : null;
      if (first.length >= ROOT_LEN) {
        candidateRoots.push({ first, last });
      }
    }

    const result: Array<{
      id: string;
      entityId: string | null;
      name: string;
    }> = [];
    const seenIds = new Set<string>();

    for (const p of persons) {
      const parts = normalize(p.name).split(/\s+/);
      const pFirst = (parts[0] ?? '').slice(0, ROOT_LEN);
      const pLast = parts[1] ? parts[1].slice(0, ROOT_LEN) : null;
      if (pFirst.length < ROOT_LEN) continue;

      for (const root of candidateRoots) {
        if (root.first !== pFirst) continue;
        if (root.last && pLast && root.last !== pLast) continue;
        if (seenIds.has(p.id)) break;
        seenIds.add(p.id);
        result.push(p);
        break;
      }
    }
    return result;
  }

  private makeSnippet(blob: string, name: string): string {
    const idx = blob.toLowerCase().indexOf(name.toLowerCase());
    const limit = CheckInConflictDetectorCron.SNIPPET_LIMIT;
    if (idx < 0) return blob.slice(0, limit);
    const start = Math.max(0, idx - Math.floor(limit / 2));
    return blob.slice(start, start + limit);
  }

  private async upsertConflictLink(args: {
    tenantId: string;
    fromEntityId: string;
    toEntityId: string;
    sourceCheckInId: string;
    sourceText: string;
  }): Promise<void> {
    const [fromId, toId] =
      args.fromEntityId < args.toEntityId
        ? [args.fromEntityId, args.toEntityId]
        : [args.toEntityId, args.fromEntityId];
    const relationType: EntityLinkType = 'conflicted_with';
    const explanation = 'Авто-извлечение из чек-ина (Pulse Wave 4 §3.2 CheckInConflictDetector).';
    await this.prisma.entityLink.upsert({
      where: {
        fromEntityId_fromType_toEntityId_toType_relationType: {
          fromEntityId: fromId,
          fromType: 'entity',
          toEntityId: toId,
          toType: 'entity',
          relationType,
        },
      },
      create: {
        tenantId: args.tenantId,
        fromEntityId: fromId,
        fromType: 'entity',
        toEntityId: toId,
        toType: 'entity',
        relationType,
        confidence: new Prisma.Decimal(CheckInConflictDetectorCron.CONFIDENCE.toFixed(3)),
        explanation,
        createdBy: 'linker',
        status: 'active',
        properties: {
          sourceCheckInId: args.sourceCheckInId,
          sourceText: args.sourceText,
          source: 'checkin-conflict-detector',
        } as Prisma.InputJsonValue,
      },
      update: {
        confidence: new Prisma.Decimal(CheckInConflictDetectorCron.CONFIDENCE.toFixed(3)),
        explanation,
        status: 'active',
        properties: {
          sourceCheckInId: args.sourceCheckInId,
          sourceText: args.sourceText,
          source: 'checkin-conflict-detector',
        } as Prisma.InputJsonValue,
      },
    });
  }
}
