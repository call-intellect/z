import { randomBytes } from 'node:crypto';

import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { ChatboxIntegration } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';

import { ChatboxApiClient, ChatboxApiError, type ChatboxWorkspace } from './chatbox-api.client';
import type {
  ChatboxIntegrationResponseDto,
  ChatboxIntegrationUpsertDto,
  ChatboxWorkspaceDto,
} from './dto/chatbox-integration.dto';

@Injectable()
export class ChatboxIntegrationService {
  private readonly logger = new Logger(ChatboxIntegrationService.name);

  private static readonly OWNED_ROLES = new Set(['OWNER', 'ADMIN']);

  private static readonly WORKSPACES_PAGE = 100;

  private async fetchOwnedWorkspaces(token: string): Promise<ChatboxWorkspace[]> {
    const page = ChatboxIntegrationService.WORKSPACES_PAGE;
    const all: ChatboxWorkspace[] = [];
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;

    for (let i = 0; i < 1000 && offset < total; i++) {
      const res = await this.client.listWorkspaces(token, { limit: page, offset });
      const batch = res.workspaces ?? [];
      all.push(...batch);
      total = typeof res.total === 'number' ? res.total : all.length;
      if (batch.length === 0) break;
      offset += batch.length;
    }

    const owned = all.filter((w) =>
      ChatboxIntegrationService.OWNED_ROLES.has((w.role ?? '').toUpperCase()),
    );
    this.logger.debug(
      `fetchOwnedWorkspaces: всего=${all.length}, своих(OWNER/ADMIN)=${owned.length}`,
    );
    return owned;
  }

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(ChatboxApiClient) private readonly client: ChatboxApiClient,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async getIntegration(tenantId: string): Promise<ChatboxIntegrationResponseDto | null> {
    const row = await this.prisma.chatboxIntegration.findUnique({
      where: { tenantId },
    });
    return row ? this.sanitize(row) : null;
  }

