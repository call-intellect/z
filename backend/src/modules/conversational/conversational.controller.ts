import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';

import { ConversationalIngestAdapter } from './adapters/conversational-ingest.adapter';
import { ConversationalService } from './conversational.service';
import {
  type LinkCodeKindDto,
  LinkCodeKindSchema,
  type UpdateMaxDataClassDto,
  UpdateMaxDataClassSchema,
  type UpdatePreferencesDto,
  UpdatePreferencesSchema,
} from './dto/channel.dto';
import {
  type CreateFreeNoteDto,
  CreateFreeNoteSchema,
  type ListMyNotificationsQueryDto,
  ListMyNotificationsQuerySchema,
  type RespondNotificationDto,
  RespondNotificationSchema,
} from './dto/notification.dto';

/**
 * REST API ConversationalModule. Все эндпоинты — только для собственного
 * пользователя (`/me/...`), tenant-scope через `X-Org-Id`.
 *
 * Каналы Org-уровня (`/admin/channels` — настройка SMTP/Telegram/etc для
 * всей Org) — это отдельный sub-TZ в admin-разделе (не часть α-1).
 */
@ApiTags('conversational')
@Controller('api/v1/me')
@UseGuards(CookieAuthGuard, TenantGuard)
export class ConversationalController {
  constructor(
    @Inject(ConversationalService)
    private readonly svc: ConversationalService,
    @Inject(ConversationalIngestAdapter)
    private readonly ingestAdapter: ConversationalIngestAdapter,
  ) {}

  // ──────────────────────────── /me/channels ─────────────────────────

  @Get('channels')
  @ApiOperation({ summary: 'Список настроенных каналов Org и привязка пользователя' })
  async listChannels(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ) {
    this.requireTenant(tenantId);
    const items = await this.svc.listMyChannels({ userId: user.id, tenantId: tenantId! });
    return {
      items: items.map(({ channel, binding }) => ({
        channel: {
          id: channel.id,
          kind: channel.kind,
          direction: channel.direction,
          status: channel.status,
          maxDataClass: channel.maxDataClass,
          // Б2 — только для бот-каналов; botToken НЕ отдаём, лишь факт его наличия.
          ...(channel.kind === 'telegram_bot' || channel.kind === 'max_bot'
            ? {
                configured: Boolean(
                  (channel.config as Record<string, unknown> | null)?.botToken,
                ),
                botUsername:
                  ((channel.config as Record<string, unknown> | null)
                    ?.botUsername as string | undefined) ?? null,
              }
            : {}),
        },
        binding: binding
          ? {
              id: binding.id,
              externalId: binding.externalId,
              verifiedAt: binding.verifiedAt?.toISOString() ?? null,
              preferences: binding.preferences,
              // W4.3 — per-binding потолок чувствительности (radio в /me/channels).
              maxDataClass: binding.maxDataClass,
            }
          : null,
      })),
    };
  }

  @Post('channels/:kind/link-code')
  @ApiOperation({ summary: 'Сгенерировать одноразовый код для привязки внешнего канала' })
  @ApiParam({ name: 'kind', enum: ['email_smtp', 'email_imap', 'telegram_bot', 'max_bot'] })
  async generateLinkCode(
    @CurrentUser() user: CurrentUserPayload,
    @Param('kind', new ZodValidationPipe(LinkCodeKindSchema)) kind: LinkCodeKindDto,
  ) {
    const { code, ttlSec } = await this.svc.generateLinkCode({
      userId: user.id,
      kind,
    });
    return { code, ttlSec };
  }

  @Patch('channels/bindings/:bindingId/preferences')
  @ApiOperation({ summary: 'Обновить настройки канала (тихие часы, фильтры, rate-limit)' })
  async updatePreferences(
    @CurrentUser() user: CurrentUserPayload,
    @Param('bindingId') bindingId: string,
    @Body(new ZodValidationPipe(UpdatePreferencesSchema)) body: UpdatePreferencesDto,
  ) {
    const updated = await this.svc.updatePreferences({
      userId: user.id,
      bindingId,
      preferences: body,
    });
    return {
      id: updated.id,
      preferences: updated.preferences,
    };
  }

  @Patch('channels/bindings/:bindingId/max-data-class')
  @ApiOperation({
    summary:
      'W4.3 — обновить потолок чувствительности канала (public/internal/sensitive)',
  })
  async updateMaxDataClass(
    @CurrentUser() user: CurrentUserPayload,
    @Param('bindingId') bindingId: string,
    @Body(new ZodValidationPipe(UpdateMaxDataClassSchema))
    body: UpdateMaxDataClassDto,
  ) {
    const updated = await this.svc.updateBindingMaxDataClass({
      userId: user.id,
      bindingId,
      maxDataClass: body.maxDataClass,
    });
    return {
      id: updated.id,
      maxDataClass: updated.maxDataClass,
    };
  }

