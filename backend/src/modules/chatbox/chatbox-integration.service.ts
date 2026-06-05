import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { ChatboxIntegration } from '@prisma/client';

import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';

import {
  ChatboxApiClient,
  ChatboxApiError,
  type ChatboxWorkspace,
} from './chatbox-api.client';
import type {
  ChatboxIntegrationResponseDto,
  ChatboxIntegrationUpsertDto,
  ChatboxWorkspaceDto,
} from './dto/chatbox-integration.dto';

/**
 * Сервис конфига ChatBox-интеграции (ТЗ 2026-06-05, Фаза 2).
 *
 * Инвариант приватности: plain-токен НИКОГДА не покидает сервис в read-ответе —
 * наружу отдаётся только `hasToken`. Токен хранится зашифрованным
 * (`tokenEnc`, AES-256-GCM через CryptoService).
 *
 * Фаза 2 НЕ делает: регистрацию webhook (Фаза 4), синк данных (Фаза 3),
 * отправку сообщений (Фаза 6).
 */
@Injectable()
export class ChatboxIntegrationService {
  private readonly logger = new Logger(ChatboxIntegrationService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(ChatboxApiClient) private readonly client: ChatboxApiClient,
  ) {}

  /** Текущая интеграция org (sanitized, без токена) или null. */
  async getIntegration(
    tenantId: string,
  ): Promise<ChatboxIntegrationResponseDto | null> {
    const row = await this.prisma.chatboxIntegration.findUnique({
      where: { tenantId },
    });
    return row ? this.sanitize(row) : null;
  }

  /**
   * По введённому токену вернуть список воркспейсов (для выбора владельцем).
   * 401 → `chatbox_token_invalid`.
   */
  async listWorkspaces(token: string): Promise<ChatboxWorkspaceDto[]> {
    let workspaces: ChatboxWorkspace[];
    try {
      const res = await this.client.listWorkspaces(token, { limit: 200 });
      workspaces = res.workspaces ?? [];
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

  /**
   * Создать/обновить интеграцию. Валидирует токен + наличие выбранного
   * `workspaceId` среди доступных. Сохраняет `tokenEnc` только при новом токене.
   *
   * Фаза 4 (TODO): при `syncMode==='realtime'` зарегистрировать webhook ChatBox.
   */
  async upsert(
    tenantId: string,
    dto: ChatboxIntegrationUpsertDto,
  ): Promise<ChatboxIntegrationResponseDto> {
    const existing = await this.prisma.chatboxIntegration.findUnique({
      where: { tenantId },
    });

    // Резолв plain-токена: новый из dto ИЛИ существующий (decrypt).
    const tokenIsNew = Boolean(dto.token);
    let plainToken: string | null = dto.token ?? null;
    if (!plainToken && existing) {
      plainToken = this.crypto.decrypt(existing.tokenEnc);
    }
    if (!plainToken) {
      throw this.tokenInvalid('Токен ChatBox не передан');
    }

    // Валидация токена + проверка доступности выбранного воркспейса.
    let workspaces: ChatboxWorkspace[];
    try {
      const res = await this.client.listWorkspaces(plainToken, { limit: 200 });
      workspaces = res.workspaces ?? [];
    } catch (err) {
      throw this.mapClientError(err);
    }
    const selected = workspaces.find((w) => w.id === dto.workspaceId);
    if (!selected) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'chatbox_workspace_not_found',
          message: 'Выбранный воркспейс недоступен для этого токена',
        },
      });
    }

    // tokenEnc: шифруем только новый токен; иначе сохраняем существующий.
    const tokenEnc = tokenIsNew
      ? this.crypto.encrypt(plainToken)
      : (existing?.tokenEnc ?? this.crypto.encrypt(plainToken));

    await this.prisma.chatboxIntegration.upsert({
      where: { tenantId },
      create: {
        tenantId,
        tokenEnc,
        workspaceId: dto.workspaceId,
        workspaceName: selected.name,
        syncMode: dto.syncMode,
        status: 'connected',
        lastError: null,
      },
      update: {
        tokenEnc,
        workspaceId: dto.workspaceId,
        workspaceName: selected.name,
        syncMode: dto.syncMode,
        status: 'connected',
        lastError: null,
      },
    });

    // Фаза 4 (TODO): регистрация webhook ChatBox при syncMode==='realtime'
    // (plans/tz/2026-06-05-chatbox-integration.md Фаза 4).

    const result = await this.getIntegration(tenantId);
    // upsert гарантирует наличие строки — null здесь невозможен.
    return result as ChatboxIntegrationResponseDto;
  }

  /**
   * Отключить интеграцию (удалить конфиг). Снятие webhook ChatBox — Фаза 4.
   */
  async remove(tenantId: string): Promise<{ ok: true }> {
    // Фаза 4 (TODO): перед удалением снять зарегистрированный webhook ChatBox
    // (client.deleteWebhook), plans/tz/2026-06-05-chatbox-integration.md Фаза 4.
    await this.prisma.chatboxIntegration.deleteMany({ where: { tenantId } });
    return { ok: true };
  }

  /**
   * Расшифрованный токен для будущих фаз (синк/webhook/отправка). null —
   * интеграция не настроена. НЕ использовать в read-ответах API.
   */
  async getDecryptedToken(tenantId: string): Promise<string | null> {
    const row = await this.prisma.chatboxIntegration.findUnique({
      where: { tenantId },
    });
    return row ? this.crypto.decrypt(row.tokenEnc) : null;
  }

  /**
   * Конфиг для синка (Фаза 3): workspaceId + расшифрованный токен +
   * integrationId. null — интеграция не настроена. НЕ для read-ответов API
   * (содержит plain-токен).
   */
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

  // ─────────────────────────── helpers ──────────────────────────────

  private sanitize(row: ChatboxIntegration): ChatboxIntegrationResponseDto {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      workspaceName: row.workspaceName ?? null,
      syncMode: row.syncMode,
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
    const message =
      err instanceof Error ? err.message : 'Ошибка обращения к ChatBox API';
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
