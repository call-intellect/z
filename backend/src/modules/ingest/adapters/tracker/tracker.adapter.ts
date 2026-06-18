import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { SignalType, Source } from '@prisma/client';

import { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { IngestService } from '../../ingest.service';

interface TrackerEventPayloadShape {
  type:
    | 'issue.created'
    | 'issue.status_changed'
    | 'issue.status_changed_to_blocked'
    | 'issue.status_changed_to_done'
    | 'issue.overdue_detected'
    | 'issue.assignee_changed'
    | 'comment.created'
    | 'mention.created';
  tenantId: string;
  occurredAt: string;
  issue: {
    id: string;
    identifier: string;
    title: string;
    description?: string | null;
    projectId: string;
    stateId?: string | null;
    dueDate?: string | null;
  };
  actor: {
    userId: string | null;
    actorType: 'user' | 'ai_agent' | 'system';
  };
  meta?: Record<string, unknown>;
}

interface ProjectDocumentEventPayload {
  type: 'project_document.changed';
  tenantId: string;
  projectId: string;
  documentId: string;
  title: string;
  fullText: string | null;
  actor: {
    userId: string | null;
    actorType: 'user' | 'ai_agent' | 'system';
  };
  occurredAt: string;
  changeType: 'created' | 'updated';
}

const SIGNAL_TYPE_MAP: Record<TrackerEventPayloadShape['type'], SignalType> = {
  'issue.created': 'task_created',
  'issue.status_changed': 'task_status_changed',
  'issue.status_changed_to_blocked': 'task_blocked',
  'issue.status_changed_to_done': 'task_completed',
  'issue.overdue_detected': 'task_overdue',
  'issue.assignee_changed': 'task_reassigned',
  'comment.created': 'task_comment',
  'mention.created': 'task_mention',
};

@Injectable()
export class TrackerAdapter {
  private readonly logger = new Logger(TrackerAdapter.name);

  static readonly DEFAULT_SOURCE_NAME = 'Трекер';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IngestService) private readonly ingest: IngestService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @OnEvent('tracker.event_occurred', { async: true })
  async handleTrackerEvent(payload: TrackerEventPayloadShape): Promise<void> {
    try {
      await this.processEvent(payload);
    } catch (err) {
      this.logger.warn(
        {
          type: payload?.type,
          issueId: payload?.issue?.id,
          tenantId: payload?.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'tracker-adapter: ingest упал — событие пропущено',
      );
    }
  }

  @OnEvent('tracker.project_document_changed', { async: true })
  async handleProjectDocumentEvent(payload: ProjectDocumentEventPayload): Promise<void> {
    try {
      await this.processProjectDocumentEvent(payload);
    } catch (err) {
      this.logger.warn(
        {
          documentId: payload?.documentId,
          projectId: payload?.projectId,
          tenantId: payload?.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'tracker-adapter: project-document ingest упал — событие пропущено',
      );
    }
  }

  private async processProjectDocumentEvent(payload: ProjectDocumentEventPayload): Promise<void> {
    if (!payload || typeof payload !== 'object') {
      this.logger.warn('tracker-adapter: пустой project-document payload — skip');
      return;
    }
    if (!payload.tenantId || !payload.documentId) {
      this.logger.warn(
        { type: payload.type },
        'tracker-adapter: project-document payload без tenantId/documentId — skip',
      );
      return;
    }
    const occurredAt = this.parseOccurredAt(payload.occurredAt);
    const source = await this.upsertDefaultTrackerSource(payload.tenantId);

    const sourceExternalId = [
      'tracker',
      'project-document',
      payload.documentId,
      payload.changeType,
      occurredAt.toISOString(),
    ].join(':');

    const rawEventPayload: Record<string, unknown> = {
      eventType: 'project_document_change',
      changeType: payload.changeType,
      tenantId: payload.tenantId,
      projectId: payload.projectId,
      documentId: payload.documentId,
      title: payload.title,
      actor: payload.actor,
      occurredAt: occurredAt.toISOString(),
    };
    if (payload.fullText && payload.fullText.trim().length > 0) {
      rawEventPayload['fullText'] = `${payload.title}\n\n${payload.fullText}`;
    }

    const result = await this.ingest.ingest({
      tenantId: payload.tenantId,
      sourceId: source.id,
      sourceExternalId,
      occurredAt,
      payload: rawEventPayload,
      dataClass: 'internal',
    });

    this.metrics.incTrackerEventToKnowledgeCore({
      tenant: payload.tenantId,
      type: 'project_document_change',
    });

    this.logger.log(
      {
        rawEventId: result.rawEvent.id,
        documentId: payload.documentId,
        tenantId: payload.tenantId,
        idempotent: result.idempotent,
      },
      'tracker-adapter: project-document ingest завершён',
    );
  }

  private async processEvent(payload: TrackerEventPayloadShape): Promise<void> {
    if (!payload || typeof payload !== 'object') {
      this.logger.warn('tracker-adapter: пустой/некорректный payload — skip');
      return;
    }
    if (!payload.tenantId || !payload.issue?.id) {
      this.logger.warn(
        { type: payload.type },
        'tracker-adapter: payload без tenantId/issue.id — skip',
      );
      return;
    }
    const signalType = SIGNAL_TYPE_MAP[payload.type];
    if (!signalType) {
      this.logger.warn({ type: payload.type }, 'tracker-adapter: неизвестный type события — skip');
      return;
    }

    const occurredAt = this.parseOccurredAt(payload.occurredAt);
    const source = await this.upsertDefaultTrackerSource(payload.tenantId);

    const metaShortHash = this.shortHash(payload.meta);
    const sourceExternalId = [
      'tracker',
      'issue',
      payload.issue.id,
      payload.type,
      occurredAt.toISOString(),
      metaShortHash,
    ].join(':');

    const rawEventPayload = this.buildPayload({
      payload,
      signalType,
      occurredAt,
    });

    const result = await this.ingest.ingest({
      tenantId: payload.tenantId,
      sourceId: source.id,
      sourceExternalId,
      occurredAt,
      payload: rawEventPayload,
      dataClass: 'internal',
    });

    this.metrics.incTrackerEventToKnowledgeCore({
      tenant: payload.tenantId,
      type: payload.type,
    });

    this.logger.log(
      {
        rawEventId: result.rawEvent.id,
        type: payload.type,
        signalType,
        issueId: payload.issue.id,
        tenantId: payload.tenantId,
        idempotent: result.idempotent,
      },
      'tracker-adapter: ingest завершён',
    );
  }

  private buildPayload(args: {
    payload: TrackerEventPayloadShape;
    signalType: SignalType;
    occurredAt: Date;
  }): Record<string, unknown> {
    const { payload, signalType, occurredAt } = args;
    const base: Record<string, unknown> = {
      signalTypeHint: signalType,
      eventType: payload.type,
      tenantId: payload.tenantId,
      occurredAt: occurredAt.toISOString(),
      issue: payload.issue,
      actor: payload.actor,
      meta: payload.meta ?? {},
    };

    const fullText = this.extractFullText(payload);
    if (fullText) {
      base['fullText'] = fullText;
    }

    return base;
  }

  private extractFullText(payload: TrackerEventPayloadShape): string | null {
    if (payload.type === 'issue.created') {
      const parts: string[] = [payload.issue.title];
      const description = payload.issue.description;
      if (description && description.trim().length > 0) {
        parts.push('');
        parts.push(description);
      }
      return parts.join('\n');
    }
    if (payload.type === 'comment.created') {
      const meta = payload.meta ?? {};
      const stripped =
        typeof meta['commentStripped'] === 'string' ? (meta['commentStripped'] as string) : null;
      const content =
        typeof meta['commentContent'] === 'string' ? (meta['commentContent'] as string) : null;
      const transcript =
        typeof meta['voiceTranscript'] === 'string' ? (meta['voiceTranscript'] as string) : null;
      const text = stripped ?? content ?? transcript;
      if (text && text.trim().length > 0) {
        return `${payload.issue.title}\n\n${text}`;
      }
      return null;
    }
    if (payload.type === 'mention.created') {
      const meta = payload.meta ?? {};
      const ctx = typeof meta['contextText'] === 'string' ? (meta['contextText'] as string) : null;
      if (ctx && ctx.trim().length > 0) {
        return `${payload.issue.title}\n\n${ctx}`;
      }
      return null;
    }
    return null;
  }

  async upsertDefaultTrackerSource(tenantId: string): Promise<Source> {
    const existing = await this.prisma.source.findUnique({
      where: {
        tenantId_type_name: {
          tenantId,
          type: 'tracker_event',
          name: TrackerAdapter.DEFAULT_SOURCE_NAME,
        },
      },
    });
    if (existing) return existing;
    try {
      return await this.prisma.source.create({
        data: {
          tenantId,
          type: 'tracker_event',
          name: TrackerAdapter.DEFAULT_SOURCE_NAME,
          dataClass: 'internal',
          isActive: true,
        },
      });
    } catch (err) {
      const retry = await this.prisma.source.findUnique({
        where: {
          tenantId_type_name: {
            tenantId,
            type: 'tracker_event',
            name: TrackerAdapter.DEFAULT_SOURCE_NAME,
          },
        },
      });
      if (retry) return retry;
      throw err;
    }
  }

  private parseOccurredAt(input: string): Date {
    if (!input) return new Date();
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }

  private shortHash(meta: Record<string, unknown> | undefined): string {
    if (!meta || Object.keys(meta).length === 0) return '0';
    try {
      const json = JSON.stringify(meta);
      return createHash('sha256').update(json, 'utf8').digest('hex').slice(0, 8);
    } catch {
      return '0';
    }
  }
}
