import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { DestinationType, IntegrationDestination, Prisma } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { AuditLogService } from '../audit/audit-log.service';
import { AUDIT } from '../audit/audit.types';
import { EncryptionService } from '../security/encryption.service';

import type {
  CreateDestinationDto,
  UpdateDestinationDto,
} from './dto/destination.dto';
import { DestinationsRepository } from './destinations.repository';
import { SenderFactory } from './senders/sender.factory';

/**
 * Бизнес-сервис destinations.
 *
 * Шифрование секретов:
 *   - `slack_webhook.config.url` → `url_encrypted` (URL содержит секрет в pathname).
 *   - `telegram_bot.config.bot_token` → `bot_token_encrypted`.
 *   - `generic_webhook.config.url` → `url_encrypted`.
 *   - `email.config.recipient_email` → не шифруем (email — не секрет).
 *
 * При выдаче в API — исходные поля не возвращаем, только маркеры `*_present: true`.
 */
@Injectable()
export class DestinationsService {
  constructor(
    @Inject(DestinationsRepository) private readonly repo: DestinationsRepository,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(EncryptionService) private readonly encryption: EncryptionService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(SenderFactory) private readonly factory: SenderFactory,
  ) {}

  async list(userId: string): Promise<Array<ReturnType<typeof this.toView>>> {
    const items = await this.repo.listByUser(userId);
    return items.map((d) => this.toView(d));
  }

  async create(
    userId: string,
    dto: CreateDestinationDto,
  ): Promise<ReturnType<typeof this.toView>> {
    const max = this.cfg.workspace.maxDestinationsPerUser;
    const count = await this.repo.countByUser(userId);
    if (count >= max) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'destinations_limit_reached',
          message: `Достигнут лимит destinations (${max})`,
        },
      });
    }

    const config = this.encryptSecrets(dto.type, dto.config);

    const created = await this.repo.create({
      userId,
      type: dto.type,
      name: dto.name,
      config: config as Prisma.InputJsonValue,
    });

    await this.audit.log({
      userId,
      action: AUDIT.DESTINATION_CREATE,
      resourceId: created.id,
      metadata: { type: dto.type, name: dto.name },
    });
    return this.toView(created);
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateDestinationDto,
  ): Promise<ReturnType<typeof this.toView>> {
    const existing = await this.repo.findById(id);
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'destination_not_found', message: 'Destination не найден' },
      });
    }
    const updateData: { name?: string; config?: Prisma.InputJsonValue } = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.config !== undefined) {
      updateData.config = this.encryptSecrets(
        existing.type,
        dto.config as Record<string, unknown>,
      ) as Prisma.InputJsonValue;
    }
    const updated = await this.repo.update(id, updateData);
    await this.audit.log({
      userId,
      action: AUDIT.DESTINATION_UPDATE,
      resourceId: id,
    });
    return this.toView(updated);
  }

  async delete(id: string, userId: string): Promise<void> {
    const existing = await this.repo.findById(id);
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'destination_not_found', message: 'Destination не найден' },
      });
    }
    await this.repo.delete(id);
    await this.audit.log({
      userId,
      action: AUDIT.DESTINATION_DELETE,
      resourceId: id,
    });
  }

  async test(id: string, userId: string): Promise<{ ok: true }> {
    const dest = await this.repo.findById(id);
    if (!dest || dest.userId !== userId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'destination_not_found', message: 'Destination не найден' },
      });
    }
    await this.factory.send(dest, {
      title: 'Тест из Z',
      body: 'Это тестовое сообщение. Если вы видите его — destination настроен корректно.',
    });
    return { ok: true };
  }

  /**
   * Public-метод: используется TasksDispatcherService.sendTask и
   * `WebhookDeliveryWorker` (если кто-то захочет переотправить).
   */
  async findOwned(id: string, userId: string): Promise<IntegrationDestination> {
    const dest = await this.repo.findById(id);
    if (!dest || dest.userId !== userId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'destination_not_found', message: 'Destination не найден' },
      });
    }
    return dest;
  }

  // ─────────────────────────── helpers ──────────────────────────────────

  private encryptSecrets(
    type: DestinationType,
    raw: Record<string, unknown>,
  ): Record<string, unknown> {
    const result = { ...raw };
    if (type === 'slack_webhook' || type === 'generic_webhook') {
      const url = result.url;
      if (typeof url === 'string' && url.length > 0) {
        result.url_encrypted = this.encryption.encrypt(url);
        delete result.url;
      }
    }
    if (type === 'telegram_bot') {
      const token = result.bot_token;
      if (typeof token === 'string' && token.length > 0) {
        result.bot_token_encrypted = this.encryption.encrypt(token);
        delete result.bot_token;
      }
    }
    return result;
  }

  /**
   * Безопасный view для API (без plaintext секретов).
   */
  private toView(d: IntegrationDestination): {
    id: string;
    type: DestinationType;
    name: string;
    config: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
  } {
    const cfg = d.config as Record<string, unknown> | null;
    const safeConfig: Record<string, unknown> = {};
    if (cfg) {
      for (const [k, v] of Object.entries(cfg)) {
        if (k === 'url_encrypted') {
          safeConfig.url_present = true;
        } else if (k === 'bot_token_encrypted') {
          safeConfig.bot_token_present = true;
        } else if (k === 'bot_token' || k === 'url') {
          // Plain «пришло из dev» — если по каким-то причинам не зашифровалось.
          safeConfig[`${k}_present`] = true;
        } else {
          safeConfig[k] = v;
        }
      }
    }
    return {
      id: d.id,
      type: d.type,
      name: d.name,
      config: safeConfig,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  }
}
