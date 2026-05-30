import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ProbeService } from '../../probe/probe.service';
import { HolidayService } from '../../tracker/services/holiday.service';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

/**
 * SBA β-8.2 — Specialist 3.9 «Хранитель обещаний».
 *
 * Раз в день для каждого Org выполняет два прохода:
 *
 *   1. **followup** — обещания с `commitmentStatus='open'`, у которых
 *      `commitmentDueDate` прошёл хотя бы один рабочий день назад
 *      (через HolidayService). На каждое — `ProbeService.suggest` с
 *      reason='commitment.followup' получателю-автору. После — выставляем
 *      `commitmentStatus='asked'` и `commitmentAskedAt=now`.
 *
 *   2. **escalate** — обещания с `commitmentStatus='asked'`, по которым
 *      молчат `COMMITMENT_ESCALATION_DAYS` дней (default 3) и нет
 *      `commitmentEscalatedAt`. Эскалируем — probe всем `coo`/`owner`
 *      Org'а с reason='commitment.silence_escalation'. Ставим
 *      `commitmentEscalatedAt=now`.
 *
 * Идемпотентность:
 *   - ProbeService сам защищается от повторов 72ч по contentHash.
 *   - Флаг `commitmentStatus='asked'` гарантирует, что followup не пойдёт
 *     повторно (cron ищет только `open`).
 *   - Эскалация выполняется ровно один раз (фильтр `commitmentEscalatedAt IS NULL`).
 *
 * Безопасность каскадных сбоев — best-effort: ошибка по одному блоку не
 * валит весь проход.
 */
