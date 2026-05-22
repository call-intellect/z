import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  type LlmCallResult,
  LlmRouterService,
} from '../../ai/services/llm-router.service';
import { ConversationalService } from '../../conversational/conversational.service';
import {
  IDEA_STATUS_SUMMARIZE_JSON_SCHEMA,
  IDEA_STATUS_SUMMARIZE_SCHEMA_NAME,
  IDEA_STATUS_SUMMARIZE_SYSTEM_PROMPT,
  IDEA_STATUS_SUMMARIZE_USER_TEMPLATE,
} from '../prompts/idea-status-summarize.prompt';

interface IdeaStatusChangedEvent {
  tenantId: string;
  ideaId: string;
  oldStatus: string;
  newStatus: string;
  reason: string | null;
  changedByUserId: string;
}

interface IdeaSupporter {
  kind: 'person' | 'customer';
  entityId: string;
}

/**
 * SBA β-5 — IdeasClosingLoopHandler.
 *
 * Слушает `idea.status_changed` (эмитит Specialist36Service.changeStatus).
 * Для каждого supporter'а:
 *   - kind='person' → User.id через Person.userId → sendNotification
 *     (eventType='idea.status_changed').
 *   - kind='customer' → admin/owner Org как fallback (см. sub-ТЗ §14.2).
 *
 * LLM `idea-status-summarize` формирует {title, body}; fallback — статический
 * текст «Статус идеи изменён».
 */
@Injectable()
export class IdeasClosingLoopHandler {
  private readonly logger = new Logger(IdeasClosingLoopHandler.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @OnEvent('idea.status_changed')
  async handle(event: IdeaStatusChangedEvent): Promise<void> {
    try {
      const idea = await this.prisma.idea.findFirst({
        where: { id: event.ideaId, tenantId: event.tenantId },
      });
      if (!idea) return;
      const supporters = this.parseSupporters(idea.supporters);

      // LLM summarize (best-effort, fallback на статический текст).
      const summary = await this.summarize({
        statement: idea.statement,
        oldStatus: event.oldStatus,
        newStatus: event.newStatus,
        reason: event.reason,
        tenantId: event.tenantId,
        ideaId: idea.id,
        dataClass: idea.dataClass,
      });

      const recipients = new Set<string>();
      for (const supporter of supporters) {
        if (supporter.kind === 'person') {
          const person = await this.prisma.person.findFirst({
            where: {
              tenantId: event.tenantId,
              entityId: supporter.entityId,
              deletedAt: null,
            },
            select: { userId: true },
          });
          if (person?.userId) recipients.add(person.userId);
        } else {
          // customer — fallback на admin Org (Customer.responsibleUserId
          // отсутствует в Z; см. §14.2).
          const admins = await this.prisma.membership.findMany({
            where: {
              orgId: event.tenantId,
              role: { in: ['owner', 'admin'] },
            },
            select: { userId: true },
            take: 5,
          });
          for (const a of admins) recipients.add(a.userId);
        }
      }

      // Также — сам автор должен узнать (если есть createdByUserId).
      if (idea.createdByUserId) recipients.add(idea.createdByUserId);

      for (const userId of recipients) {
        try {
          await this.conversational.sendNotification({
            tenantId: event.tenantId,
            recipientUserId: userId,
            eventType: 'idea.status_changed',
            payload: {
              ideaId: idea.id,
              statement: idea.statement,
              oldStatus: event.oldStatus,
              newStatus: event.newStatus,
              reason: event.reason,
              title: summary.title,
              body: summary.body,
              actionUrl: `/ideas/${idea.id}`,
            },
            dataClass: idea.dataClass,
            contextCardId: idea.id,
          });
          this.metrics.incIdeaStatusChangeNotification({
            newStatus: event.newStatus,
          });
        } catch (err) {
          this.logger.warn(
            {
              ideaId: idea.id,
              userId,
              err: err instanceof Error ? err.message : String(err),
            },
            'ideas-closing-loop: sendNotification failed for user',
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        {
          ideaId: event.ideaId,
          err: err instanceof Error ? err.message : String(err),
        },
        'ideas-closing-loop: внутренняя ошибка — пропускаю',
      );
    }
  }

  private async summarize(args: {
    tenantId: string;
    ideaId: string;
    statement: string;
    oldStatus: string;
    newStatus: string;
    reason: string | null;
    dataClass: 'public' | 'internal' | 'sensitive' | 'private';
  }): Promise<{ title: string; body: string }> {
    const fallback = {
      title: `Статус идеи: ${args.newStatus}`,
      body: `Идея «${args.statement.slice(0, 200)}» переведена в статус ${args.newStatus}.${args.reason ? ` Причина: ${args.reason}.` : ''}`,
    };
    try {
      const result: LlmCallResult = await this.llm.call({
        taskType: 'idea-status-summarize',
        systemPrompt: IDEA_STATUS_SUMMARIZE_SYSTEM_PROMPT,
        userMessage: IDEA_STATUS_SUMMARIZE_USER_TEMPLATE({
          ideaStatement: args.statement,
          oldStatus: args.oldStatus,
          newStatus: args.newStatus,
          reason: args.reason,
        }),
        tenantId: args.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: IDEA_STATUS_SUMMARIZE_SCHEMA_NAME,
          schema: IDEA_STATUS_SUMMARIZE_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'idea', id: args.ideaId },
        dataClass: args.dataClass,
      });
      const parsed = JSON.parse(result.text) as {
        title?: string;
        body?: string;
      };
      if (parsed?.title && parsed?.body) {
        return {
          title: String(parsed.title).slice(0, 200),
          body: String(parsed.body).slice(0, 1_000),
        };
      }
      return fallback;
    } catch {
      return fallback;
    }
  }

  private parseSupporters(payload: Prisma.JsonValue): IdeaSupporter[] {
    if (!Array.isArray(payload)) return [];
    const arr = payload as Array<Prisma.JsonValue>;
    const result: IdeaSupporter[] = [];
    for (const item of arr) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        continue;
      }
      const s = item as Record<string, Prisma.JsonValue>;
      const kindRaw = typeof s.kind === 'string' ? s.kind : 'person';
      const kind: IdeaSupporter['kind'] =
        kindRaw === 'customer' ? 'customer' : 'person';
      const entityId = typeof s.entityId === 'string' ? s.entityId : '';
      if (entityId.length === 0) continue;
      result.push({ kind, entityId });
    }
    return result;
  }
}
