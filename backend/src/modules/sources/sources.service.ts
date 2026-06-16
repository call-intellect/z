import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  type DataClass,
  Prisma,
  type Source,
  type SourceType,
} from '@prisma/client';

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

/**
 * Сервис управления Source'ами Org (Фаза 10 knowledge-core).
 *
 * Адаптер-зависимая логика (валидация config, регистрация webhook'ов, smoke-test)
 * выделена в `*-config.schema.ts` и `*Service` каждого адаптера. SourcesService
 * — координатор: CRUD + audit + диспетчеризация по `type`.
 *
 * Секреты (`botToken`, `apiKey`, `apiSalt`, `passwordEnc`) сохраняются в `config`
 * только зашифрованными через `CryptoService`. UI получает их как маркеры
 * `<encrypted>`.
 */
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
    // last RawEvent.receivedAt для каждого Source (одним SQL).
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

  async create(
    tenantId: string,
    userId: string,
    dto: SourceCreateDto,
  ): Promise<SourceResponseDto> {
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

    // Адаптер-специфичная пост-инициализация (например, регистрация Telegram
    // webhook'а). Не блокирует ответ — fire-and-forget с логом.
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
      const merged = this.mergeConfigPreservingSecrets(
        source,
        dto.config ?? null,
      );
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

    // Если выключили / включили — пере-регистрируем webhook (telegram).
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

  /**
   * Soft-delete: ставим `isActive=false`. Полное удаление невозможно из-за
   * FK от `RawEvent` через `onDelete: Restrict` (vNext — отдельный воркер,
   * который дробит RawEvent с retention).
   */
  async softDelete(
    tenantId: string,
    userId: string,
    id: string,
  ): Promise<{ ok: true }> {
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

  /**
   * Полное удаление источника (ТЗ 2026-06-16) — в отличие от softDelete сносит
   * строку целиком. `Source` защищён FK от `RawEvent` (RESTRICT), поэтому
   * сначала удаляем все его `RawEvent` (их `IdeaBlockEvidence` каскадятся),
   * затем сам `Source`. Собранные в графе IdeaBlock остаются (теряют лишь
   * evidence-ссылку на это событие). Необратимо.
   */
  async hardDelete(
    tenantId: string,
    userId: string,
    id: string,
  ): Promise<{ ok: true; deletedRawEvents: number }> {
    const source = await this.findOwnedOrThrow(tenantId, id);
    const deletedRawEvents = await this.prisma.$transaction(async (tx) => {
      const del = await tx.rawEvent.deleteMany({ where: { sourceId: id } });
      await tx.source.delete({ where: { id } });
      // chatbox-источник = интеграция: удаляя источник, делаем ПОЛНЫЙ сброс —
      // рвём коннект И сносим всю зеркальную chatbox-data, иначе страница ChatBox
      // покажет «Подключено» (рассинхрон), а сироты-данные останутся в БД.
      // Порядок — FK-safe: сообщения → сессии → чаты → клиенты каналов →
      // каналы → клиенты → менеджеры → интеграция.
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
      // bitrix-источник = интеграция: тот же ПОЛНЫЙ сброс (ТЗ 2026-06-17, Ф5).
      // Порядок FK-safe: сообщения → сессии → диалоги → сотрудники → CRM-зеркала
      // → интеграция (токены). Иначе страница Bitrix покажет «Подключено».
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

  /**
   * Smoke-test адаптера. Тип-зависимое поведение:
   *   - telegram → `getMe` Bot API.
   *   - mango    → проверка подписи на тестовом payload.
   *   - email    → IMAP login.
   *   - web_form → no-op (всегда ok).
   */
  async test(
    tenantId: string,
    userId: string,
    id: string,
  ): Promise<SourceTestResultDto> {
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

  // ─────────────────────────── helpers ──────────────────────────────

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

  /**
   * Заменяет секретные поля (botToken, apiKey, apiSalt, passwordEnc) на
   * `<encrypted>` маркер. Никогда не возвращает plain-секреты в API.
   */
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

  /**
   * Шифрует чувствительные поля. Допускается передать значение, уже
   * зашифрованное ранее (`gcm:v1:...`) — оставляем как есть.
   */
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
          // Маркер `<encrypted>` со стороны UI — оставляем без изменений
          // (в `update` вызовется mergeConfigPreservingSecrets и подменит
          // его на сохранённое в БД значение).
          continue;
        }
        out[k] = this.crypto.encrypt(v);
      }
    }
    return out;
  }

  /**
   * При update'е если в новом `config` секрет передан как `<encrypted>` —
   * подменяем его на старое значение из БД (не обнуляем).
   */
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

  /**
   * Хук пост-обработки create: регистрация webhook'а адаптера, если применимо.
   */
  private async afterCreate(source: Source): Promise<void> {
    if (source.type === 'bot' && source.isActive) {
      await this.telegram.registerWebhook(source.id);
    }
  }

  /**
   * Хук на смену isActive: регистрация / снятие webhook'а.
   */
  private async afterIsActiveChange(source: Source): Promise<void> {
    if (source.type === 'bot') {
      if (source.isActive) await this.telegram.registerWebhook(source.id);
      else await this.telegram.unregisterWebhook(source.id);
    }
  }
}

/**
 * Какие поля `Source.config` считаем секретными для шифрования. Зависит от
 * типа адаптера. Если в будущем добавится новый адаптер — продлеваем список.
 */
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
