import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * SBA α-4 wave 2 — CompletenessScannerCron.
 *
 * Каждые 6 часов проходит по нормативным карточкам, обновлённым за последние
 * 7 дней (для быстрого закрытия слотов и реакции на правки), и для каждой
 * карточки выполняет SLOT_DEFINITIONS[cardType] → upsert CompletenessSlot.
 *
 * Принципы (см. sub-TZ §3 / §6 / §8):
 *   - SLOT_DEFINITIONS hardcoded в коде (не в БД) — слоты редко меняются.
 *   - 4 поддерживаемых card_type: regulation / process / role / company_profile.
 *   - Идемпотентность через `@@unique([tenantId, parentCardType, parentCardId, slotName])`.
 *   - LIMIT 500 карточек / тип / Org за один проход — защита от cron-storm.
 *   - При filled=true → counter `completeness_slots_filled_total`.
 *   - В конце прохода — gauge `completeness_slots_open_total{card_type}`.
 */
type CardType = 'regulation' | 'process' | 'role' | 'company_profile';
type SlotKind = 'required' | 'optional';

interface SlotDefinition {
  /** Машинно-читаемое имя слота (для @@unique). */
  name: string;
  kind: SlotKind;
  /**
   * Предикат: возвращает true, если слот «заполнен» для данной карточки.
   * Карточка приходит как `Record<string, unknown>` (часть колонок выборки).
   */
  isFilled: (card: Record<string, unknown>, extra?: ExtraContext) => boolean;
}

interface ExtraContext {
  /** Для Process — число шагов. */
  stepsCount?: number;
  /** Для Role — число ResponsibilityElement. */
  responsibilityCount?: number;
}

const NON_EMPTY = (v: unknown): boolean => {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as Record<string, unknown>).length > 0;
  return true;
};

const SLOT_DEFINITIONS: Record<CardType, readonly SlotDefinition[]> = {
  regulation: [
    { name: 'statement',         kind: 'required', isFilled: (c) => NON_EMPTY(c.statement) },
    { name: 'owner_person',      kind: 'required', isFilled: (c) => NON_EMPTY(c.ownerPersonId) },
    { name: 'scope',             kind: 'required', isFilled: (c) => NON_EMPTY(c.scope) },
    { name: 'current_version',   kind: 'required', isFilled: (c) => NON_EMPTY(c.currentVersionId) },
    { name: 'last_confirmed_at', kind: 'optional', isFilled: (c) => NON_EMPTY(c.lastConfirmedAt) },
  ],
  process: [
    { name: 'owner_role',        kind: 'required', isFilled: (c) => NON_EMPTY(c.ownerRoleId) || NON_EMPTY(c.ownerPersonId) },
    { name: 'trigger',           kind: 'required', isFilled: (c) => NON_EMPTY(c.triggerDescription) },
    { name: 'has_steps',         kind: 'required', isFilled: (_c, ex) => (ex?.stepsCount ?? 0) > 0 },
    { name: 'inputs',            kind: 'required', isFilled: (c) => NON_EMPTY(c.inputs) },
    { name: 'outputs',           kind: 'required', isFilled: (c) => NON_EMPTY(c.outputs) },
    { name: 'metrics',           kind: 'optional', isFilled: (c) => NON_EMPTY(c.metricsJson) },
    { name: 'sla',               kind: 'optional', isFilled: (c) => typeof c.slaMinutes === 'number' && (c.slaMinutes as number) > 0 },
  ],
  role: [
    { name: 'department',         kind: 'required', isFilled: (c) => NON_EMPTY(c.departmentId) },
    { name: 'mission_statement',  kind: 'required', isFilled: (c) => NON_EMPTY(c.missionStatement) },
    { name: 'has_responsibility', kind: 'required', isFilled: (_c, ex) => (ex?.responsibilityCount ?? 0) > 0 },
    { name: 'tags',               kind: 'optional', isFilled: (c) => Array.isArray(c.tags) && (c.tags as unknown[]).length > 0 },
  ],
  company_profile: [
    { name: 'display_name', kind: 'required', isFilled: (c) => NON_EMPTY(c.displayName) },
    { name: 'mission',      kind: 'required', isFilled: (c) => NON_EMPTY(c.missionJson) },
    { name: 'vision',       kind: 'required', isFilled: (c) => NON_EMPTY(c.visionJson) },
    { name: 'strategy',     kind: 'required', isFilled: (c) => NON_EMPTY(c.strategyJson) },
    { name: 'stage',        kind: 'optional', isFilled: (c) => NON_EMPTY(c.stage) },
  ],
};

const LIMIT_PER_TYPE_PER_ORG = 500;
const RECENT_WINDOW_MS = 7 * 24 * 3600 * 1000;