  async listWorkspaces(token: string): Promise<ChatboxWorkspaceDto[]> {
    let workspaces: ChatboxWorkspace[];
    try {
      workspaces = await this.fetchOwnedWorkspaces(token);
    } catch (err) {
      throw this.mapClientError(err);
    }
    return workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description ?? null,
      role: w.role,
    }));
  }

  async upsert(
    tenantId: string,
    dto: ChatboxIntegrationUpsertDto,
  ): Promise<ChatboxIntegrationResponseDto> {
    const existing = await this.prisma.chatboxIntegration.findUnique({
      where: { tenantId },
    });

    const tokenIsNew = Boolean(dto.token);
    let plainToken: string | null = dto.token ?? null;
    if (!plainToken && existing) {
      plainToken = this.crypto.decrypt(existing.tokenEnc);
    }
    if (!plainToken) {
      throw this.tokenInvalid('Токен ChatBox не передан');
    }

    let workspaces: ChatboxWorkspace[];
    try {
      workspaces = await this.fetchOwnedWorkspaces(plainToken);
    } catch (err) {
      throw this.mapClientError(err);
    }
    const selected = workspaces.find((w) => w.id === dto.workspaceId);
    if (!selected) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'chatbox_workspace_not_found',
          message: 'Выбранный воркспейс недоступен для этого токена (нужна роль OWNER/ADMIN)',
        },
      });
    }

    const tokenEnc = tokenIsNew
      ? this.crypto.encrypt(plainToken)
      : (existing?.tokenEnc ?? this.crypto.encrypt(plainToken));

    const saved = await this.prisma.chatboxIntegration.upsert({
      where: { tenantId },
      create: {
        tenantId,
        tokenEnc,
        workspaceId: dto.workspaceId,
        workspaceName: selected.name,
        syncMode: 'daily',
        analysisEnabled: dto.analysisEnabled ?? true,
        status: 'connected',
        lastError: null,
      },
      update: {
        tokenEnc,
        workspaceId: dto.workspaceId,
        workspaceName: selected.name,
        syncMode: 'daily',
        ...(dto.analysisEnabled !== undefined ? { analysisEnabled: dto.analysisEnabled } : {}),
        status: 'connected',
        lastError: null,
      },
    });

    await this.reconcileWebhook(tenantId, plainToken, dto.workspaceId, saved);

    await this.ensureChatboxSource(tenantId);

    const result = await this.getIntegration(tenantId);
    return result as ChatboxIntegrationResponseDto;
  }

  private async ensureChatboxSource(tenantId: string): Promise<void> {
    await this.prisma.source
      .upsert({
        where: {
          tenantId_type_name: {
            tenantId,
            type: 'chatbox',
            name: 'ChatBox',
          },
        },
        create: {
          tenantId,
          type: 'chatbox',
          name: 'ChatBox',
          dataClass: 'sensitive',
          isActive: true,
        },
        update: { isActive: true },
        select: { id: true },
      })
      .catch((err) => {
        this.logger.warn(
          `ensureChatboxSource: не удалось создать Source — ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  }

  async remove(tenantId: string): Promise<{ ok: true }> {
    const row = await this.prisma.chatboxIntegration.findUnique({
      where: { tenantId },
    });
    if (row?.webhookExternalId) {
      const token = this.crypto.decrypt(row.tokenEnc);
      await this.removeWebhook(token, row.workspaceId, row.webhookExternalId);
    }
    await this.prisma.chatboxIntegration.deleteMany({ where: { tenantId } });
    await this.prisma.source
      .updateMany({
        where: { tenantId, type: 'chatbox', name: 'ChatBox' },
        data: { isActive: false },
      })
      .catch(() => undefined);
    return { ok: true };
  }

  async getDecryptedToken(tenantId: string): Promise<string | null> {
    const row = await this.prisma.chatboxIntegration.findUnique({
      where: { tenantId },
    });
    return row ? this.crypto.decrypt(row.tokenEnc) : null;
  }

  async getConfigForSync(tenantId: string): Promise<{
    workspaceId: string;
    token: string;
    integrationId: string;
  } | null> {
    const row = await this.prisma.chatboxIntegration.findUnique({
      where: { tenantId },
    });
    if (!row) return null;
    return {
      workspaceId: row.workspaceId,
      token: this.crypto.decrypt(row.tokenEnc),
      integrationId: row.id,
    };
  }

  private buildWebhookUrl(tenantId: string, secret: string): string {
    return `${this.cfg.publicHostUrl}/api/v1/webhooks/chatbox/${tenantId}/${secret}`;
  }

  private async reconcileWebhook(
    tenantId: string,
    token: string,
    workspaceId: string,
    row: ChatboxIntegration,
  ): Promise<void> {
    if (row.syncMode === 'realtime') {
      try {
        const { webhookExternalId, webhookSecret } = await this.ensureWebhook(
          tenantId,
          token,
          workspaceId,
          row,
        );
        await this.prisma.chatboxIntegration.update({
          where: { tenantId },
          data: { webhookExternalId, webhookSecret },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Не удалось создать webhook';
        this.logger.warn(
          `reconcileWebhook: создание webhook не удалось для tenant=${tenantId}: ${message}`,
        );
        await this.prisma.chatboxIntegration
          .update({
            where: { tenantId },
            data: { status: 'error', lastError: message },
          })
          .catch(() => undefined);
      }
      return;
    }

    if (row.webhookExternalId) {
      await this.removeWebhook(token, workspaceId, row.webhookExternalId);
      await this.prisma.chatboxIntegration
        .update({
          where: { tenantId },
          data: { webhookExternalId: null, webhookSecret: null },
        })
        .catch(() => undefined);
    }
  }

  private async ensureWebhook(
    tenantId: string,
    token: string,
    workspaceId: string,
    row: ChatboxIntegration,
  ): Promise<{ webhookExternalId: string; webhookSecret: string }> {
    if (row.webhookExternalId && row.webhookSecret) {
      return {
        webhookExternalId: row.webhookExternalId,
        webhookSecret: row.webhookSecret,
      };
    }
    const secret = randomBytes(24).toString('hex');
    const wh = await this.client.createWebhook(token, workspaceId, {
      url: this.buildWebhookUrl(tenantId, secret),
      events: [
        'CHAT_CREATED',
        'CHAT_CLOSED',
        'MESSAGE_CREATED',
        'MESSAGE_UPDATED',
        'CHANNEL_CLIENT_CREATED',
      ],
      description: 'Кора (Z) — синхронизация чатов',
    });
    return { webhookExternalId: wh.id, webhookSecret: secret };
  }

  private async removeWebhook(
    token: string,
    workspaceId: string,
    webhookExternalId: string,
  ): Promise<void> {
    try {
      await this.client.deleteWebhook(token, workspaceId, webhookExternalId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`removeWebhook: не удалось снять webhook ${webhookExternalId}: ${message}`);
    }
  }

  private sanitize(row: ChatboxIntegration): ChatboxIntegrationResponseDto {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      workspaceName: row.workspaceName ?? null,
      syncMode: row.syncMode,
      analysisEnabled: row.analysisEnabled,
      status: row.status,
      lastError: row.lastError ?? null,
      lastFullSyncAt: row.lastFullSyncAt?.toISOString() ?? null,
      lastIncrementalSyncAt: row.lastIncrementalSyncAt?.toISOString() ?? null,
      hasToken: Boolean(row.tokenEnc),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapClientError(err: unknown): BadRequestException {
    if (err instanceof ChatboxApiError && err.status === 401) {
      return this.tokenInvalid('Токен ChatBox недействителен');
    }
    const message = err instanceof Error ? err.message : 'Ошибка обращения к ChatBox API';
    this.logger.warn(`ChatBox API error: ${message}`);
    return this.tokenInvalid(message);
  }

  private tokenInvalid(message: string): BadRequestException {
    return new BadRequestException({
      ok: false,
      error: { code: 'chatbox_token_invalid', message },
    });
  }
}
