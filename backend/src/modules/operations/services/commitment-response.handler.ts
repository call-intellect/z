import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

interface ExtractedStatus {
  status: 'fulfilled' | 'missed';
  rationale: string;
  blockerText?: string | null;
}

@Injectable()
export class CommitmentResponseHandler {
  private readonly logger = new Logger(CommitmentResponseHandler.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly config: TypedConfigService | null = null,
  ) {}

  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.config?.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  @OnEvent('notification.responded')
  async handle(event: {
    tenantId: string;
    notificationId: string;
    recipientUserId: string;
    eventType: string;
    payload: Record<string, unknown>;
    contextBlockId?: string | null;
  }): Promise<void> {
    try {
      if (event.eventType !== 'probe.question') return;

      const notif = await this.prisma.notification.findUnique({
        where: { id: event.notificationId },
        select: {
          payload: true,
          recipientUserId: true,
          tenantId: true,
        },
      });
      if (!notif) return;
      const origPayload = (notif.payload as Record<string, unknown> | null) ?? {};
      const meta = origPayload.metaJson as Record<string, unknown> | undefined;
      const reason =
        (typeof origPayload.reason === 'string' && origPayload.reason) ||
        (meta && typeof meta.reason === 'string' && meta.reason) ||
        null;
      if (reason !== 'commitment.followup') return;

      const contextBlockId =
        (event.contextBlockId ??
          (typeof origPayload.contextBlockId === 'string'
            ? (origPayload.contextBlockId as string)
            : null)) ||
        null;
      if (!contextBlockId) {
        this.metrics?.incCommitmentsExtractFailed({
          tenantTop: resolveOperationsTenantTop(event.tenantId),
          reason: 'no_block',
        });
        return;
      }

      const rawText =
        typeof event.payload?.text === 'string'
          ? (event.payload.text as string)
          : typeof event.payload?.answer === 'string'
            ? (event.payload.answer as string)
            : '';
      if (rawText.trim().length === 0) return;

      const original = await this.prisma.ideaBlock.findUnique({
        where: { id: contextBlockId },
        select: {
          id: true,
          tenantId: true,
          signalType: true,
          commitmentStatus: true,
          dataClass: true,
          criticalQuestion: true,
          trustedAnswer: true,
        },
      });
      if (!original || original.signalType !== 'commitment') {
        this.metrics?.incCommitmentsExtractFailed({
          tenantTop: resolveOperationsTenantTop(event.tenantId),
          reason: 'no_block',
        });
        return;
      }
      if (
        original.commitmentStatus &&
        ['fulfilled', 'missed', 'cancelled', 'superseded'].includes(original.commitmentStatus)
      ) {
        return;
      }

      const parsed = await this.extractStatus({
        tenantId: event.tenantId,
        rawText,
        criticalQuestion: original.criticalQuestion,
        trustedAnswer: original.trustedAnswer,
      });
      if (!parsed) {
        return;
      }

      const tenantTop = resolveOperationsTenantTop(event.tenantId);
      await this.prisma.$transaction(async (tx) => {
        const statusBlock = await tx.ideaBlock.create({
          data: {
            tenantId: original.tenantId,
            name: `Статус обещания: ${truncate(original.criticalQuestion, 100)}`,
            criticalQuestion: 'Какой статус ранее данного обещания?',
            trustedAnswer:
              `${parsed.status === 'fulfilled' ? 'Выполнено' : 'Не выполнено'}. ${parsed.rationale}`.slice(
                0,
                4_000,
              ),
            tags: ['commitment_status'],
            signalType: 'commitment_status',
            confidence: new Prisma.Decimal('0.700'),
            dataClass: original.dataClass,
            status: 'draft',
            evidenceCount: 0,
            commitmentStatus: parsed.status,
          },
        });
        await tx.ideaBlockLink
          .create({
            data: {
              tenantId: original.tenantId,
              fromBlockId: statusBlock.id,
              toBlockId: original.id,
              relationType: 'resolves',
              confidence: new Prisma.Decimal('0.900'),
              explanation: 'Ответ сотрудника на followup-probe Хранителя обещаний.',
              createdBy: 'linker',
              status: 'active',
            },
          })
          .catch((err) => {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
              return;
            }
            throw err;
          });
        await tx.ideaBlock.update({
          where: { id: original.id },
          data: {
            commitmentStatus: parsed.status,
          },
        });

        if (parsed.status === 'missed' && parsed.blockerText) {
          await tx.ideaBlock.create({
            data: {
              tenantId: original.tenantId,
              name: `Блокер по обещанию: ${truncate(original.criticalQuestion, 100)}`,
              criticalQuestion: 'Что мешает закрыть обещание?',
              trustedAnswer: parsed.blockerText.slice(0, 4_000),
              tags: ['blocker', 'from-commitment'],
              signalType: 'blocker',
              confidence: new Prisma.Decimal('0.600'),
              dataClass: original.dataClass,
              status: 'draft',
              evidenceCount: 0,
            },
          });
        }
      });

      if (parsed.status === 'fulfilled') {
        this.metrics?.incCommitmentsFulfilled({ tenantTop });
      } else {
        this.metrics?.incCommitmentsMissed({ tenantTop });
      }
      this.logger.log(
        {
          tenantId: event.tenantId,
          blockId: original.id,
          status: parsed.status,
        },
        'CommitmentResponseHandler: статус обещания обновлён',
      );
    } catch (err) {
      this.metrics?.incCommitmentsExtractFailed({
        tenantTop: resolveOperationsTenantTop(event.tenantId),
        reason: 'exception',
      });
      this.logger.warn(
        {
          notificationId: event.notificationId,
          err: err instanceof Error ? err.message : String(err),
        },
        'CommitmentResponseHandler: внутренняя ошибка — пропускаю',
      );
    }
  }

  private async extractStatus(args: {
    tenantId: string;
    rawText: string;
    criticalQuestion: string;
    trustedAnswer: string;
  }): Promise<ExtractedStatus | null> {
    const systemPrompt = [
      'Ты — анализатор ответа сотрудника на followup-вопрос о ранее данном обещании.',
      'На вход — текст исходного обещания и свободный ответ сотрудника.',
      'На выход — строгий JSON: { "status": "fulfilled" | "missed", "rationale": "коротко почему", "blockerText": "что мешает (только для missed)" | null }.',
      'status="fulfilled" — если из ответа ясно «сделано», «выполнил», «закрыл», «готово».',
      'status="missed" — если «не сделал», «не успел», «отложил», «забыл», «блокер», или невнятный отказ.',
      'rationale — 1 предложение на русском, цитата из ответа.',
      'blockerText — короткое описание блокера если упомянут; null если не упомянут или status=fulfilled.',
      'Никакого комментария вне JSON.',
    ].join('\n');

    const rawUserMessage = [
      `Исходное обещание: ${args.criticalQuestion}`,
      `Текст обещания: ${args.trustedAnswer.slice(0, 500)}`,
      'Ответ сотрудника:',
      args.rawText.slice(0, 2_000),
    ].join('\n');

    const guardOn = this.isPromptInjectionGuardEnabled();
    const guardedSystem = guardOn ? withInjectionGuard(systemPrompt) : systemPrompt;
    const userMessage = guardOn ? wrapUserData(rawUserMessage) : rawUserMessage;

    let text: string;
    try {
      const res = await this.llm.call({
        taskType: 'commitment-extract-status',
        tenantId: args.tenantId,
        systemPrompt: guardedSystem,
        userMessage,
        responseFormat: { type: 'json_object' },
        maxTokens: 500,
        sourceRef: { type: 'commitment-status', id: 'extract' },
      });
      text = res.text;
    } catch (err) {
      this.metrics?.incCommitmentsExtractFailed({
        tenantTop: resolveOperationsTenantTop(args.tenantId),
        reason: 'llm_failed',
      });
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'CommitmentResponseHandler.extractStatus: LLM упал',
      );
      return null;
    }

    return this.parseExtractedJson(text, args.tenantId);
  }

  private parseExtractedJson(text: string, tenantId: string): ExtractedStatus | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) {
        this.metrics?.incCommitmentsExtractFailed({
          tenantTop: resolveOperationsTenantTop(tenantId),
          reason: 'parse_failed',
        });
        return null;
      }
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        this.metrics?.incCommitmentsExtractFailed({
          tenantTop: resolveOperationsTenantTop(tenantId),
          reason: 'parse_failed',
        });
        return null;
      }
    }
    if (!parsed || typeof parsed !== 'object') {
      this.metrics?.incCommitmentsExtractFailed({
        tenantTop: resolveOperationsTenantTop(tenantId),
        reason: 'parse_failed',
      });
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    const status = obj.status === 'fulfilled' || obj.status === 'missed' ? obj.status : null;
    if (!status) {
      this.metrics?.incCommitmentsExtractFailed({
        tenantTop: resolveOperationsTenantTop(tenantId),
        reason: 'parse_failed',
      });
      return null;
    }
    const rationale =
      typeof obj.rationale === 'string' && obj.rationale.length > 0
        ? obj.rationale.slice(0, 500)
        : '';
    const blockerText =
      status === 'missed' && typeof obj.blockerText === 'string'
        ? obj.blockerText.slice(0, 2_000)
        : null;
    return { status, rationale, blockerText };
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}
