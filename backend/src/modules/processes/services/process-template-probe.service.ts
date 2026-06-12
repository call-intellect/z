import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Prisma, ProcessTemplate } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { OwnerResolverService } from '../../knowledge-core/services/owner-resolver.service';
import { ProbeService } from '../../probe/probe.service';
import type { ProcessTemplateDefinitionDto } from '../dto/processes.dto';

/**
 * SBA α-7 wave 2 — ProcessTemplateProbeService.
 *
 * Эмиссия probe-events для ProcessTemplate согласно §2 sub-TZ:
 *   - `process_template.missing_input_artifact` — у >=1 шага нет inputArtifact AND
 *     step != первый (первый шаг может быть «триггерным» событием).
 *   - `process_template.missing_output_artifact` — у >=1 шага нет outputArtifact.
 *   - `process_template.step_without_owner` — у >=1 шага нет ownerRoleId.
 *
 * Получатели:
 *   - ownerPersonId.userId, если есть;
 *   - admin'ы Org (для notice / коррекции).
 *
 * Контракт: сервис НЕ должен бросать. Один упавший probe не валит остальные —
 * лог и продолжение.
 */
@Injectable()
export class ProcessTemplateProbeService {
  private readonly logger = new Logger(ProcessTemplateProbeService.name);
  static readonly EMITTED_BY = '3-1-process-detector';
  private static readonly TYPE = 'process_template';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Optional() @Inject(ProbeService)
    private readonly probeService?: ProbeService,
    // W2 autonomy (2026-06-12) — адресация step_without_owner: владелец
    // шаблона / держатели роли-владельца. Optional: без него прежнее поведение.
    @Optional() @Inject(OwnerResolverService)
    private readonly ownerResolver?: OwnerResolverService,
  ) {}

  /**
   * Полный проход триггеров. Загружает текущий definition (через
   * currentVersionId) и эмитит applicable probe-events.
   */
  async checkAndEmit(template: ProcessTemplate): Promise<void> {
    if (template.status === 'archived') return;
    try {
      const def = await this.loadDefinition(template);
      if (!def || def.steps.length === 0) {
        // Нет шагов — probe-trigger «step_without_owner» бессмыслен, выходим.
        return;
      }
      const stepsMissingInput = def.steps.filter(
        (s, idx) => idx > 0 && !s.inputArtifact,
      );
      const stepsMissingOutput = def.steps.filter((s) => !s.outputArtifact);
      const stepsWithoutOwner = def.steps.filter((s) => !s.ownerRoleId);

      const recipients = await this.resolveRecipients(template);
      if (recipients.length === 0) return;

      if (stepsMissingInput.length > 0) {
        await this.emit({
          template,
          reason: 'process_template.missing_input_artifact',
          message: `В процессе «${template.name}» у ${stepsMissingInput.length} шага(ов) не указан входной артефакт. Уточнить?`,
          recipients,
          suggestedActions: ['Заполнить входы', 'Открыть шаблон'],
        });
      }
      if (stepsMissingOutput.length > 0) {
        await this.emit({
          template,
          reason: 'process_template.missing_output_artifact',
          message: `В процессе «${template.name}» у ${stepsMissingOutput.length} шага(ов) не указан выход (результат). Уточнить?`,
          recipients,
          suggestedActions: ['Заполнить выходы', 'Открыть шаблон'],
        });
      }
      if (stepsWithoutOwner.length > 0) {
        // W2 autonomy (2026-06-12): АВТО-запись в definitionJson ЗАПРЕЩЕНА —
        // probe-выбор кандидатов остаётся. Меняем только адресата и текст:
        // владелец шаблона получает вопрос лично; роль-владелец с несколькими
        // держателями — вопрос-выбор с именами (Р2.2), не «Назначить?».
        const target = await this.stepOwnerProbeTarget(template, recipients);
        await this.emit({
          template,
          reason: 'process_template.step_without_owner',
          message:
            target.message ??
            `В процессе «${template.name}» у ${stepsWithoutOwner.length} шага(ов) не назначен ответственный. Назначить?`,
          recipients: target.recipients,
          suggestedActions: ['Назначить ответственных', 'Открыть шаблон'],
        });
      }
    } catch (err) {
      this.logger.warn(
        {
          templateId: template.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'process-template probe: внутренняя ошибка — пропускаю',
      );
    }
  }

  // ─────────────────────────── internals ──────────────────────────────

  private async emit(args: {
    template: ProcessTemplate;
    reason: string;
    message: string;
    recipients: readonly string[];
    suggestedActions: readonly string[];
  }): Promise<void> {
    const actionUrl = `/processes/${args.template.id}`;
    if (this.probeService) {
      try {
        await this.probeService.suggest({
          tenantId: args.template.tenantId,
          emittedByService: ProcessTemplateProbeService.EMITTED_BY,
          reason: args.reason,
          payload: {
            message: args.message,
            suggestedActions: [...args.suggestedActions],
            contextCardId: args.template.id,
            contextCardKind: 'process_template',
            contextCardTitle: args.template.name,
            actionUrl,
            dataClass: 'internal',
          },
          recipientCandidates: [...args.recipients],
          priorityHint: 0.4,
          dataClass: 'internal',
        });
        this.metrics.incCoreSpecialistProbeEvent({
          type: ProcessTemplateProbeService.TYPE,
          reason: args.reason,
        });
        return;
      } catch (err) {
        this.logger.warn(
          {
            templateId: args.template.id,
            reason: args.reason,
            err: err instanceof Error ? err.message : String(err),
          },
          'process-template probe: ProbeService.suggest упал — fallback на sendNotification',
        );
      }
    }
    for (const userId of args.recipients) {
      try {
        await this.conversational.sendNotification({
          tenantId: args.template.tenantId,
          recipientUserId: userId,
          eventType: 'specialist.probe',
          payload: {
            specialistName: ProcessTemplateProbeService.EMITTED_BY,
            reason: args.reason,
            message: args.message,
            cardId: args.template.id,
            suggestedActions: [...args.suggestedActions],
            actionUrl,
          },
          dataClass: 'internal',
          contextCardId: args.template.id,
        });
        this.metrics.incCoreSpecialistProbeEvent({
          type: ProcessTemplateProbeService.TYPE,
          reason: args.reason,
        });
      } catch (err) {
        this.logger.warn(
          {
            templateId: args.template.id,
            reason: args.reason,
            userId,
            err: err instanceof Error ? err.message : String(err),
          },
          'process-template probe: ошибка sendNotification — пропускаю получателя',
        );
      }
    }
  }

  /**
   * W2 autonomy — адресат/текст probe `step_without_owner`:
   *   1. У шаблона есть ownerPersonId → вопрос адресуем лично владельцу
   *      шаблона (он отвечает за шаги), не всем admin'ам.
   *   2. Иначе ownerRoleId: единственный держатель → ему лично; несколько →
   *      вопрос-выбор с именами (Р2.2: «Иванов или Петров?»).
   *   3. Иначе — прежние получатели и прежний текст.
   */
  private async stepOwnerProbeTarget(
    template: ProcessTemplate,
    fallbackRecipients: readonly string[],
  ): Promise<{ recipients: string[]; message?: string }> {
    try {
      if (template.ownerPersonId) {
        const person = await this.prisma.person.findFirst({
          where: {
            id: template.ownerPersonId,
            tenantId: template.tenantId,
          },
          select: { userId: true },
        });
        if (person?.userId) {
          return { recipients: [person.userId] };
        }
        return { recipients: [...fallbackRecipients] };
      }
      if (template.ownerRoleId && this.ownerResolver) {
        const resolution = await this.ownerResolver.resolve({
          tenantId: template.tenantId,
          roleId: template.ownerRoleId,
        });
        if (resolution.kind === 'resolved') {
          return { recipients: [resolution.userId] };
        }
        if (resolution.kind === 'ambiguous') {
          const persons = await this.prisma.person.findMany({
            where: {
              tenantId: template.tenantId,
              userId: { in: resolution.candidates },
              deletedAt: null,
            },
            select: { name: true },
            take: 10,
          });
          const names = persons.map((p) => p.name).filter((n) => n.length > 0);
          if (names.length >= 2) {
            return {
              recipients: [...fallbackRecipients],
              message: `В процессе «${template.name}» есть шаги без ответственного. Кого назначить ответственным: ${names.join(' или ')}?`,
            };
          }
        }
      }
    } catch (err) {
      this.logger.warn(
        {
          templateId: template.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'process-template probe: stepOwnerProbeTarget упал — прежние получатели',
      );
    }
    return { recipients: [...fallbackRecipients] };
  }

  private async resolveRecipients(
    template: ProcessTemplate,
  ): Promise<string[]> {
    const ids = new Set<string>();
    if (template.ownerPersonId) {
      const person = await this.prisma.person.findUnique({
        where: { id: template.ownerPersonId },
        select: { userId: true },
      });
      if (person?.userId) ids.add(person.userId);
    }
    const admins = await this.prisma.membership.findMany({
      where: { orgId: template.tenantId, role: { in: ['owner', 'admin'] } },
      select: { userId: true },
      take: 20,
    });
    for (const a of admins) ids.add(a.userId);
    return [...ids];
  }

  private async loadDefinition(
    template: ProcessTemplate,
  ): Promise<ProcessTemplateDefinitionDto | null> {
    if (!template.currentVersionId) return null;
    const version = await this.prisma.processTemplateVersion.findUnique({
      where: { id: template.currentVersionId },
      select: { definitionJson: true },
    });
    if (!version) return null;
    return this.safeDefinition(version.definitionJson);
  }

  private safeDefinition(
    value: Prisma.JsonValue,
  ): ProcessTemplateDefinitionDto | null {
    if (!value || typeof value !== 'object') return null;
    const rec = value as Record<string, unknown>;
    const steps = Array.isArray(rec.steps)
      ? (rec.steps as ProcessTemplateDefinitionDto['steps'])
      : [];
    return {
      steps,
      handoffsInline: [],
      decisionPointsInline: [],
    };
  }
}
