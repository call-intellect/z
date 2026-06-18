import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type DataClass, Prisma, type Source, type SourceType } from '@prisma/client';

import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit/audit-log.service';
import { AUDIT } from '../audit/audit.types';
import { EmailFetchService } from '../ingest/adapters/email/email-fetch.service';
import { MangoAdapterService } from '../ingest/adapters/phone-call/mango.service';
import { TelegramAdapterService } from '../ingest/adapters/telegram/telegram.service';

import type {
  SourceCreateDto,
  SourceListQuery,
  SourceListResponseDto,
  SourceResponseDto,
  SourceTestResultDto,
  SourceUpdateDto,
} from './dto/source.dto';

@Injectable()
export class SourcesService {
  private readonly logger = new Logger(SourcesService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(TelegramAdapterService) private readonly telegram: TelegramAdapterService,
    @Inject(MangoAdapterService) private readonly mango: MangoAdapterService,
    @Inject(EmailFetchService) private readonly emailFetch: EmailFetchService,
  ) {}

  async list(tenantId: string, query: SourceListQuery): Promise<SourceListResponseDto> {
    const where: Prisma.SourceWhereInput = { tenantId };
    if (query.type) where.type = query.type;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.source.findMany({
        where,
        orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.source.count({ where }),
    ]);
    const ids = items.map((s) => s.id);
    const lastEvents =
      ids.length === 0
        ? []
        : await this.prisma.rawEvent.groupBy({
            by: ['sourceId'],
            where: { sourceId: { in: ids } },
            _max: { receivedAt: true },
          });
    const lastBySource = new Map<string, Date>();
    for (const row of lastEvents) {
      if (row._max?.receivedAt) lastBySource.set(row.sourceId, row._max.receivedAt);
    }
    return {
      items: items.map((s) => this.toDto(s, lastBySource.get(s.id) ?? null)),
      total,
    };
  }

  async get(tenantId: string, id: string): Promise<SourceResponseDto> {
    const source = await this.findOwnedOrThrow(tenantId, id);
    const last = await this.prisma.rawEvent.findFirst({
      where: { sourceId: source.id },
      orderBy: { receivedAt: 'desc' },
      select: { receivedAt: true },
    });
    return this.toDto(source, last?.receivedAt ?? null);
  }

  async create(tenantId: string, userId: string, dto: SourceCreateDto): Promise<SourceResponseDto> {
    const dataClass: DataClass = dto.dataClass ?? 'internal';
    const config = this.encryptSecrets(dto.type, dto.config ?? null);
    let created: Source;
    try {
      created = await this.prisma.source.create({
        data: {
          tenantId,
          type: dto.type,
          name: dto.name,
          config: config === null ? Prisma.JsonNull : (config as Prisma.InputJsonValue),
          dataClass,
          isActive: true,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'source_already_exists',
            message: `Source(type=${dto.type}, name=${dto.name}) уже существует в Org`,
          },
        });
      }
      throw err;
    }

    await this.audit.log({
      userId,
      action: AUDIT.SOURCE_CREATED,
      resourceId: created.id,
      metadata: {
        type: created.type,
        name: created.name,
        dataClass: created.dataClass,
      },
    });

    void this.afterCreate(created).catch((e) => {
      this.logger.warn(
        {
          sourceId: created.id,
          err: e instanceof Error ? e.message : String(e),
        },
        'sources.afterCreate: ошибка пост-инициализации',
      );
    });

