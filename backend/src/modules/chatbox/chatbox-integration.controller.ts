import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { EntitlementService } from '../entitlements/entitlement.service';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import { ChatboxIntegrationService } from './chatbox-integration.service';
import {
  ChatboxIntegrationUpsertSchema,
  ChatboxSyncRequestSchema,
  ChatboxWorkspacesProbeSchema,
  type ChatboxIntegrationResponseDto,
  type ChatboxIntegrationUpsertDto,
  type ChatboxSyncRequestDto,
  type ChatboxWorkspaceDto,
  type ChatboxWorkspacesProbeDto,
} from './dto/chatbox-integration.dto';
import { ChatboxSyncQueueService } from './queue/chatbox-sync.queue.service';

/**
 * REST API ChatBox-интеграции org (ТЗ 2026-06-05, Фаза 2).
 *
 *   - GET    /api/v1/chatbox/integration            — текущая (read).
 *   - POST   /api/v1/chatbox/integration/workspaces — список воркспейсов по токену (manage).
 *   - PUT    /api/v1/chatbox/integration            — создать/обновить (manage).
 *   - DELETE /api/v1/chatbox/integration            — отключить (delete).
 *
 * RBAC ресурс — `chatbox`. Фича тарифа — `feature.chatbox`. Guard'ы и формат
 * ошибок `{ ok:false, error:{ code, message } }` — по образцу `sources.controller`.
 */
@ApiTags('chatbox')
@Controller('api/v1/chatbox/integration')
@UseGuards(CookieAuthGuard, TenantGuard)
export class ChatboxIntegrationController {
  constructor(
    @Inject(ChatboxIntegrationService)
    private readonly service: ChatboxIntegrationService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(EntitlementService)
    private readonly entitlements: EntitlementService,
    @Inject(ChatboxSyncQueueService)
    private readonly syncQueue: ChatboxSyncQueueService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Текущая ChatBox-интеграция org (без токена)' })
  async get(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ChatboxIntegrationResponseDto | null> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.service.getIntegration(t);
  }

  @Post('workspaces')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Список воркспейсов ChatBox по введённому токену' })
  async workspaces(
    @Body(new ZodValidationPipe(ChatboxWorkspacesProbeSchema))
    body: ChatboxWorkspacesProbeDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ChatboxWorkspaceDto[]> {
    const t = this.requireTenant(tenantId);
    await this.requireManage(user.id, t);
    return this.service.listWorkspaces(body.token);
  }

  @Put()
  @ApiOperation({ summary: 'Создать/обновить ChatBox-интеграцию' })
  async upsert(
    @Body(new ZodValidationPipe(ChatboxIntegrationUpsertSchema))
    body: ChatboxIntegrationUpsertDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ChatboxIntegrationResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireManage(user.id, t);

    const allowed = await this.entitlements.hasFeature(t, 'feature.chatbox');
    if (!allowed) {
      const ent = await this.entitlements.getEntitlement(t);
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'entitlement_required',
          message: `Интеграция с ChatBox не входит в тариф ${ent.tier}.`,
          feature: 'feature.chatbox',
          currentTier: ent.tier,
          upgradeUrl: '/settings/billing',
        },
      });
    }

    return this.service.upsert(t, body);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Отключить ChatBox-интеграцию' })
  async remove(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    return this.service.remove(t);
  }

  @Post('sync')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Ручной триггер синка ChatBox по scope' })
  async sync(
    @Body(new ZodValidationPipe(ChatboxSyncRequestSchema))
    body: ChatboxSyncRequestDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; jobId: string }> {
    const t = this.requireTenant(tenantId);
    await this.requireManage(user.id, t);
    const { jobId } = await this.syncQueue.enqueue(t, body.scope, body.since);
    return { ok: true, jobId };
  }

  @Get('sync/status')
  @ApiOperation({ summary: 'Статус синка ChatBox (даты, ошибки, счётчики)' })
  async syncStatus(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<Record<string, unknown>> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);

    const integration = await this.prisma.chatboxIntegration.findUnique({
      where: { tenantId: t },
      select: {
        status: true,
        lastError: true,
        lastFullSyncAt: true,
        lastIncrementalSyncAt: true,
      },
    });
    if (!integration) {
      return { configured: false };
    }

    const where = { tenantId: t };
    const [chats, messages, customers, channelClients, members, sessions] =
      await Promise.all([
        this.prisma.chatboxChat.count({ where }),
        this.prisma.chatboxMessage.count({ where }),
        this.prisma.chatboxCustomer.count({ where }),
        this.prisma.chatboxChannelClient.count({ where }),
        this.prisma.chatboxMember.count({ where }),
        this.prisma.chatboxChatSession.count({ where }),
      ]);

    return {
      configured: true,
      status: integration.status,
      lastError: integration.lastError,
      lastFullSyncAt: integration.lastFullSyncAt?.toISOString() ?? null,
      lastIncrementalSyncAt:
        integration.lastIncrementalSyncAt?.toISOString() ?? null,
      counts: { chats, messages, customers, channelClients, members, sessions },
    };
  }

  @Get('memory-summary')
  @ApiOperation({
    summary:
      'Сводка «Чаты в памяти»: забрано/проанализировано/в работе/блоки/задачи',
  })
  async memorySummary(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<Record<string, unknown>> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);

    const integration = await this.prisma.chatboxIntegration.findUnique({
      where: { tenantId: t },
      select: { analysisEnabled: true },
    });
    if (!integration) {
      return { configured: false };
    }

    const where = { tenantId: t };
    const [dialogs, sessions, analyzed, inProgress, failed, blocks, tasks] =
      await Promise.all([
        // забрано диалогов (зеркало чатов)
        this.prisma.chatboxChat.count({ where }),
        // всего сессий
        this.prisma.chatboxChatSession.count({ where }),
        // проанализировано (мост в граф выполнен)
        this.prisma.chatboxChatSession.count({
          where: { tenantId: t, analysisStatus: 'done' },
        }),
        // в работе (ждут / анализируются)
        this.prisma.chatboxChatSession.count({
          where: { tenantId: t, analysisStatus: { in: ['pending', 'analyzing'] } },
        }),
        // упавшие
        this.prisma.chatboxChatSession.count({
          where: { tenantId: t, analysisStatus: 'failed' },
        }),
        // блоки знаний из переписки (RawEvent из chatbox → дальше граф)
        this.prisma.rawEvent.count({
          where: { tenantId: t, sourceType: 'chatbox' },
        }),
        // задачи, порождённые из переписки
        this.prisma.task.count({
          where: { tenantId: t, sourceType: 'chatbox' },
        }),
      ]);

    return {
      configured: true,
      analysisEnabled: integration.analysisEnabled,
      dialogs,
      sessions,
      analyzed,
      inProgress,
      failed,
      blocks,
      tasks,
    };
  }

  // ─────────────────────────── helpers ──────────────────────────────

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    return tenantId;
  }

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'chatbox');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Нет прав на чтение ChatBox-интеграции',
        },
      });
    }
  }

  private async requireManage(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'chatbox',
      act: 'manage',
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message:
            'Управлять ChatBox-интеграцией может только владелец или администратор Org',
        },
      });
    }
  }

  private async requireDelete(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'chatbox',
      act: 'delete',
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Отключение ChatBox-интеграции доступно только владельцу Org',
        },
      });
    }
  }
}
