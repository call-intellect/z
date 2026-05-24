import { randomBytes } from 'node:crypto';

import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  type IssueWebhook,
  type IssueWebhookLog,
} from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type { CreateWebhookDto } from '../dto/webhooks/create-webhook.dto';
import type {
  UpdateWebhookDto,
  WebhookLogsQuery,
} from '../dto/webhooks/update-webhook.dto';

import { WebhookDispatcher } from './webhook-dispatcher.service';

export interface WebhookResponseDto {
  id: string;
  tenantId: string;
  name: string;
  url: string;
  /** secretKey возвращается полностью только при create. PATCH/findAll — маска. */
  secretKey: string;
  events: string[];
  isActive: boolean;
  isInternal: boolean;
  version: number;
  createdByUserId: string;
  createdAt: string;
}

export interface WebhookLogDto {
  id: string;
  webhookId: string;
  eventType: string;
  requestMethod: string;
  requestUrl: string;
  responseStatus: number | null;
  responseTime: number | null;
  retryCount: number;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
}

export interface WebhookLogsResponse {
  items: WebhookLogDto[];
  total: number;
  page: number;
  limit: number;
}

export interface WebhookTestResult {
  ok: boolean;
  status: number | null;
  durationMs: number;
  errorMessage: string | null;
  bodySnippet: string | null;
}

/**
 * Async-вариант test-результата (Sprint 2). Test'ы теперь идут через
 * `tracker.webhook-delivery` очередь — клиент получает `jobId` сразу и
 * смотрит результат через `/webhooks/:id/logs`.
 */
export interface WebhookTestEnqueueResult {
  ok: boolean;
  jobId: string | null;
  /** Куда смотреть результат. */
  logsUrl: string;
  message: string;
}

const SECRET_PREFIX = 'kora_wh_';

/**
 * WebhooksService — исходящие webhook'и трекера (issue.created / cycle.completed / …).
 * Phase 1 — только CRUD + тестовый POST с timeout 5s. Полноценная доставка
 * через BullMQ с HMAC-подписью и retry-логикой — Sprint 2 (B1-2.2).
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WebhookDispatcher)
    private readonly dispatcher: WebhookDispatcher,
  ) {}

  /** Создать webhook. secretKey генерируется автоматически и возвращается клиенту ОДИН раз. */
  async create(
    dto: CreateWebhookDto,
    tenantId: string,
    userId: string,
  ): Promise<WebhookResponseDto> {
    const secretKey = `${SECRET_PREFIX}${randomBytes(32).toString('hex')}`;
    const created = await this.prisma.issueWebhook.create({
      data: {
        tenantId,
        name: dto.name,
        url: dto.url,
        secretKey,
        events: dto.events,
        isActive: dto.isActive,
        isInternal: dto.isInternal,
        createdByUserId: userId,
      },
    });
    return this.toResponse(created, /* unmask */ true);
  }

  /** Список webhook'ов tenant'а. secretKey маскируется. */
  async findAll(tenantId: string): Promise<WebhookResponseDto[]> {
    const rows = await this.prisma.issueWebhook.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: 'desc' }],
    });
    return rows.map((r) => this.toResponse(r, false));
  }

  /** PATCH webhook. */
  async update(
    id: string,
    dto: UpdateWebhookDto,
    tenantId: string,
  ): Promise<WebhookResponseDto> {
    await this.requireWebhook(id, tenantId);
    const updated = await this.prisma.issueWebhook.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.url !== undefined && { url: dto.url }),
        ...(dto.events !== undefined && { events: dto.events }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.isInternal !== undefined && { isInternal: dto.isInternal }),
        version: { increment: 1 },
      },
    });
    return this.toResponse(updated, false);
  }

  /** Удалить webhook (вместе с логами через Cascade). */
  async delete(id: string, tenantId: string): Promise<{ ok: true }> {
    await this.requireWebhook(id, tenantId);
    await this.prisma.issueWebhook.delete({ where: { id } });
    return { ok: true };
  }

  /** Логи доставки webhook'а с пагинацией. */
  async getLogs(
    id: string,
    tenantId: string,
    query: WebhookLogsQuery,
  ): Promise<WebhookLogsResponse> {
    await this.requireWebhook(id, tenantId);
    const where: Prisma.IssueWebhookLogWhereInput = { webhookId: id };
    if (query.success !== undefined) where.success = query.success;
    if (query.eventType) where.eventType = query.eventType;
    if (query.since || query.until) {
      where.createdAt = {
        ...(query.since && { gte: query.since }),
        ...(query.until && { lte: query.until }),
      };
    }
    const [items, total] = await Promise.all([
      this.prisma.issueWebhookLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take: query.limit,
        skip: (query.page - 1) * query.limit,
      }),
      this.prisma.issueWebhookLog.count({ where }),
    ]);
    return {
      items: items.map((l) => this.toLogResponse(l)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * Поставить тестовую доставку в очередь `tracker.webhook-delivery`.
   * Возвращает 202-style result с jobId и ссылкой на логи.
   * Sprint 2 (B1-2.2): single attempt, HMAC + полная запись в IssueWebhookLog.
   */
  async enqueueTest(
    id: string,
    tenantId: string,
  ): Promise<WebhookTestEnqueueResult> {
    const webhook = await this.requireWebhook(id, tenantId);
    if (!webhook.isActive) {
      return {
        ok: false,
        jobId: null,
        logsUrl: `/api/v1/tracker/webhooks/${webhook.id}/logs`,
        message: 'Webhook не активен — активируйте его перед тестом.',
      };
    }
    const jobId = await this.dispatcher.dispatchTest({
      webhookId: webhook.id,
      tenantId,
    });
    return {
      ok: true,
      jobId,
      logsUrl: `/api/v1/tracker/webhooks/${webhook.id}/logs`,
      message:
        'Тестовая доставка поставлена в очередь. Результат — в логах через 1–10 секунд.',
    };
  }

  private async requireWebhook(
    id: string,
    tenantId: string,
  ): Promise<IssueWebhook> {
    const w = await this.prisma.issueWebhook.findFirst({
      where: { id, tenantId },
    });
    if (!w) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'webhook_not_found', message: 'Webhook не найден' },
      });
    }
    return w;
  }

  private toResponse(w: IssueWebhook, unmask: boolean): WebhookResponseDto {
    return {
      id: w.id,
      tenantId: w.tenantId,
      name: w.name,
      url: w.url,
      secretKey: unmask
        ? w.secretKey
        : `${SECRET_PREFIX}${'*'.repeat(8)}…${w.secretKey.slice(-4)}`,
      events: w.events,
      isActive: w.isActive,
      isInternal: w.isInternal,
      version: w.version,
      createdByUserId: w.createdByUserId,
      createdAt: w.createdAt.toISOString(),
    };
  }

  private toLogResponse(l: IssueWebhookLog): WebhookLogDto {
    return {
      id: l.id,
      webhookId: l.webhookId,
      eventType: l.eventType,
      requestMethod: l.requestMethod,
      requestUrl: l.requestUrl,
      responseStatus: l.responseStatus,
      responseTime: l.responseTime,
      retryCount: l.retryCount,
      success: l.success,
      errorMessage: l.errorMessage,
      createdAt: l.createdAt.toISOString(),
    };
  }
}