    return this.toDto(created, null);
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    dto: SourceUpdateDto,
  ): Promise<SourceResponseDto> {
    const source = await this.findOwnedOrThrow(tenantId, id);
    const data: Prisma.SourceUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.dataClass !== undefined) data.dataClass = dto.dataClass;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.config !== undefined) {
      const merged = this.mergeConfigPreservingSecrets(source, dto.config ?? null);
      const enc = this.encryptSecrets(source.type, merged);
      data.config = enc === null ? Prisma.JsonNull : (enc as Prisma.InputJsonValue);
    }

    const updated = await this.prisma.source.update({ where: { id }, data });
    await this.audit.log({
      userId,
      action: AUDIT.SOURCE_UPDATED,
      resourceId: updated.id,
      metadata: {
        type: updated.type,
        name: updated.name,
        dataClass: updated.dataClass,
        isActive: updated.isActive,
      },
    });

    if (dto.isActive !== undefined) {
      void this.afterIsActiveChange(updated).catch((e) => {
        this.logger.warn(
          { sourceId: updated.id, err: e instanceof Error ? e.message : String(e) },
          'sources.afterIsActiveChange: ошибка',
        );
      });
    }

    return this.toDto(updated, null);
  }

  async softDelete(tenantId: string, userId: string, id: string): Promise<{ ok: true }> {
    const source = await this.findOwnedOrThrow(tenantId, id);
    if (!source.isActive) {
      return { ok: true };
    }
    const updated = await this.prisma.source.update({
      where: { id },
      data: { isActive: false },
    });
    await this.audit.log({
      userId,
      action: AUDIT.SOURCE_DELETED,
      resourceId: updated.id,
      metadata: { type: updated.type, name: updated.name },
    });
    void this.afterIsActiveChange(updated).catch(() => undefined);
    return { ok: true };
  }

  async hardDelete(
    tenantId: string,
    userId: string,
    id: string,
  ): Promise<{ ok: true; deletedRawEvents: number }> {
    const source = await this.findOwnedOrThrow(tenantId, id);
    const deletedRawEvents = await this.prisma.$transaction(async (tx) => {
      const del = await tx.rawEvent.deleteMany({ where: { sourceId: id } });
      await tx.source.delete({ where: { id } });
      if (source.type === 'chatbox') {
        await tx.chatboxMessage.deleteMany({ where: { tenantId } });
        await tx.chatboxChatSession.deleteMany({ where: { tenantId } });
        await tx.chatboxChat.deleteMany({ where: { tenantId } });
        await tx.chatboxChannelClient.deleteMany({ where: { tenantId } });
        await tx.chatboxChannel.deleteMany({ where: { tenantId } });
        await tx.chatboxCustomer.deleteMany({ where: { tenantId } });
        await tx.chatboxMember.deleteMany({ where: { tenantId } });
        await tx.chatboxIntegration.deleteMany({ where: { tenantId } });
      }
      if (source.type === 'bitrix') {
        await tx.bitrixMessage.deleteMany({ where: { tenantId } });
        await tx.bitrixDialogSession.deleteMany({ where: { tenantId } });
        await tx.bitrixDialog.deleteMany({ where: { tenantId } });
        await tx.bitrixUser.deleteMany({ where: { tenantId } });
        await tx.bitrixContact.deleteMany({ where: { tenantId } });
        await tx.bitrixCompany.deleteMany({ where: { tenantId } });
        await tx.bitrixDeal.deleteMany({ where: { tenantId } });
        await tx.bitrixLead.deleteMany({ where: { tenantId } });
        await tx.bitrixCrmNote.deleteMany({ where: { tenantId } });
        await tx.bitrixIntegration.deleteMany({ where: { tenantId } });
      }
      return del.count;
    });
    await this.audit.log({
      userId,
      action: AUDIT.SOURCE_DELETED,
      resourceId: id,
      metadata: {
        type: source.type,
        name: source.name,
        purged: true,
        rawEvents: deletedRawEvents,
      },
    });
    return { ok: true, deletedRawEvents };
  }

  async test(tenantId: string, userId: string, id: string): Promise<SourceTestResultDto> {
    const source = await this.findOwnedOrThrow(tenantId, id);
    let result: SourceTestResultDto;
    try {
      switch (source.type) {
        case 'bot':
          result = await this.telegram.test(source);
          break;
        case 'phone_call':
          result = this.mango.test(source);
          break;
        case 'email':
          result = await this.emailFetch.test(source);
          break;
        case 'web_form':
          result = { ok: true, details: { note: 'web-form: no-op' } };
          break;
        default:
          result = { ok: true, details: { note: `${source.type}: no test handler` } };
      }
    } catch (err) {
      result = {
        ok: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
    await this.audit.log({
      userId,
      action: AUDIT.SOURCE_TESTED,
      resourceId: source.id,
      metadata: { type: source.type, ok: result.ok },
    });
    return result;
  }

  private async findOwnedOrThrow(tenantId: string, id: string): Promise<Source> {
    const source = await this.prisma.source.findUnique({ where: { id } });
    if (!source || source.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'source_not_found', message: `Source ${id} не найден в текущей Org` },
      });
    }
    return source;
  }

  private toDto(source: Source, lastEventAt: Date | null): SourceResponseDto {
    const sanitized = this.sanitizeConfigForRead(source);
    const dto: SourceResponseDto = {
      id: source.id,
      tenantId: source.tenantId,
      type: source.type,
      name: source.name,
      config: sanitized,
      dataClass: source.dataClass,
      isActive: source.isActive,
      createdAt: source.createdAt.toISOString(),
      updatedAt: source.updatedAt.toISOString(),
      lastEventAt: lastEventAt?.toISOString() ?? null,
    };
    if (source.type === 'bot') {
      dto.webhookUrl = this.telegram.buildWebhookUrl(source.id);
    } else if (source.type === 'phone_call') {
      dto.webhookUrl = this.telegram.buildHostUrl(`/api/v1/ingest/calls/mango/${source.id}`);
    }
    return dto;
  }

  private sanitizeConfigForRead(source: Source): Record<string, unknown> | null {
    const cfg = source.config as Record<string, unknown> | null;
    if (!cfg) return null;
    const out: Record<string, unknown> = { ...cfg };
    const secretKeys = ['botToken', 'apiKey', 'apiSalt', 'passwordEnc', 'password'];
    for (const k of secretKeys) {
      if (k in out && typeof out[k] === 'string') {
        out[k] = '<encrypted>';
      }
    }
    return out;
  }

  private encryptSecrets(
    type: SourceType,
    config: Record<string, unknown> | null,
  ): Record<string, unknown> | null {
    if (!config) return null;
    const out: Record<string, unknown> = { ...config };
    const secretKeys = secretKeysForType(type);
    for (const k of secretKeys) {
      const v = out[k];
      if (typeof v === 'string' && v.length > 0) {
        if (this.crypto.isEncrypted(v) || v === '<encrypted>') {
          continue;
        }
        out[k] = this.crypto.encrypt(v);
      }
    }
    return out;
  }

  private mergeConfigPreservingSecrets(
    source: Source,
    newConfig: Record<string, unknown> | null,
  ): Record<string, unknown> | null {
    if (!newConfig) return newConfig;
    const oldCfg = (source.config as Record<string, unknown> | null) ?? {};
    const out: Record<string, unknown> = { ...newConfig };
    const secretKeys = secretKeysForType(source.type);
    for (const k of secretKeys) {
      if (out[k] === '<encrypted>' && typeof oldCfg[k] === 'string') {
        out[k] = oldCfg[k];
      }
    }
    return out;
  }

  private async afterCreate(source: Source): Promise<void> {
    if (source.type === 'bot' && source.isActive) {
      await this.telegram.registerWebhook(source.id);
    }
  }

  private async afterIsActiveChange(source: Source): Promise<void> {
    if (source.type === 'bot') {
      if (source.isActive) await this.telegram.registerWebhook(source.id);
      else await this.telegram.unregisterWebhook(source.id);
    }
  }
}

function secretKeysForType(type: SourceType): string[] {
  switch (type) {
    case 'bot':
      return ['botToken'];
    case 'phone_call':
      return ['apiKey', 'apiSalt'];
    case 'email':
      return ['passwordEnc', 'password'];
    default:
      return [];
  }
}