@Injectable()
export class Specialist39PromiseKeeperService {
  private readonly logger = new Logger(Specialist39PromiseKeeperService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ProbeService) private readonly probe: ProbeService,
    @Inject(HolidayService) private readonly holidays: HolidayService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  /**
   * Выборка просроченных open-обещаний с фильтром «прошёл хотя бы один
   * рабочий день после `commitmentDueDate`». Так как HolidayService даёт
   * `nextBusinessDay`, считаем: блок просрочен, если
   * `nextBusinessDay(commitmentDueDate + 1) <= today`.
   *
   * Чтобы не делать N запросов в БД, забираем все open-блоки с
   * `commitmentDueDate < today` за один SQL, а HolidayService применяем уже
   * к каждому из них.
   */
  async findFollowupCandidates(args: {
    tenantId: string;
    now: Date;
  }): Promise<
    Array<{
      id: string;
      tenantId: string;
      criticalQuestion: string;
      trustedAnswer: string;
      commitmentDueDate: Date | null;
      commitmentRecipientPersonId: string | null;
      authorUserIds: string[];
    }>
  > {
    const today = new Date(
      Date.UTC(
        args.now.getUTCFullYear(),
        args.now.getUTCMonth(),
        args.now.getUTCDate(),
        0,
        0,
        0,
        0,
      ),
    );

    const blocks = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId: args.tenantId,
        signalType: 'commitment',
        commitmentStatus: 'open',
        commitmentDueDate: { lt: today },
      },
      select: {
        id: true,
        tenantId: true,
        criticalQuestion: true,
        trustedAnswer: true,
        commitmentDueDate: true,
        commitmentRecipientPersonId: true,
      },
      take: 500,
    });

    if (blocks.length === 0) return [];

    // Для каждого блока — найти автора через IdeaBlockEntity → Entity (type='person')
    // → Person (relationship='employee', userId IS NOT NULL). Считаем,
    // что автор обещания — это person с ролью 'subject' в IdeaBlockEntity
    // (если нет — берём любого employee-person из mentioned).
    const out: Array<{
      id: string;
      tenantId: string;
      criticalQuestion: string;
      trustedAnswer: string;
      commitmentDueDate: Date | null;
      commitmentRecipientPersonId: string | null;
      authorUserIds: string[];
    }> = [];

    for (const block of blocks) {
      // Проверяем «прошёл хотя бы один рабочий день после dueDate».
      // nextBusinessDay(dueDate + 1) <= today.
      const due = block.commitmentDueDate;
      if (!due) continue;
      const dayAfter = new Date(due.getTime());
      dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
      try {
        const nextWorkday = await this.holidays.nextBusinessDay({
          tenantId: block.tenantId,
          date: dayAfter,
        });
        // Просрочен — если рабочий день уже наступил В ПРОШЛОМ (т.е.
        // nextWorkday < today). Если nextWorkday == today, значит срок
        // прошёл прямо вчера и сегодня — рабочий день: пока ещё рано
        // дёргать сотрудника, дадим ему день.
        if (nextWorkday.getTime() >= today.getTime()) {
          continue;
        }
      } catch (err) {
        this.logger.debug(
          {
            blockId: block.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'PromiseKeeper: HolidayService.nextBusinessDay упал — считаем срок просрочен',
        );
      }

      const authorUserIds = await this.resolveAuthorUserIds({
        tenantId: block.tenantId,
        blockId: block.id,
      });
      if (authorUserIds.length === 0) {
        // Нет автора-employee — спросить не у кого, пропускаем.
        continue;
      }
      out.push({ ...block, authorUserIds });
    }
    return out;
  }

  /**
   * Выборка обещаний, которые подлежат эскалации (probe COO + owner).
   * Фильтр: `commitmentStatus='asked'`, `commitmentAskedAt < now - escalationDays`,
   * `commitmentEscalatedAt IS NULL`.
   */
  async findEscalationCandidates(args: {
    tenantId: string;
    now: Date;
  }): Promise<
    Array<{
      id: string;
      tenantId: string;
      criticalQuestion: string;
      trustedAnswer: string;
      commitmentDueDate: Date | null;
      commitmentAskedAt: Date | null;
      authorUserIds: string[];
    }>
  > {
    const escalationDays = this.cfg.betaOps.commitmentEscalationDays;
    const threshold = new Date(
      args.now.getTime() - escalationDays * 24 * 3600 * 1000,
    );

    const blocks = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId: args.tenantId,
        signalType: 'commitment',
        commitmentStatus: 'asked',
        commitmentAskedAt: { lt: threshold },
        commitmentEscalatedAt: null,
      },
      select: {
        id: true,
        tenantId: true,
        criticalQuestion: true,
        trustedAnswer: true,
        commitmentDueDate: true,
        commitmentAskedAt: true,
      },
      take: 500,
    });
    if (blocks.length === 0) return [];

    const out: Array<{
      id: string;
      tenantId: string;
      criticalQuestion: string;
      trustedAnswer: string;
      commitmentDueDate: Date | null;
      commitmentAskedAt: Date | null;
      authorUserIds: string[];
    }> = [];
    for (const block of blocks) {
      const authorUserIds = await this.resolveAuthorUserIds({
        tenantId: block.tenantId,
        blockId: block.id,
      });
      out.push({ ...block, authorUserIds });
    }
    return out;
  }

  /**
   * Отправить followup-probe автору обещания. После — атомарно проставить
   * `commitmentStatus='asked'` + `commitmentAskedAt=now`.
   *
   * Best-effort: ошибка БД/Probe не валит. При rate_limit / cold_start —
   * пропускаем апдейт статуса, чтобы cron попробовал ещё раз.
   */
  async sendFollowupForBlock(args: {
    blockId: string;
    tenantId: string;
    authorUserIds: string[];
    questionText: string;
    contextSummary: string;
  }): Promise<{ sent: boolean }> {
    const message = `Привет! ${args.contextSummary}. Получилось закрыть? Если нет — какой блокер?`;
    const result = await this.probe.suggest({
      tenantId: args.tenantId,
      emittedByService: '3-9-promise-keeper',
      reason: 'commitment.followup',
      payload: {
        message,
        suggestedQuestion: args.questionText,
        // 2026-05-30 (Agents v2 Фаза 0.2): suggestedOptions удалены — probe без кнопок.
        // suggestedActions оставлены как семантический контекст для LLM probe-formulate.
        suggestedActions: ['Сделано', 'Не сделано', 'Продлеваю срок'],
        contextBlockId: args.blockId,
      },
      recipientCandidates: args.authorUserIds,
      priorityHint: 0.6,
    });
    if ('dropped' in result) {
      this.logger.debug(
        { blockId: args.blockId, dropped: result.dropped },
        'PromiseKeeper.sendFollowup: probe dropped',
      );
      return { sent: false };
    }
    try {
      await this.prisma.ideaBlock.update({
        where: { id: args.blockId },
        data: {
          commitmentStatus: 'asked',
          commitmentAskedAt: new Date(),
        },
      });
      this.metrics?.incCommitmentsAsked({
        tenantTop: resolveOperationsTenantTop(args.tenantId),
      });
      return { sent: true };
    } catch (err) {
      this.logger.warn(
        {
          blockId: args.blockId,
          err: err instanceof Error ? err.message : String(err),
        },
        'PromiseKeeper.sendFollowup: update commitmentStatus упал — probe ушёл, но статус не обновлён',
      );
      return { sent: false };
    }
  }

  /**
   * Эскалация: probe всем `coo`/`owner` Org'а с reason='commitment.silence_escalation'.
   * Ставим `commitmentEscalatedAt=now` после первого успешного probe.
   */
  async sendEscalationForBlock(args: {
    blockId: string;
    tenantId: string;
    authorUserIds: string[];
    questionText: string;
    contextSummary: string;
  }): Promise<{ sent: boolean }> {
    const memberships = await this.prisma.membership.findMany({
      where: {
        orgId: args.tenantId,
        role: { in: ['owner', 'coo'] },
      },
      select: { userId: true },
    });
    const recipientCandidates = memberships
      .map((m) => m.userId)
      .filter((uid) => !args.authorUserIds.includes(uid));
    if (recipientCandidates.length === 0) {
      this.logger.debug(
        { blockId: args.blockId },
        'PromiseKeeper.sendEscalation: нет COO/owner для эскалации',
      );
      return { sent: false };
    }
    const message = `Сотрудник не отвечает на followup по обещанию: «${args.contextSummary}». Молчит ${this.cfg.betaOps.commitmentEscalationDays} дн.`;
    const result = await this.probe.suggest({
      tenantId: args.tenantId,
      emittedByService: '3-9-promise-keeper',
      reason: 'commitment.silence_escalation',
      payload: {
        message,
        suggestedQuestion: args.questionText,
        contextBlockId: args.blockId,
      },
      recipientCandidates,
      priorityHint: 0.7,
    });
    if ('dropped' in result) {
      this.logger.debug(
        { blockId: args.blockId, dropped: result.dropped },
        'PromiseKeeper.sendEscalation: probe dropped',
      );
      return { sent: false };
    }
    try {
      await this.prisma.ideaBlock.update({
        where: { id: args.blockId },
        data: { commitmentEscalatedAt: new Date() },
      });
      this.metrics?.incCommitmentsEscalated({
        tenantTop: resolveOperationsTenantTop(args.tenantId),
      });
      return { sent: true };
    } catch (err) {
      this.logger.warn(
        {
          blockId: args.blockId,
          err: err instanceof Error ? err.message : String(err),
        },
        'PromiseKeeper.sendEscalation: update commitmentEscalatedAt упал — probe ушёл, но флаг не обновлён',
      );
      return { sent: false };
    }
  }

  /**
   * Найти userIds авторов обещания: ищем employee-Person'ы, упомянутые в
   * блоке как subject (через IdeaBlockEntity.role='subject') или просто
   * mentioned (если subject не указан).
   */
  private async resolveAuthorUserIds(args: {
    tenantId: string;
    blockId: string;
  }): Promise<string[]> {
    // 1) Любой Person с relationship='employee', привязанный через
    //    Entity (type='person') к этому блоку. Entity.persons — список
    //    Person'ов (Фаза 0b §8.3 EntityResolutionService).
    const links = await this.prisma.ideaBlockEntity.findMany({
      where: {
        blockId: args.blockId,
        entity: {
          type: 'person',
          tenantId: args.tenantId,
          persons: {
            some: {
              relationship: 'employee',
              deletedAt: null,
              userId: { not: null },
            },
          },
        },
      },
      select: {
        role: true,
        entity: {
          select: {
            persons: {
              where: {
                relationship: 'employee',
                deletedAt: null,
                userId: { not: null },
              },
              select: { userId: true },
            },
          },
        },
      },
    });
    if (links.length === 0) return [];
    // Приоритет role='subject', иначе — любой mentioned.
    const subjects = links.filter((l) => l.role === 'subject');
    const pool = subjects.length > 0 ? subjects : links;
    const userIds = new Set<string>();
    for (const l of pool) {
      for (const p of l.entity?.persons ?? []) {
        if (p.userId) userIds.add(p.userId);
      }
    }
    return Array.from(userIds);
  }
}