@Injectable()
export class CompletenessScannerService {
  private readonly logger = new Logger(CompletenessScannerService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  /** Публичная карта определений — для тестов и для будущего CompletenessProbeCron'а. */
  static readonly SLOT_DEFINITIONS = SLOT_DEFINITIONS;

  /**
   * Эвалюация слотов одной карточки. Используется одновременно из cron'а и из
   * патч-скрипта `patch-backfill-completeness-slots.ts`.
   */
  async evaluateCard(args: {
    tenantId: string;
    cardType: CardType;
    cardId: string;
    card: Record<string, unknown>;
    extra?: ExtraContext;
  }): Promise<{ filledCount: number; openCount: number }> {
    const defs = SLOT_DEFINITIONS[args.cardType];
    let filled = 0;
    let open = 0;
    for (const def of defs) {
      const isFilled = def.isFilled(args.card, args.extra);
      // upsert по @@unique
      const existing = await this.prisma.completenessSlot.findUnique({
        where: {
          tenantId_parentCardType_parentCardId_slotName: {
            tenantId: args.tenantId,
            parentCardType: args.cardType,
            parentCardId: args.cardId,
            slotName: def.name,
          },
        },
        select: { id: true, filledAt: true },
      });

      if (!existing) {
        await this.prisma.completenessSlot.create({
          data: {
            tenantId: args.tenantId,
            parentCardType: args.cardType,
            parentCardId: args.cardId,
            slotName: def.name,
            slotKind: def.kind,
            filledAt: isFilled ? new Date() : null,
          },
        });
        if (isFilled) {
          filled += 1;
          this.metrics.incCompletenessSlotsFilled({ cardType: args.cardType });
        } else {
          open += 1;
        }
        continue;
      }

      // existing — апдейтим только при смене состояния.
      if (isFilled && !existing.filledAt) {
        await this.prisma.completenessSlot.update({
          where: { id: existing.id },
          data: { filledAt: new Date() },
        });
        filled += 1;
        this.metrics.incCompletenessSlotsFilled({ cardType: args.cardType });
      } else if (!isFilled && existing.filledAt) {
        // Регрессия: данные стёрли — снова открываем слот.
        await this.prisma.completenessSlot.update({
          where: { id: existing.id },
          data: { filledAt: null, filledByUserId: null },
        });
        open += 1;
      } else if (isFilled) {
        filled += 1;
      } else {
        open += 1;
      }
    }
    return { filledCount: filled, openCount: open };
  }

  /**
   * Полный проход: для всех Org берём карточки 4 типов, обновлённые за окно
   * recent (7 дней). Возвращаем summary.
   */
  async runForAllOrgs(): Promise<{
    scannedOrgs: number;
    scannedCards: number;
    slotsUpdated: number;
  }> {
    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    let scannedCards = 0;
    let slotsUpdated = 0;
    const since = new Date(Date.now() - RECENT_WINDOW_MS);

    for (const org of orgs) {
      try {
        const summary = await this.runForOrg(org.id, since);
        scannedCards += summary.cards;
        slotsUpdated += summary.slots;
      } catch (err) {
        this.logger.warn(
          {
            tenantId: org.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'completeness-scanner: ошибка обработки Org — пропускаю',
        );
      }
    }

    // Финальный gauge: открытые слоты по card_type.
    await this.refreshOpenGauges();

    return {
      scannedOrgs: orgs.length,
      scannedCards,
      slotsUpdated,
    };
  }

  /**
   * Одна Org — все 4 типа карточек. Для process / role подгружается extra
   * (stepsCount / responsibilityCount), потому что предикаты «есть шаги»
   * нужны без N+1.
   */
  async runForOrg(
    tenantId: string,
    since: Date,
  ): Promise<{ cards: number; slots: number }> {
    let cards = 0;
    let slots = 0;

    // ── regulation
    const regs = await this.prisma.regulation.findMany({
      where: { tenantId, updatedAt: { gte: since } },
      take: LIMIT_PER_TYPE_PER_ORG,
      select: {
        id: true,
        statement: true,
        ownerPersonId: true,
        scope: true,
        currentVersionId: true,
        lastConfirmedAt: true,
      },
    });
    for (const r of regs) {
      const res = await this.evaluateCard({
        tenantId,
        cardType: 'regulation',
        cardId: r.id,
        card: r as unknown as Record<string, unknown>,
      });
      cards += 1;
      slots += res.filledCount + res.openCount;
    }

    // ── process (+ stepsCount)
    const processes = await this.prisma.process.findMany({
      where: { tenantId, updatedAt: { gte: since } },
      take: LIMIT_PER_TYPE_PER_ORG,
      select: {
        id: true,
        ownerRoleId: true,
        ownerPersonId: true,
        triggerDescription: true,
        inputs: true,
        outputs: true,
        metricsJson: true,
        slaMinutes: true,
        _count: { select: { steps: true } },
      },
    });
    for (const p of processes) {
      const extra: ExtraContext = { stepsCount: p._count.steps };
      const res = await this.evaluateCard({
        tenantId,
        cardType: 'process',
        cardId: p.id,
        card: p as unknown as Record<string, unknown>,
        extra,
      });
      cards += 1;
      slots += res.filledCount + res.openCount;
    }

    // ── role (+ responsibilityCount)
    const roles = await this.prisma.role.findMany({
      where: { tenantId, updatedAt: { gte: since }, deletedAt: null },
      take: LIMIT_PER_TYPE_PER_ORG,
      select: {
        id: true,
        departmentId: true,
        missionStatement: true,
        tags: true,
        _count: { select: { responsibilityElements: true } },
      },
    });
    for (const r of roles) {
      const extra: ExtraContext = {
        responsibilityCount: r._count.responsibilityElements,
      };
      const res = await this.evaluateCard({
        tenantId,
        cardType: 'role',
        cardId: r.id,
        card: r as unknown as Record<string, unknown>,
        extra,
      });
      cards += 1;
      slots += res.filledCount + res.openCount;
    }

    // ── company_profile (одна запись на Org).
    const company = await this.prisma.companyProfile.findUnique({
      where: { tenantId },
      select: {
        id: true,
        displayName: true,
        missionJson: true,
        visionJson: true,
        strategyJson: true,
        stage: true,
      },
    });
    if (company) {
      const res = await this.evaluateCard({
        tenantId,
        cardType: 'company_profile',
        cardId: company.id,
        card: company as unknown as Record<string, unknown>,
      });
      cards += 1;
      slots += res.filledCount + res.openCount;
    }

    return { cards, slots };
  }

  /**
   * Обновить gauge `completeness_slots_open_total{card_type}` глобально.
   * Считаем `filledAt IS NULL` по всем tenant. Cardinality-safe (4 значения).
   */
  async refreshOpenGauges(): Promise<void> {
    const rows = await this.prisma.completenessSlot.groupBy({
      by: ['parentCardType'],
      where: { filledAt: null },
      _count: { _all: true },
    });
    const byType = new Map<string, number>();
    for (const r of rows) byType.set(r.parentCardType, r._count._all);
    for (const cardType of Object.keys(SLOT_DEFINITIONS) as CardType[]) {
      this.metrics.setCompletenessSlotsOpen({
        cardType,
        value: byType.get(cardType) ?? 0,
      });
    }
  }

  /** Явная заметка о ручном закрытии (для метрики). */
  noteManualFilled(cardType: string): void {
    this.metrics.incCompletenessSlotsFilled({ cardType });
  }
}

/**
 * Сам Cron-обёртка вокруг сервиса. Расписание `0 *\/6 * * *` (каждые 6 часов)
 * по sub-TZ §8.
 */
@Injectable()
export class CompletenessScannerCron {
  private readonly logger = new Logger(CompletenessScannerCron.name);

  constructor(
    @Inject(CompletenessScannerService)
    private readonly scanner: CompletenessScannerService,
  ) {}

  @Cron('0 */6 * * *')
  async runScheduled(): Promise<void> {
    // Тумблер через process.env (а не TypedConfigService) — добавление новых
    // ключей в EnvSchema провоцирует TS2589 на длинной .merge цепочке.
    // Дефолт — ВКЛ; чтобы выключить на проде, выставить
    // COMPLETENESS_SCANNER_ENABLED=false.
    const enabled = !['false', '0', 'no', 'off'].includes(
      String(process.env.COMPLETENESS_SCANNER_ENABLED ?? '').toLowerCase(),
    );
    if (!enabled) {
      this.logger.debug('completeness-scanner: выключен через ENV — пропуск');
      return;
    }
    try {
      const summary = await this.scanner.runForAllOrgs();
      this.logger.log(summary, 'completeness-scanner: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'completeness-scanner: непойманная ошибка',
      );
    }
  }

  /**
   * Реактивный вход: если карточка изменилась (например, через
   * `Regulation` save) — внешний код может позвать этот метод, чтобы
   * сразу же переоценить слоты конкретной карточки (см. sub-TZ §3 п.9).
   *
   * Это «event-driven fallback»: пока нет EventEmitter в curation-модуле,
   * специалисты Слоя 3 могут вызывать этот метод по своей инициативе.
   */
  async evaluateOne(args: {
    tenantId: string;
    cardType: 'regulation' | 'process' | 'role' | 'company_profile';
    cardId: string;
    card: Record<string, unknown>;
  }): Promise<void> {
    await this.scanner.evaluateCard(args as Parameters<CompletenessScannerService['evaluateCard']>[0]);
  }

  /** Сахар для тестов / patch-скриптов. */
  static get cronExpression(): string {
    return '0 */6 * * *';
  }
}

// Подсказка типов для TypedConfigService (Prisma не trips, но lint поджёг
// бы "unused" — поэтому Prisma re-export для будущих расширений ниже).
export type { Prisma };
