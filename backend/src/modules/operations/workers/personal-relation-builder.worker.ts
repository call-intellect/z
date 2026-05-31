import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { type EntityLinkType, Prisma } from '@prisma/client';
import { type Job, Worker } from 'bullmq';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import {
  CORE_QUEUE_NAMES,
  type SpecialistRoutingJobData,
} from '../../core-queue/queues';
import { RouterService } from '../../knowledge-core/services/router.service';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

/**
 * SBA β-8 — PersonalRelationBuilderWorker.
 *
 * Consumer очереди `core.specialist-routing`, jobName='3-12-personal-relation'.
 *
 * Запускается, когда `RouterService.dispatch` диспатчит блок с signalType ∈
 * {team_friction, process_friction, manages, collaborates_with} (последние
 * два — гипотетически, в текущей онтологии нет signalType=manages, но мы
 * закладываемся на расширение). Также реагирует на любой блок, явно
 * передавший этого специалиста.
 *
 * Логика:
 *   1. Загрузить block + его entities (IdeaBlockEntity).
 *   2. Найти ВСЕ упоминания Person'ов (через IdeaBlockEntity → Entity{type=person}).
 *   3. Если ≥ 2 Person'ов и блок про friction — создаём EntityLink с
 *      relationType='conflicted_with' (confidence из block.signalType +
 *      0.6 за упоминание).
 *   4. EntityLink upsert по composite unique
 *      `(fromEntityId, fromType, toEntityId, toType, relationType)`.
 *      Дубли не создаются (см. schema).
 *
 * Confidence threshold = 0.6: ниже — skip (метрика skipped_low_confidence).
 *
 * NB: На β-8 это минимально-жизнеспособный extractor. Полноценный LLM-extract
 * пары участников + roles (manages / reports_to / mentors) — γ-2 (см. ТЗ).
 *
 * Идемпотентность:
 *   - jobId диспатча = `'3-12-personal-relation_<blockId>'`.
 *   - EntityLink composite unique гарантирует, что повторный upsert обновляет
 *     existing link.
 *
 * Метрики:
 *   - `personal_relation_builder_runs_total{tenant_top, result}`.
 */
