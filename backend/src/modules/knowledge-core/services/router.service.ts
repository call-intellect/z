import { Inject, Injectable, Logger } from '@nestjs/common';
import type { IdeaBlock, SignalType } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';

/**
 * RouterService — диспетчер атомов знаний (IdeaBlock) в специалистов Слоя 3.
 * SBA α-3 §5. Архитектурное решение §11.2 зонтичного / §10.0 sub-ТЗ —
 * **статический mapping** signalType→specialist (быстрее, дешевле, прозрачнее,
 * никакого LLM-роутинга).
 *
 * Mapping (см. plans/tz/2026-05-21-sba-alpha-3-layer2-ontology-extension.md §5):
 *   - decision | rationale | decision_basis → 3-3-decisions
 *   - regulation | process_step           → 3-1-regulations
 *   - pain | risk | churn_risk | objection → 3-5-insights
 *   - idea | feature_request               → 3-6-ideas
 *   - reasoning (если subject — employee)  → 3-7-skill
 *   - fact (если есть Customer/Vendor/Project entity) → 3-4-project-customer
 *   - knowledge_gap                        → 3-2-knowledge-clone
 *
 * Анти-fan-out: env `ROUTER_MAX_SPECIALISTS_PER_BLOCK` (default 4) — если
 * получилось больше специалистов, оставляем top-N по приоритету:
 * decisions > regulations > insights > ideas > skill > project-customer > knowledge-clone.
 *
 * На α-3 реальные consumer'ы ещё НЕ существуют (3.4 — α-6, 3.1 — α-7, и т.д.).
 * RouterService только пушит jobs в очередь `core.specialist-routing` —
 * консумеры подцепятся в соответствующих sub-TZ.
 */
@Injectable()
export class RouterService {
  private readonly logger = new Logger(RouterService.name);

  /**
   * Имена специалистов как ключи jobName. Не алиас: эти строки увидят
   * консумеры в их `Worker` (jobName-фильтр) — менять их = breaking change
   * для будущих специалистов.
   */
  static readonly SPECIALIST = {
    DECISIONS: '3-3-decisions',
    REGULATIONS: '3-1-regulations',
    INSIGHTS: '3-5-insights',
    IDEAS: '3-6-ideas',
    SKILL: '3-7-skill',
    PROJECT_CUSTOMER: '3-4-project-customer',
    KNOWLEDGE_CLONE: '3-2-knowledge-clone',
  } as const;

