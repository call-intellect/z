import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { ProbeService } from '../../probe/probe.service';

import type {
  KnowledgeProfileDraft,
  SerializedKnowledgeProfile,
} from './specialist-3-2-knowledge-clone.service';

/**
 * SBA β-2 — Specialist32ProbeService.
 *
 * Эмиссия probe-events специалиста 3.2 (Knowledge Clone) согласно §6 sub-TZ:
 *   - `knowledge.new_expertise_detected` — в новом профиле появилась новая
 *     категория с confidence='high', которой не было в старом.
 *   - `knowledge.contradiction_detected` — между старым и новым профилем
 *     обнаружено явное противоречие («X не знает Y» vs «X знает Y» в
 *     одной категории).
 *
 * Получатели:
 *   - direct manager Person'а (через `Person.primaryDepartmentId →
 *     Department.headPersonId → Person.userId`);
 *   - fallback: owner/admin Org.
 *
 * Контракт: сервис НЕ должен бросать. Один упавший probe не валит остальные.
 */
@Injectable()
export class Specialist32ProbeService {
  private readonly logger = new Logger(Specialist32ProbeService.name);

  static readonly SPECIALIST_NAME = '3-2-knowledge-clone';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Optional() @Inject(ProbeService)
    private readonly probeService?: ProbeService,
  ) {}

  /**
   * Главный метод: проверяет два trigger'а (new_expertise_detected /
   * contradiction_detected) и отправляет нотификации.
   *
   * `oldProfile` — то, что было ДО rebuild'а (null, если профиль создан
   * впервые). `newProfile` — то, что только что записали (или предложили
   * через CurationItem — но probe одинаков).
   */
  async checkAndEmitProbes(args: {
    tenantId: string;
    personId: string;
    personName: string;
    oldProfile: KnowledgeProfileDraft | null;
    newProfile: SerializedKnowledgeProfile;
  }): Promise<void> {
    try {
      await this.checkNewExpertise(args);
    } catch (err) {
      this.logProbeError('knowledge.new_expertise_detected', args.personId, err);
    }
    try {
      await this.checkContradiction(args);
    } catch (err) {
      this.logProbeError('knowledge.contradiction_detected', args.personId, err);
    }
  }

  // ──────────────────────── triggers ────────────────────────

  private async checkNewExpertise(args: {
    tenantId: string;
    personId: string;
    personName: string;
    oldProfile: KnowledgeProfileDraft | null;
    newProfile: SerializedKnowledgeProfile;
  }): Promise<void> {
    const oldNames = new Set(
      (args.oldProfile?.categories ?? []).map((c) =>
        c.name.trim().toLowerCase(),
      ),
    );
    const newHighCategories = args.newProfile.categories.filter(
      (c) =>
        c.confidence === 'high' &&
        !oldNames.has(c.name.trim().toLowerCase()),
    );
    if (newHighCategories.length === 0) return;

    const recipients = await this.findRecipients(args.tenantId, args.personId);
    if (recipients.length === 0) return;

    const categoryNames = newHighCategories
      .slice(0, 3)
      .map((c) => `«${c.name}»`)
      .join(', ');
    const message = `У ${args.personName} обнаружены новые области экспертизы: ${categoryNames}. Подтвердить?`;

    await this.emit({
      tenantId: args.tenantId,
      personId: args.personId,
      reason: 'knowledge.new_expertise_detected',
      message,
      recipients,
      suggestedActions: ['Подтвердить', 'Пометить как неверное'],
    });
  }

  private async checkContradiction(args: {
    tenantId: string;
    personId: string;
    personName: string;
    oldProfile: KnowledgeProfileDraft | null;
    newProfile: SerializedKnowledgeProfile;
  }): Promise<void> {
    if (!args.oldProfile || args.oldProfile.categories.length === 0) return;
    const contradictions = findContradictions(args.oldProfile, args.newProfile);
    if (contradictions.length === 0) return;

    const recipients = await this.findRecipients(args.tenantId, args.personId);
    if (recipients.length === 0) return;

    const sample = contradictions[0];
    if (!sample) return;
    const message = `По ${args.personName} в области «${sample.category}» появилось противоречие с тем, что мы знали раньше. Уточнить?`;

    await this.emit({
      tenantId: args.tenantId,
      personId: args.personId,
      reason: 'knowledge.contradiction_detected',
      message,
      recipients,
      suggestedActions: ['Открыть профиль', 'Пометить как неверное'],
    });
  }

  // ──────────────────────── helpers ────────────────────────

  private async emit(args: {
    tenantId: string;
    personId: string;
    reason: string;
    message: string;
    recipients: readonly string[];
    suggestedActions?: readonly string[];
  }): Promise<void> {
    const actionUrl = `/persons/${args.personId}?tab=knowledge-profile`;
    // SBA β-5 — миграция: через ProbeService (дедуп / rate-limit / dispatch).
    if (this.probeService) {
      try {
        await this.probeService.suggest({
          tenantId: args.tenantId,
          emittedByService: Specialist32ProbeService.SPECIALIST_NAME,
          reason: args.reason,
          payload: {
            message: args.message,
            suggestedActions: args.suggestedActions
              ? [...args.suggestedActions]
              : undefined,
            contextCardId: args.personId,
            contextCardKind: 'knowledge_profile',
            contextCardTitle: args.message.slice(0, 100),
            actionUrl,
            dataClass: 'internal',
          },
          recipientCandidates: [...args.recipients],
          priorityHint: 0.4,
          dataClass: 'internal',
        });
        this.metrics.incCoreSpecialistProbeEvent({
          type: 'knowledge_profile',
          reason: args.reason,
        });
        return;
      } catch (err) {
        this.logger.warn(
          {
            personId: args.personId,
            reason: args.reason,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-2 probe: ProbeService.suggest упал — fallback',
        );
      }
    }
    // Fallback на legacy sendNotification.
    for (const userId of args.recipients) {
      try {
        await this.conversational.sendNotification({
          tenantId: args.tenantId,
          recipientUserId: userId,
          eventType: 'specialist.probe',
          payload: {
            specialistName: Specialist32ProbeService.SPECIALIST_NAME,
            reason: args.reason,
            message: args.message,
            personId: args.personId,
            suggestedActions: args.suggestedActions
              ? [...args.suggestedActions]
              : undefined,
            actionUrl,
          },
          dataClass: 'internal',
        });
        this.metrics.incCoreSpecialistProbeEvent({
          type: 'knowledge_profile',
          reason: args.reason,
        });
      } catch (err) {
        this.logger.warn(
          {
            personId: args.personId,
            reason: args.reason,
            userId,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-2 probe: ошибка sendNotification — пропускаю получателя',
        );
      }
    }
  }

  /**
   * Получатели probe-events: owner/admin Org.
   *
   * NB: концепция «direct manager» (через `Department.headPersonId` или
   * аналогичное поле) в текущей модели не реализована — на β-2 шлём
   * только admin'ам Org. Когда появится поле "руководитель отдела"
   * (или Department.headPersonId), сюда добавится первичный кандидат.
   */
  private async findRecipients(
    tenantId: string,
    personId: string,
  ): Promise<string[]> {
    const person = await this.prisma.person.findUnique({
      where: { id: personId },
      select: { userId: true },
    });

    const recipients = new Set<string>();
    const admins = await this.prisma.membership.findMany({
      where: {
        orgId: tenantId,
        role: { in: ['owner', 'admin'] },
      },
      select: { userId: true },
      take: 20,
    });
    for (const a of admins) {
      if (a.userId && a.userId !== person?.userId) recipients.add(a.userId);
    }
    return [...recipients];
  }

  private logProbeError(reason: string, personId: string, err: unknown): void {
    this.logger.warn(
      {
        personId,
        reason,
        err: err instanceof Error ? err.message : String(err),
      },
      'specialist-3-2 probe: внутренняя ошибка триггера — пропускаю',
    );
  }
}

interface ProbeContradiction {
  category: string;
  oldStatement: string;
  newStatement: string;
}

function findContradictions(
  oldProfile: KnowledgeProfileDraft,
  newProfile: SerializedKnowledgeProfile,
): ProbeContradiction[] {
  const out: ProbeContradiction[] = [];
  for (const newCat of newProfile.categories) {
    const oldCat = oldProfile.categories.find(
      (c) =>
        c.name.trim().toLowerCase() === newCat.name.trim().toLowerCase(),
    );
    if (!oldCat) continue;
    for (const oldStmt of oldCat.sampleStatements) {
      const oldNeg = isNegative(oldStmt.quote);
      for (const newStmt of newCat.sampleStatements) {
        const newNeg = isNegative(newStmt.quote);
        if (oldNeg !== newNeg) {
          out.push({
            category: newCat.name,
            oldStatement: oldStmt.quote,
            newStatement: newStmt.quote,
          });
          break;
        }
      }
    }
  }
  return out;
}

function isNegative(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    /^не\s/i.test(t) ||
    t.includes(' не знает') ||
    t.includes(' не умеет') ||
    t.includes(' не разбирается')
  );
}