  @Delete('channels/bindings/:bindingId')
  @ApiOperation({ summary: 'Отвязать канал (удалить ChannelBinding)' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async unlinkChannel(
    @CurrentUser() user: CurrentUserPayload,
    @Param('bindingId') bindingId: string,
  ): Promise<void> {
    await this.svc.unlinkChannel({ userId: user.id, bindingId });
  }

  // ──────────────────────────── /me/notifications ────────────────────

  @Get('notifications')
  @ApiOperation({ summary: 'Список уведомлений текущего пользователя' })
  async listNotifications(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
    @Query(new ZodValidationPipe(ListMyNotificationsQuerySchema))
    query: ListMyNotificationsQueryDto,
  ) {
    this.requireTenant(tenantId);
    const { items, nextCursor } = await this.svc.listMyNotifications({
      userId: user.id,
      tenantId: tenantId!,
      status: query.status,
      limit: query.limit,
      cursor: query.cursor,
    });
    return {
      items: items.map((n) => this.mapNotification(n)),
      nextCursor,
    };
  }

  @Get('notifications/:id')
  @ApiOperation({ summary: 'Карточка одного уведомления + история доставок' })
  async getNotification(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
    @Param('id') id: string,
  ) {
    this.requireTenant(tenantId);
    const n = await this.svc.getMyNotification({
      userId: user.id,
      tenantId: tenantId!,
      notificationId: id,
    });
    return {
      ...this.mapNotification(n),
      deliveries: n.deliveries.map((d) => ({
        id: d.id,
        channelBindingId: d.channelBindingId,
        status: d.status,
        attempts: d.attempts,
        attemptedAt: d.attemptedAt.toISOString(),
        deliveredAt: d.deliveredAt?.toISOString() ?? null,
        readAt: d.readAt?.toISOString() ?? null,
        respondedAt: d.respondedAt?.toISOString() ?? null,
        errorReason: d.errorReason,
      })),
    };
  }

  @Post('notifications/:id/respond')
  @ApiOperation({ summary: 'Ответить на probe-уведомление' })
  async respond(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RespondNotificationSchema)) body: RespondNotificationDto,
  ) {
    const n = await this.svc.respondToProbe({
      notificationId: id,
      userId: user.id,
      payload: body.payload,
    });
    return this.mapNotification(n);
  }

  @Post('notifications/:id/dismiss')
  @ApiOperation({ summary: 'Закрыть probe-уведомление без ответа' })
  async dismiss(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    const n = await this.svc.dismissProbe({
      notificationId: id,
      userId: user.id,
    });
    return this.mapNotification(n);
  }

  @Post('notifications/:id/read')
  @ApiOperation({ summary: 'Пометить уведомление как прочитанное' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<void> {
    await this.svc.markRead({ notificationId: id, userId: user.id });
  }

  @Post('notifications/free-note')
  @ApiOperation({
    summary: 'Создать свободную заметку (free_note) из канала in_app',
    description:
      'Заметка падает в `RawEvent(source.type=conversational)` и далее идёт по обычному knowledge-core pipeline.',
  })
  @HttpCode(HttpStatus.CREATED)
  async createFreeNote(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
    @Body(new ZodValidationPipe(CreateFreeNoteSchema)) body: CreateFreeNoteDto,
  ) {
    this.requireTenant(tenantId);
    const rawEvent = await this.ingestAdapter.ingestFreeNote({
      tenantId: tenantId!,
      userId: user.id,
      text: body.text,
      metadata: body.metadata as Record<string, unknown> | undefined,
    });
    return {
      rawEventId: rawEvent.id,
      occurredAt: rawEvent.occurredAt.toISOString(),
    };
  }

  // ──────────────────────────── helpers ──────────────────────────────

  private requireTenant(tenantId: string | undefined): void {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'tenant_required',
          message: 'Не определена текущая Org (заголовок X-Org-Id)',
        },
      });
    }
  }

  private mapNotification(n: {
    id: string;
    tenantId: string;
    recipientUserId: string;
    eventType: string;
    payload: unknown;
    dataClass: string;
    contextBlockId: string | null;
    contextCardId: string | null;
    status: string;
    responseStatus: string | null;
    responsePayload: unknown;
    expiresAt: Date | null;
    createdAt: Date;
    respondedAt: Date | null;
  }) {
    return {
      id: n.id,
      eventType: n.eventType,
      payload: n.payload,
      dataClass: n.dataClass,
      contextBlockId: n.contextBlockId,
      contextCardId: n.contextCardId,
      status: n.status,
      responseStatus: n.responseStatus,
      responsePayload: n.responsePayload,
      expiresAt: n.expiresAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
      respondedAt: n.respondedAt?.toISOString() ?? null,
    };
  }
}
