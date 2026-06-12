import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Experiment } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ActivityFeedService } from '../../activity-feed/services/activity-feed.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { ProbeService } from '../../probe/probe.service';

import { OwnerResolverService } from './owner-resolver.service';

/**
 * SBA β-6 — Specialist39ExperimentProbeService.
 *
 * Эмиссия probe-events Experiment Tracker'а согласно §2 sub-TZ. 3 trigger'а:
 *
 *   1. `experiment.no_owner` — эксперимент без `ownerEntityId` старше 24h →
 *      owner/admin Org с предложением назначить ответственного.
 *      (cron-trigger из `experiment-status-resolver.cron`)
 *   2. `experiment.running_too_long` — `status='running'` И
 *      `now - startedAt > EXPERIMENT_RUNNING_PROBE_THRESHOLD_DAYS` (default 30)
 *      И `currentResult IS NULL` → owner/admin + ownerPerson.
 *      (cron-trigger)
 *   3. `experiment.result_without_lesson` — у эксперимента есть `currentResult`,
 *      но `lessonsJson` пустой/null → admin/owner.
 *      (синхронный trigger из `experiment-detector.worker` после persist'а)
 *
 * Контракт §5: НЕ бросает. Один упавший probe не валит остальные. Каждый
 * успешный probe инкрементит
 * `core_specialist_probe_events_total{type='experiment', reason='...'}`.
 */
@Injectable()
export class Specialist39ExperimentProbeService {
  private readonly logger = new Logger(Specialist39ExperimentProbeService.name);