@Injectable()
export class PersonalRelationBuilderWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PersonalRelationBuilderWorker.name);
  private worker: Worker<SpecialistRoutingJobData> | null = null;

  static readonly SPECIALIST_NAME = RouterService.SPECIALIST.PERSONAL_RELATION;
  private static readonly MIN_CONFIDENCE = 0.6;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<SpecialistRoutingJobData>(
      CORE_QUEUE_NAMES.SPECIALIST_ROUTING,
      async (job) => this.process(job),
      {
        connection: this.redis.client,
        concurrency: 2,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        {
          blockId: job?.data?.blockId,
          jobName: job?.name,
          attempt: job?.attemptsMade,
          err: err?.message,
        },
        'personal-relation-builder: job failed (повтор по политике BullMQ)',
      );
    });
    this.logger.log(
      `PersonalRelationBuilderWorker запущен (${CORE_QUEUE_NAMES.SPECIALIST_ROUTING}, jobName=${PersonalRelationBuilderWorker.SPECIALIST_NAME})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(job: Job<SpecialistRoutingJobData>): Promise<void> {
    if (job.name !== PersonalRelationBuilderWorker.SPECIALIST_NAME) {
      return;
    }

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
        return;
      }
      if (block.tenantId !== tenantId) {
        this.metrics.incPersonalRelationBuilderRun({
          tenantTop,
          result: 'error',
        });
        return;
      }
      if (block.status !== 'canonical') return;

      const personEntities = block.entities.filter(
        (be) => be.entity?.type === 'person',
      );
      if (personEntities.length < 2) {
        this.metrics.incPersonalRelationBuilderRun({
          tenantTop,
          result: 'skipped_no_pair',
        });
        return;
      }

      // На β-8 — упрощённая логика: для friction-блоков создаём
      // 'conflicted_with' между всеми попарно упомянутыми Person'ами.
      const isFriction =
        signalType === 'team_friction' || signalType === 'process_friction';
      if (!isFriction) {
        // На будущее — если придёт другой signalType, пока no-op.
        this.metrics.incPersonalRelationBuilderRun({
          tenantTop,
          result: 'skipped_low_confidence',
        });
        return;
      }

      const relationType: EntityLinkType = 'conflicted_with';
      const confidence = 0.65; // baseline для β-8; γ-2 уточнит через LLM.
      if (confidence < PersonalRelationBuilderWorker.MIN_CONFIDENCE) {
        this.metrics.incPersonalRelationBuilderRun({
          tenantTop,
          result: 'skipped_low_confidence',
        });
        return;
      }

      let linksProcessed = 0;
      for (let i = 0; i < personEntities.length; i++) {
        for (let j = i + 1; j < personEntities.length; j++) {
          const a = personEntities[i]?.entity;
          const b = personEntities[j]?.entity;
          if (!a || !b) continue;
          // Стабилизируем порядок (lex), чтобы (A→B) и (B→A) не плодили дубли.
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
      this.logger.log(
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

/**
 * Pulse Wave 4 §3.2 — расширение Conflict-Detector: ежедневное сканирование
 * текстов DailyCheckIn на парные конфликт-маркеры («конфликт с …», «спор с …»,
 * «трения с …» и т.п.) и upsert `EntityLink.relationType='conflicted_with'`
 * между двумя Person'ами, если найден второй упомянутый сотрудник.
 *
 * Запускается daily в 04:00 UTC (после Engagement-Scorer 03:00 и
 * Burnout-Risk-Detector 03:45 — конфликты успевают учесть в риск-флагах
 * следующего прогона).
 *
 * Логика:
 *   1. DailyCheckIn за последние 24 часа.
 *   2. Собрать blob из `rawResponseText` + текстов `plansJson` / `donesJson` /
 *      `blockersJson`.
 *   3. Скан по russian-конфликт regex'ам.
 *   4. Имя матча → попытка найти `Person` в той же Org (`canonicalName`
 *      caseInsensitive, либо `aliases` — но `Person.aliases` сейчас не
 *      определено; используем только `name`).
 *   5. Если найден И mentionedPersonId !== checkin.personId И у обоих есть
 *      `entityId` (linked Entity) → upsert `EntityLink('conflicted_with')`.
 *
 * Идемпотентность — на уровне composite unique `EntityLink`. Повторный
 * запуск в тот же день перепишет confidence/properties — не плодит дубли.
 *
 * Метрики: `personal_relation_builder_runs_total{result='checkin_conflict_detected'|
 * 'checkin_scanned'}`.
 *
 * Edge cases (все skip без ошибки):
 *   - чек-ин без текстов;
 *   - матч не указан / совпал с самим собой;
 *   - у Person.entityId == null (нет графовой проекции).
 *
 * EU AI Act: это поведенческая аналитика на основе текстов сотрудника, НЕ
 * emotion-recognition (мы не классифицируем эмоции — только парный конфликт
 * по маркерам ключевых слов).
 */
@Injectable()
export class CheckInConflictDetectorCron {
  private readonly logger = new Logger(CheckInConflictDetectorCron.name);
  private static readonly WINDOW_24H_MS = 24 * 60 * 60 * 1000;
  /** Confidence для авто-извлечения из чек-инов (ниже worker'а: 0.55 vs 0.65). */
  private static readonly CONFIDENCE = 0.55;
  /** Максимум 200 символов сниппета вокруг матча — экономия места. */
  private static readonly SNIPPET_LIMIT = 200;

  /**
   * Russian-конфликт-маркеры. Каждый regex захватывает имя/фамилию второй
   * стороны в группе 1 (`<name>`).
   *
   * Замечание про `\b`: в JS Unicode mode (`u`) `\b` плохо работает с
   * кириллицей (определяет boundary только для ASCII word-chars). Поэтому
   * используем явный `(?:^|[^а-яёА-ЯЁ])` префикс — начало строки или не-буква.
   *
   * Имя — 1–2 слова кириллицей, начинающиеся с заглавной буквы (могут
   * содержать дефис, как «Анна-Мария»).
   */
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

  /** Daily в 04:00 UTC. */
  @Cron('0 4 * * *')
  async run(): Promise<void> {
    try {
      const stats = await this.runOnce();
      this.logger.log(stats, 'checkin-conflict-detector: проход завершён');
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
    const since = new Date(
      Date.now() - CheckInConflictDetectorCron.WINDOW_24H_MS,
    );

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

        // Поиск Person'ов в той же Org. На β-8 без морфологии: матчим по
        // корню первого слова кандидата (4 первых символа после lowerCase).
        // Это покрывает падежи русского имени («Анной» → «анна» оба
        // начинаются на «анн»). Берём всех employee'ев Org и фильтруем
        // в памяти — Org обычно ≤ 200 человек, накладные расходы малы.
        const allOrgPersons = await this.prisma.person.findMany({
          where: {
            tenantId: ci.tenantId,
            deletedAt: null,
          },
          select: { id: true, entityId: true, name: true },
        });
        const matches = this.matchPersonsByRoot(
          allOrgPersons,
          candidateNames,
        );

        for (const m of matches) {
          if (m.id === author.id) continue; // само-упоминание
          if (!m.entityId) continue; // нет графовой проекции
          matchesFound++;

          // Сниппет вокруг первого вхождения имени матча в blob.
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

  /**
   * Собирает единый текстовый blob из всех текстовых полей чек-ина для
   * regex-сканирования. Если ни одного текста нет — возвращает пустую строку
   * (caller тогда скипает).
   */
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

  /**
   * Прогоняет все CONFLICT_PATTERNS по blob'у и собирает уникальные имена
   * второй стороны. Нормализация — trim + collapse пробелов.
   */
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
          // Защита от бесконечного цикла на пустых матчах.
          pattern.lastIndex++;
        }
      }
    }
    return names;
  }

  /**
   * Простой morphology-tolerant матч: для каждого Person'а в Org берём первый
   * 3-буквенный корень имени и сравниваем с 3-буквенным корнем имени
   * кандидата. Так «Анной» (кандидат, инструментальный) матчит «Анна»
   * (Person.name) — оба начинаются на «анн». Если у обоих есть второе слово
   * (фамилия), 3-буквенные корни тоже должны совпадать.
   *
   * Возвращает уникальные Person-объекты (без дублирования по id).
   */
  private matchPersonsByRoot(
    persons: Array<{ id: string; entityId: string | null; name: string }>,
    candidates: Set<string>,
  ): Array<{ id: string; entityId: string | null; name: string }> {
    const ROOT_LEN = 3;
    const normalize = (s: string): string =>
      s.toLowerCase().replace(/ё/g, 'е');
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
        // Если у обоих есть фамилия — должны совпадать 3-буквенные корни.
        if (root.last && pLast && root.last !== pLast) continue;
        if (seenIds.has(p.id)) break;
        seenIds.add(p.id);
        result.push(p);
        break;
      }
    }
    return result;
  }

  /** Сниппет — 200 символов вокруг первого вхождения имени (case-insensitive). */
  private makeSnippet(blob: string, name: string): string {
    const idx = blob.toLowerCase().indexOf(name.toLowerCase());
    const limit = CheckInConflictDetectorCron.SNIPPET_LIMIT;
    if (idx < 0) return blob.slice(0, limit);
    const start = Math.max(0, idx - Math.floor(limit / 2));
    return blob.slice(start, start + limit);
  }

  /**
   * Upsert конфликтной связи. Стабилизируем порядок (lex от entityId), чтобы
   * (A→B) и (B→A) не плодили дубли (как в основном worker'е).
   */
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
    const explanation =
      'Авто-извлечение из чек-ина (Pulse Wave 4 §3.2 CheckInConflictDetector).';
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
        confidence: new Prisma.Decimal(
          CheckInConflictDetectorCron.CONFIDENCE.toFixed(3),
        ),
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
        confidence: new Prisma.Decimal(
          CheckInConflictDetectorCron.CONFIDENCE.toFixed(3),
        ),
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