  /**
   * Приоритет специалистов для анти-fan-out trim'а. Чем меньше число — тем
   * важнее. См. §10.0 sub-ТЗ: «decisions > regulations > insights > ideas >
   * skill > project-customer > knowledge-clone».
   */
  private static readonly PRIORITY: Record<string, number> = {
    [RouterService.SPECIALIST.DECISIONS]: 1,
    [RouterService.SPECIALIST.REGULATIONS]: 2,
    [RouterService.SPECIALIST.INSIGHTS]: 3,
    [RouterService.SPECIALIST.IDEAS]: 4,
    [RouterService.SPECIALIST.SKILL]: 5,
    [RouterService.SPECIALIST.PROJECT_CUSTOMER]: 6,
    [RouterService.SPECIALIST.KNOWLEDGE_CLONE]: 7,
  };

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  /**
   * Главный метод: матчит специалистов и публикует jobs в
   * `core.specialist-routing`. Возвращает список фактически выпущенных
   * специалистов (после trim'а).
   *
   * Контракт: НЕ бросает (best-effort). Если БД/Redis на секунду упали —
   * блок уже создан, повторный enqueue произойдёт при следующем block-ingest
   * (он идемпотентен по jobId).
   */
  async dispatch(block: Pick<IdeaBlock, 'id' | 'tenantId' | 'signalType'>): Promise<{
    dispatched: string[];
    fanOutBeforeTrim: number;
  }> {
    let targets: string[];
    try {
      targets = await this.matchSpecialists(block);
    } catch (err) {
      this.logger.warn(
        {
          blockId: block.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'RouterService: matchSpecialists упал — пропускаем dispatch',
      );
      return { dispatched: [], fanOutBeforeTrim: 0 };
    }

    const fanOutBeforeTrim = targets.length;
    this.metrics.observeCoreRouterFanOut(fanOutBeforeTrim);

    const limit = this.cfg.router.maxSpecialistsPerBlock;
    let finalTargets = targets;
    if (targets.length > limit) {
      // Top-N по приоритету (меньше число = выше приоритет).
      finalTargets = [...targets]
        .sort(
          (a, b) =>
            (RouterService.PRIORITY[a] ?? 99) - (RouterService.PRIORITY[b] ?? 99),
        )
        .slice(0, limit);
      this.metrics.incCoreRouterTrimmed({ signalType: block.signalType });
      this.logger.debug(
        {
          blockId: block.id,
          requested: targets,
          kept: finalTargets,
          limit,
        },
        'RouterService: анти-fan-out — часть специалистов отброшена',
      );
    }

    const dispatched: string[] = [];
    for (const specialistName of finalTargets) {
      try {
        await this.coreQueue.enqueueSpecialistRouting({
          specialistName,
          blockId: block.id,
          tenantId: block.tenantId,
          signalType: block.signalType,
        });
        this.metrics.incCoreRouterDispatched({
          specialist: specialistName,
          signalType: block.signalType,
        });
        dispatched.push(specialistName);
      } catch (err) {
        this.logger.warn(
          {
            blockId: block.id,
            specialistName,
            err: err instanceof Error ? err.message : String(err),
          },
          'RouterService: enqueueSpecialistRouting упал — продолжаем по другим специалистам',
        );
      }
    }

    return { dispatched, fanOutBeforeTrim };
  }

  /**
   * Внутренний метод — статический mapping signalType → set специалистов.
   * Дополнительные условия (subject is employee, привязка к Customer/Vendor/
   * Project) проверяются здесь же лёгкими SQL-запросами.
   */
  private async matchSpecialists(
    block: Pick<IdeaBlock, 'id' | 'tenantId' | 'signalType'>,
  ): Promise<string[]> {
    const targets = new Set<string>();
    const signal = block.signalType;

    switch (signal) {
      case 'decision':
      case 'rationale':
      case 'decision_basis':
        targets.add(RouterService.SPECIALIST.DECISIONS);
        break;
      case 'regulation':
      case 'process_step':
        targets.add(RouterService.SPECIALIST.REGULATIONS);
        break;
      case 'pain':
      case 'risk':
      case 'churn_risk':
      case 'objection':
        targets.add(RouterService.SPECIALIST.INSIGHTS);
        break;
      case 'idea':
      case 'feature_request':
        targets.add(RouterService.SPECIALIST.IDEAS);
        break;
      case 'reasoning': {
        // 3-7-skill — только если у блока есть subject-Person, и этот Person
        // — сотрудник (relationship='employee'). Иначе reasoning не уходит
        // в SkillProfile (нет смысла учить навыки внешнему контакту).
        const hasEmployeeSubject = await this.hasEmployeeSubject(block.id);
        if (hasEmployeeSubject) {
          targets.add(RouterService.SPECIALIST.SKILL);
        }
        break;
      }
      case 'fact': {
        // 3-4-project-customer — только если в блоке упомянуты Customer/
        // Vendor/Project entities. Без этого fact-блок никому не интересен
        // в Слое 3 (просто фиксируется в графе).
        const hasProjectOrCustomer = await this.hasProjectCustomerOrVendor(
          block.id,
        );
        if (hasProjectOrCustomer) {
          targets.add(RouterService.SPECIALIST.PROJECT_CUSTOMER);
        }
        // SBA β-2 — 3-2-knowledge-clone: fact-блок про сотрудника (Person с
        // relationship='employee', упомянутый как subject или mentioned)
        // обогащает его knowledgeProfile. Проверка дешёвая (одна JOIN-выборка
        // через IdeaBlockEntity → Entity → Person).
        const hasEmployeeMention = await this.hasEmployeeMention(block.id);
        if (hasEmployeeMention) {
          targets.add(RouterService.SPECIALIST.KNOWLEDGE_CLONE);
        }
        break;
      }
      case 'knowledge_gap':
        targets.add(RouterService.SPECIALIST.KNOWLEDGE_CLONE);
        break;
      // Прочие signalType (commitment, mood, drift, metric_change, …) —
      // на α-3 не маршрутизируются. Их специалисты появятся в δ+.
      default:
        // no-op
        break;
    }

    return Array.from(targets);
  }

  /**
   * Проверяет, есть ли у блока subject-Entity, связанная с Person, который
   * сотрудник (Person.relationship='employee'). Используется для роутинга
   * reasoning → 3-7-skill.
   *
   * Дешёвый запрос: одна JOIN-комбинация IdeaBlockEntity → Entity → Person.
   */
  private async hasEmployeeSubject(blockId: string): Promise<boolean> {
    const result = await this.prisma.ideaBlockEntity.findFirst({
      where: {
        blockId,
        role: 'subject',
        entity: {
          type: 'person',
          persons: {
            some: {
              relationship: 'employee',
              deletedAt: null,
            },
          },
        },
      },
      select: { entityId: true },
    });
    return result !== null;
  }

  /**
   * Проверяет, есть ли в блоке упоминание Customer/Vendor/Project entity.
   * Используется для роутинга fact → 3-4-project-customer.
   *
   * NB: используем `type in ['customer', 'vendor', 'project']` — без linkage
   * на Prisma-модели Vendor (она появилась в α-3, на старте может быть пуста),
   * чтобы матчиться сразу.
   */
  private async hasProjectCustomerOrVendor(blockId: string): Promise<boolean> {
    const result = await this.prisma.ideaBlockEntity.findFirst({
      where: {
        blockId,
        entity: {
          type: { in: ['customer', 'vendor', 'project', 'client'] },
        },
      },
      select: { entityId: true },
    });
    return result !== null;
  }

  /**
   * SBA β-2 — есть ли в блоке упоминание Person с `relationship='employee'`
   * (как subject ИЛИ как mentioned). Используется для роутинга fact-блоков
   * в 3-2-knowledge-clone (обогащение Knowledge Profile сотрудника).
   *
   * Дешёвый запрос: одна JOIN-выборка IdeaBlockEntity → Entity → Person с
   * фильтром по relationship.
   */
  private async hasEmployeeMention(blockId: string): Promise<boolean> {
    const result = await this.prisma.ideaBlockEntity.findFirst({
      where: {
        blockId,
        role: { in: ['subject', 'mentioned'] },
        entity: {
          type: 'person',
          persons: {
            some: {
              relationship: 'employee',
              deletedAt: null,
            },
          },
        },
      },
      select: { entityId: true },
    });
    return result !== null;
  }

  // Stub-метод, нужный для будущих юнит-тестов: статический matcher без БД.
  // Используется тестами специалистов в δ+ для проверки приоритетов.
  static priorityOf(specialist: string): number {
    return RouterService.PRIORITY[specialist] ?? 99;
  }
}

// Re-export для удобства потребителей — type-safe whitelist signalType.
// Дублирует Prisma `SignalType` only ради явной документации в коде RouterService.
export type RouterSignalType = SignalType;