  static readonly SPECIALIST_NAME = '3-9-experiments';
  /** Защита от взрывного fan-out'а в cron'е. */
  private static readonly CRON_BATCH_LIMIT = 100;
  /** Через сколько часов эксперимент без owner становится «бесхозным». */
  private static readonly NO_OWNER_AGE_HOURS = 24;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(ProbeService)
    private readonly probeService?: ProbeService,
    // W2 autonomy (2026-06-12) — «лестница владельца» + лента «что сделала
    // Кора». Optional: без них работает прежнее поведение (probe).
    @Optional()
    @Inject(OwnerResolverService)
    private readonly ownerResolver?: OwnerResolverService,
    @Optional()
    @Inject(ActivityFeedService)
    private readonly activityFeed?: ActivityFeedService,
  ) {}

  // ─────────────────────── public sync triggers ──────────────────────

  /**
   * Trigger 3 — `experiment.result_without_lesson`. Вызывается из
   * `experiment-detector.worker` сразу после persist'а Experiment'а с
   * `currentResult != null` и пустым `lessonsJson`.
   */
  async emitResultWithoutLesson(exp: Experiment): Promise<void> {
    try {
      if (!exp.currentResult) return;
      const hasLessons = Array.isArray(exp.lessonsJson)
        ? (exp.lessonsJson as unknown[]).length > 0
        : false;
      if (hasLessons) return;
      const recipients = await this.findOrgAdminsUserIds(exp.tenantId);
      if (recipients.length === 0) return;
      const name = exp.name.slice(0, 80);
      const message = `У эксперимента «${name}» есть результат, но не зафиксирован урок. Что вы для себя вынесли?`;
      await this.emit({
        tenantId: exp.tenantId,
        experimentId: exp.id,
        reason: 'experiment.result_without_lesson',
        message,
        recipients,
        suggestedActions: [
          'Записать что сработало',
          'Записать что не сработало',
          'Это разовый эпизод',
        ],
        priorityHint: 0.5,
      });
    } catch (err) {
      this.logErr('experiment.result_without_lesson', exp.id, err);
    }
  }

  // ─────────────────────── cron-triggers ─────────────────────────────

  /**
   * Trigger 1 — `experiment.no_owner`. Запускается из
   * `experiment-status-resolver.cron`. Эксперименты без `ownerEntityId`
   * старше NO_OWNER_AGE_HOURS → пинаем admin'а назначить ответственного.
   */
  async checkNoOwnerForOrg(tenantId: string): Promise<number> {
    const cutoff = new Date(
      Date.now() -
        Specialist39ExperimentProbeService.NO_OWNER_AGE_HOURS * 3600 * 1000,
    );
    const experiments = await this.prisma.experiment.findMany({
      where: {
        tenantId,
        ownerEntityId: null,
        status: { in: ['hypothesis', 'running'] },
        createdAt: { lt: cutoff },
      },
      take: Specialist39ExperimentProbeService.CRON_BATCH_LIMIT,
    });
    let emitted = 0;
    for (const exp of experiments) {
      try {
        const recipients = await this.findOrgAdminsUserIds(exp.tenantId);
        if (recipients.length === 0) continue;
        const name = exp.name.slice(0, 80);
        // W2 autonomy (2026-06-12) — «лестница владельца» ДО probe:
        // subject-Person'ы эксперимента как пул кандидатов. Единственный
        // кандидат → Кора назначает сама (Experiment.ownerEntityId), probe
        // не шлём; несколько → вопрос-выбор с именами; никого → как раньше.
        const ladder = await this.tryResolveOwner(exp);
        if (ladder.outcome === 'auto') continue;
        const message =
          ladder.outcome === 'ambiguous'
            ? `Эксперимент «${name}» уже больше суток без ответственного. Кого назначить ответственным: ${ladder.candidateNames.join(' или ')}?`
            : `Эксперимент «${name}» уже больше суток без ответственного. Кто его ведёт?`;
        await this.emit({
          tenantId: exp.tenantId,
          experimentId: exp.id,
          reason: 'experiment.no_owner',
          message,
          recipients,
          suggestedActions: ['Назначить ответственного', 'Перевести в paused'],
          priorityHint: 0.4,
        });
        emitted += 1;
      } catch (err) {
        this.logErr('experiment.no_owner', exp.id, err);
      }
    }
    return emitted;
  }

  /**
   * W2 autonomy — лестница владельца для `experiment.no_owner`.
   *
   * Прямое поле владельца — `Experiment.ownerEntityId` (Person.entityId, не
   * userId): авто-назначение возможно только когда у resolved-Person есть
   * entityId, иначе падаем в обычный probe. Кандидаты — subject-Person'ы
   * (`personSubjectIds`): люди, упомянутые в блоках эксперимента. admin'ов в
   * пул НЕ кладём — иначе в Org с одним admin'ом все бесхозные эксперименты
   * молча падали бы на него.
   */
  private async tryResolveOwner(
    exp: Experiment,
  ): Promise<
    | { outcome: 'auto' }
    | { outcome: 'ambiguous'; candidateNames: string[] }
    | { outcome: 'none' }
  > {
    if (!this.ownerResolver) return { outcome: 'none' };
    try {
      const subjects =
        exp.personSubjectIds.length > 0
          ? await this.prisma.person.findMany({
              where: {
                id: { in: exp.personSubjectIds },
                tenantId: exp.tenantId,
                deletedAt: null,
                userId: { not: null },
              },
              select: { id: true, name: true, userId: true, entityId: true },
              take: 20,
            })
          : [];
      const candidatePool = [
        ...new Set(subjects.map((p) => p.userId).filter((u): u is string => !!u)),
      ];
      const resolution = await this.ownerResolver.resolve({
        tenantId: exp.tenantId,
        candidatePool,
      });

      if (resolution.kind === 'resolved') {
        const person = subjects.find((p) => p.userId === resolution.userId);
        if (person?.entityId) {
          const updated = await this.prisma.experiment.updateMany({
            where: { id: exp.id, tenantId: exp.tenantId },
            data: { ownerEntityId: person.entityId },
          });
          if (updated.count > 0) {
            this.metrics.incOwnerResolution({ outcome: 'auto' });
            this.logger.log(
              `owner-resolver: Кора назначила ответственного за эксперимент «${exp.name.slice(0, 80)}» — ${person.name} (experimentId=${exp.id})`,
            );
            await this.publishAutoAssignFeed(exp, person.name);
            return { outcome: 'auto' };
          }
        }
        // entityId у Person нет / запись не обновилась — поле владельца не
        // мапится однозначно → НЕ автоназначаем, обычный probe.
        this.metrics.incOwnerResolution({ outcome: 'none' });
        return { outcome: 'none' };
      }
      if (resolution.kind === 'ambiguous') {
        this.metrics.incOwnerResolution({ outcome: 'ambiguous' });
        const names = subjects
          .filter((p) => p.userId && resolution.candidates.includes(p.userId))
          .map((p) => p.name)
          .filter((n) => n.length > 0);
        if (names.length >= 2) {
          return { outcome: 'ambiguous', candidateNames: names };
        }
        return { outcome: 'none' };
      }
      this.metrics.incOwnerResolution({ outcome: 'none' });
      return { outcome: 'none' };
    } catch (err) {
      this.logErr('experiment.no_owner.owner_resolver', exp.id, err);
      return { outcome: 'none' };
    }
  }

  /** Запись в ленту «что сделала Кора» — best-effort. */
  private async publishAutoAssignFeed(
    exp: Experiment,
    personName: string,
  ): Promise<void> {
    if (!this.activityFeed) return;
    try {
      await this.activityFeed.publish({
        tenantId: exp.tenantId,
        feedType: 'knowledge_change',
        sourceType: 'system',
        sourceAgentName: Specialist39ExperimentProbeService.SPECIALIST_NAME,
        relatedEntityType: 'experiment',
        relatedEntityId: exp.id,
        title: `Кора назначила ответственного за эксперимент «${exp.name.slice(0, 80)}»: ${personName}`,
        summary:
          'Ответственный выведен автоматически по «лестнице владельца» (единственный участник-кандидат эксперимента).',
        severity: 'normal',
        visibility: 'public_org',
      });
    } catch (err) {
      this.logger.warn(
        {
          experimentId: exp.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-9 probe: publish в ленту не удался — назначение уже применено',
      );
    }
  }

  /**
   * Trigger 2 — `experiment.running_too_long`. Запускается из
   * `experiment-status-resolver.cron`. running-эксперименты старше N дней
   * (env `EXPERIMENT_RUNNING_PROBE_THRESHOLD_DAYS`, default 30) без
   * `currentResult` → пинаем owner+admin.
   */
  async checkRunningTooLongForOrg(tenantId: string): Promise<number> {
    const thresholdDays = this.cfg.experiments.runningProbeThresholdDays;
    const cutoff = new Date(
      Date.now() - thresholdDays * 24 * 3600 * 1000,
    );
    const experiments = await this.prisma.experiment.findMany({
      where: {
        tenantId,
        status: 'running',
        currentResult: null,
        startedAt: { lt: cutoff },
      },
      take: Specialist39ExperimentProbeService.CRON_BATCH_LIMIT,
    });
    let emitted = 0;
    for (const exp of experiments) {
      try {
        const recipients = await this.findRecipientsWithOwner({
          tenantId: exp.tenantId,
          ownerEntityId: exp.ownerEntityId,
        });
        if (recipients.length === 0) continue;
        const name = exp.name.slice(0, 80);
        const message = `Эксперимент «${name}» бежит уже больше ${thresholdDays} дней без результата. Что-то пошло не так — может, закрыть?`;
        await this.emit({
          tenantId: exp.tenantId,
          experimentId: exp.id,
          reason: 'experiment.running_too_long',
          message,
          recipients,
          suggestedActions: [
            'Записать промежуточный результат',
            'Перевести в dropped',
            'Поставить на паузу',
          ],
          priorityHint: 0.6,
        });
        emitted += 1;
      } catch (err) {
        this.logErr('experiment.running_too_long', exp.id, err);
      }
    }
    return emitted;
  }

  // ─────────────────────── recipients resolution ──────────────────────

  private async findOrgAdminsUserIds(tenantId: string): Promise<string[]> {
    const memberships = await this.prisma.membership.findMany({
      where: {
        orgId: tenantId,
        role: { in: ['owner', 'admin'] },
      },
      select: { userId: true },
      take: 20,
    });
    return memberships.map((m) => m.userId);
  }

  /**
   * Список получателей с owner-Person (если есть). Используется для
   * `running_too_long`, чтобы пнуть в первую очередь самого ответственного.
   */
  private async findRecipientsWithOwner(args: {
    tenantId: string;
    ownerEntityId: string | null;
  }): Promise<string[]> {
    const admins = await this.findOrgAdminsUserIds(args.tenantId);
    if (!args.ownerEntityId) return admins;
    try {
      const owner = await this.prisma.person.findFirst({
        where: {
          entityId: args.ownerEntityId,
          tenantId: args.tenantId,
          deletedAt: null,
          userId: { not: null },
        },
        select: { userId: true },
      });
      if (owner?.userId && !admins.includes(owner.userId)) {
        return [owner.userId, ...admins];
      }
      return admins;
    } catch {
      return admins;
    }
  }

  // ─────────────────────── emit ──────────────────────────────────────

  private async emit(args: {
    tenantId: string;
    experimentId: string;
    reason: string;
    message: string;
    recipients: readonly string[];
    suggestedActions?: readonly string[];
    priorityHint: number;
  }): Promise<void> {
    const actionUrl = `/experiments/${args.experimentId}`;
    if (this.probeService) {
      try {
        await this.probeService.suggest({
          tenantId: args.tenantId,
          emittedByService: Specialist39ExperimentProbeService.SPECIALIST_NAME,
          reason: args.reason,
          payload: {
            message: args.message,
            suggestedActions: args.suggestedActions
              ? [...args.suggestedActions]
              : undefined,
            contextCardId: args.experimentId,
            contextCardKind: 'experiment',
            contextCardTitle: args.message.slice(0, 100),
            actionUrl,
            dataClass: 'internal',
          },
          recipientCandidates: [...args.recipients],
          priorityHint: args.priorityHint,
          dataClass: 'internal',
        });
        this.metrics.incCoreSpecialistProbeEvent({
          type: 'experiment',
          reason: args.reason,
        });
        return;
      } catch (err) {
        this.logger.warn(
          {
            experimentId: args.experimentId,
            reason: args.reason,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-9 probe: ProbeService.suggest упал — fallback',
        );
      }
    }
    // Fallback: прямой ConversationalService.sendNotification (best-effort).
    for (const userId of args.recipients) {
      try {
        await this.conversational.sendNotification({
          tenantId: args.tenantId,
          recipientUserId: userId,
          eventType: 'specialist.probe',
          payload: {
            specialistName:
              Specialist39ExperimentProbeService.SPECIALIST_NAME,
            reason: args.reason,
            message: args.message,
            cardId: args.experimentId,
            suggestedActions: args.suggestedActions
              ? [...args.suggestedActions]
              : undefined,
            actionUrl,
          },
          dataClass: 'internal',
          contextCardId: args.experimentId,
        });
        this.metrics.incCoreSpecialistProbeEvent({
          type: 'experiment',
          reason: args.reason,
        });
      } catch (err) {
        this.logger.warn(
          {
            experimentId: args.experimentId,
            reason: args.reason,
            userId,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-9 probe: ошибка sendNotification — пропускаю получателя',
        );
      }
    }
  }

  private logErr(reason: string, id: string, err: unknown): void {
    this.logger.warn(
      {
        resourceId: id,
        reason,
        err: err instanceof Error ? err.message : String(err),
      },
      'specialist-3-9 probe: внутренняя ошибка триггера — пропускаю',
    );
  }
}
