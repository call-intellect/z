import { timingSafeEqual } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { BitrixIntegration } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtService } from '../auth/services/jwt.service';

import {
  BitrixApiClient,
  BitrixApiError,
  type BitrixTokenResponse,
} from './bitrix-api.client';
import type { BitrixIntegrationResponseDto } from './dto/bitrix-integration.dto';

/**
 * Сервис Bitrix24-интеграции org.
 * ТЗ: plans/tz/2026-06-09-bitrix24-integration-install.md.
 *
 * Отвечает за установку (оба способа), шифрованное хранение токенов
 * (AES-256-GCM через CryptoService), refresh по требованию, проверку соединения
 * и отключение. Синк данных — отдельный следующий этап (вне этого сервиса).
 *
 * Инвариант приватности: plain-токены НИКОГДА не покидают сервис в read-ответе —
 * наружу только `hasTokens`.
 */
@Injectable()
export class BitrixIntegrationService {
  private readonly logger = new Logger(BitrixIntegrationService.name);

  /** Буфер до протухания access_token (refresh заранее, чтобы не словить 401). */
  private static readonly EXPIRY_BUFFER_MS = 60_000;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(BitrixApiClient) private readonly client: BitrixApiClient,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  // ─────────────────────────── способ A: OAuth-коннект ───────────────

  /**
   * URL авторизации Bitrix24 для способа A. `state` — подписанный JWT с
   * tenantId+domain (живёт 15 мин). Бросает `bitrix_misconfigured`, если нет
   * client_id приложения.
   */
  buildAuthorizeUrl(tenantId: string, domain: string): string {
    const clientId = this.cfg.bitrix.clientId;
    if (!clientId) {
      throw this.misconfigured();
    }
    const state = this.jwt.signBitrixState({ sub: tenantId, domain });
    const qs = new URLSearchParams({ client_id: clientId, state }).toString();
    return `https://${domain}/oauth/authorize/?${qs}`;
  }

  /**
   * Callback способа A: проверяем state → tenantId, меняем `code` на токены,
   * сохраняем интеграцию в `connected`. Возвращает домен портала (для редиректа).
   * Любая ошибка — бросается наружу (контроллер редиректит на ?bitrix=error).
   */
  async handleOAuthCallback(params: {
    code?: string;
    state?: string;
    memberId?: string;
    scope?: string;
    error?: string;
  }): Promise<{ portalDomain: string }> {
    if (params.error) {
      throw new BadRequestException(`Bitrix OAuth error: ${params.error}`);
    }
    if (!params.code || !params.state) {
      throw new BadRequestException('Отсутствует code или state');
    }

    let tenantId: string;
    let stateDomain: string;
    try {
      const verified = this.jwt.verifyBitrixState(params.state);
      tenantId = verified.sub;
      stateDomain = verified.domain;
    } catch {
      throw new BadRequestException('Невалидный или просроченный state');
    }

    const tokens = await this.client.exchangeCode(params.code);
    const portalDomain = this.resolveDomain(tokens, stateDomain);

    await this.assertNoForeignActiveBinding(tenantId, tokens.member_id);
    await this.persistTokens(tokens, {
      tenantId,
      portalDomain,
      status: 'connected',
    });
    await this.ensureBitrixSource(tenantId);

    this.logger.log(
      `Bitrix OAuth connected: tenant=${tenantId} member=${tokens.member_id} domain=${portalDomain}`,
    );
    return { portalDomain };
  }

  // ─────────────────────────── способ B: установка из Маркета ────────

  /**
   * Обработчик `ONAPPINSTALL`: сохраняем токены портала в `pending` (привязка к
   * org — позже через claim из iframe-handler). Best-effort: вызывается из
   * public-контроллера, который всегда отвечает 200.
   */
  async onAppInstall(auth: {
    member_id?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number | string;
    domain?: string;
    client_endpoint?: string;
    server_endpoint?: string;
    scope?: string;
    application_token?: string;
  }): Promise<void> {
    if (!auth.member_id || !auth.access_token || !auth.refresh_token) {
      this.logger.warn('ONAPPINSTALL без member_id/токенов — пропуск');
      return;
    }
    const tokens: BitrixTokenResponse = {
      access_token: auth.access_token,
      refresh_token: auth.refresh_token,
      expires_in: Number(auth.expires_in ?? 3600),
      member_id: auth.member_id,
      client_endpoint: auth.client_endpoint ?? '',
      server_endpoint: auth.server_endpoint,
      scope: auth.scope,
      domain: auth.domain,
    };
    const portalDomain = this.resolveDomain(tokens, auth.domain ?? '');

    // Если портал уже привязан к org (повторная установка) — сохраняем привязку
    // и статус connected; иначе кладём pending до claim.
    const existing = await this.prisma.bitrixIntegration.findUnique({
      where: { memberId: auth.member_id },
    });
    const keepBinding = existing?.tenantId
      ? { tenantId: existing.tenantId, status: 'connected' as const }
      : { status: 'pending' as const };

    await this.persistTokens(tokens, {
      portalDomain,
      applicationToken: auth.application_token,
      ...keepBinding,
    });
    this.logger.log(
      `ONAPPINSTALL: member=${auth.member_id} domain=${portalDomain} → ${keepBinding.status}`,
    );
  }

  /**
   * Обработчик `ONAPPUNINSTALL`: помечаем `disconnected`. Авторизации в событии
   * нет — подлинность подтверждаем сравнением `application_token` (timing-safe)
   * с сохранённым. На несовпадении — no-op.
   */
  async onAppUninstall(auth: {
    member_id?: string;
    application_token?: string;
  }): Promise<void> {
    if (!auth.member_id) return;
    const row = await this.prisma.bitrixIntegration.findUnique({
      where: { memberId: auth.member_id },
    });
    if (!row) return;
    if (!this.verifyApplicationToken(row, auth.application_token)) {
      this.logger.warn(
        `ONAPPUNINSTALL: неверный application_token для member=${auth.member_id} — игнор`,
      );
      return;
    }
    await this.prisma.bitrixIntegration.update({
      where: { memberId: auth.member_id },
      data: { status: 'disconnected', lastError: 'Приложение удалено в Bitrix24' },
    });
    this.logger.log(`ONAPPUNINSTALL: member=${auth.member_id} → disconnected`);
  }

  /**
   * Claim: привязать pending-установку (по `memberId`) к org Коры. Вызывается из
   * аутентифицированного контекста (iframe-handler после логина в Коре).
   */
  async claim(
    tenantId: string,
    memberId: string,
  ): Promise<BitrixIntegrationResponseDto> {
    const row = await this.prisma.bitrixIntegration.findUnique({
      where: { memberId },
    });
    if (!row) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'bitrix_install_not_found',
          message: 'Установка Bitrix24 не найдена (возможно, истекла)',
        },
      });
    }
    // Уже привязан к ДРУГОЙ org — конфликт.
    if (row.tenantId && row.tenantId !== tenantId) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'bitrix_install_claimed',
          message: 'Этот портал уже подключён к другой компании',
        },
      });
    }
    await this.assertNoForeignActiveBinding(tenantId, memberId);

    await this.prisma.bitrixIntegration.update({
      where: { memberId },
      data: { tenantId, status: 'connected', lastError: null },
    });
    await this.ensureBitrixSource(tenantId);
    const result = await this.getIntegration(tenantId);
    return result as BitrixIntegrationResponseDto;
  }

  // ─────────────────────────── чтение / проверка / отключение ────────

  /** Текущая интеграция org (sanitized, без токенов) или null. */
  async getIntegration(
    tenantId: string,
  ): Promise<BitrixIntegrationResponseDto | null> {
    const row = await this.prisma.bitrixIntegration.findFirst({
      where: { tenantId },
      orderBy: { updatedAt: 'desc' },
    });
    return row ? this.sanitize(row) : null;
  }

  /**
   * Проверка соединения: гарантировать валидный токен (refresh при нужде) и
   * дёрнуть `app.info`. Обновляет `lastConnectedAt`/`status`.
   */
  async testConnection(
    tenantId: string,
  ): Promise<{ ok: true; app: Record<string, unknown> }> {
    const row = await this.requireConnectedRow(tenantId);
    const accessToken = await this.getValidAccessToken(row);
    if (!row.clientEndpoint) {
      throw this.connectionError('Нет client_endpoint портала');
    }
    try {
      const app = await this.client.getAppInfo(row.clientEndpoint, accessToken);
      await this.prisma.bitrixIntegration.update({
        where: { id: row.id },
        data: { status: 'connected', lastError: null, lastConnectedAt: new Date() },
      });
      return { ok: true, app };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Ошибка обращения к Bitrix24';
      await this.markError(row.id, message);
      throw this.connectionError(message);
    }
  }

  /**
   * Отключить интеграцию org (удалить запись). Зеркала (BitrixUser/Dialog/…)
   * НЕ трогаем — это «мягкое» отключение; полный сброс источника делает
   * `SourcesService.hardDelete` (кнопка «удалить источник»). Деактивируем
   * `Source(type='bitrix')`, чтобы он не «висел активным» в списке источников.
   */
  async remove(tenantId: string): Promise<{ ok: true }> {
    await this.prisma.bitrixIntegration.deleteMany({ where: { tenantId } });
    await this.prisma.source
      .updateMany({
        where: { tenantId, type: 'bitrix', name: 'Bitrix24' },
        data: { isActive: false },
      })
      .catch(() => undefined);
    return { ok: true };
  }

  /**
   * Lazy upsert `Source(type='bitrix', name='Bitrix24')` для tenant'а — чтобы
   * Bitrix24 появился в «Источниках» сразу при подключении. Тот же natural-key,
   * что у `BitrixIngestService.upsertSource` (idempotent). Best-effort: ошибка
   * не должна валить connect/claim.
   */
  private async ensureBitrixSource(tenantId: string): Promise<void> {
    await this.prisma.source
      .upsert({
        where: {
          tenantId_type_name: { tenantId, type: 'bitrix', name: 'Bitrix24' },
        },
        create: {
          tenantId,
          type: 'bitrix',
          name: 'Bitrix24',
          dataClass: 'sensitive',
          isActive: true,
        },
        update: { isActive: true },
      })
      .catch((err: unknown) => {
        this.logger.warn(
          `ensureBitrixSource: не удалось создать Source для tenant=${tenantId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  }

  /**
   * Статус источника Bitrix24 для UI: счётчики зеркал, отметки синков, тумблер
   * анализа и разбивка сессий по статусу анализа. Возвращает null, если
   * интеграции нет.
   */
  async getStatus(tenantId: string): Promise<{
    integration: BitrixIntegrationResponseDto;
    analysisEnabled: boolean;
    lastFullSyncAt: string | null;
    lastIncrementalSyncAt: string | null;
    counts: {
      users: number;
      dialogs: number;
      sessions: number;
      contacts: number;
      companies: number;
      deals: number;
      leads: number;
      notes: number;
    };
    sessionsByStatus: { pending: number; analyzing: number; done: number; failed: number };
  } | null> {
    const row = await this.prisma.bitrixIntegration.findFirst({
      where: { tenantId },
      orderBy: { updatedAt: 'desc' },
    });
    if (!row) return null;

    const [
      users,
      dialogs,
      sessions,
      contacts,
      companies,
      deals,
      leads,
      notes,
      pending,
      analyzing,
      done,
      failed,
    ] = await Promise.all([
      this.prisma.bitrixUser.count({ where: { tenantId } }),
      this.prisma.bitrixDialog.count({ where: { tenantId } }),
      this.prisma.bitrixDialogSession.count({ where: { tenantId } }),
      this.prisma.bitrixContact.count({ where: { tenantId } }),
      this.prisma.bitrixCompany.count({ where: { tenantId } }),
      this.prisma.bitrixDeal.count({ where: { tenantId } }),
      this.prisma.bitrixLead.count({ where: { tenantId } }),
      this.prisma.bitrixCrmNote.count({ where: { tenantId } }),
      this.prisma.bitrixDialogSession.count({
        where: { tenantId, analysisStatus: 'pending' },
      }),
      this.prisma.bitrixDialogSession.count({
        where: { tenantId, analysisStatus: 'analyzing' },
      }),
      this.prisma.bitrixDialogSession.count({
        where: { tenantId, analysisStatus: 'done' },
      }),
      this.prisma.bitrixDialogSession.count({
        where: { tenantId, analysisStatus: 'failed' },
      }),
    ]);

    return {
      integration: this.sanitize(row),
      analysisEnabled: row.analysisEnabled,
      lastFullSyncAt: row.lastFullSyncAt?.toISOString() ?? null,
      lastIncrementalSyncAt: row.lastIncrementalSyncAt?.toISOString() ?? null,
      counts: { users, dialogs, sessions, contacts, companies, deals, leads, notes },
      sessionsByStatus: { pending, analyzing, done, failed },
    };
  }

  /**
   * Тумблер AI-анализа диалогов (как у ChatBox). OFF → синк зеркалит диалоги,
   * но LLM (rollup + мост в knowledge-core) не дёргается; ON → крон/пост-синк
   * ставят анализ закрытых сессий. Возвращает новое значение.
   */
  async setAnalysisEnabled(
    tenantId: string,
    enabled: boolean,
  ): Promise<{ ok: true; analysisEnabled: boolean }> {
    const res = await this.prisma.bitrixIntegration.updateMany({
      where: { tenantId },
      data: { analysisEnabled: enabled },
    });
    if (res.count === 0) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'bitrix_not_configured',
          message: 'Интеграция Bitrix24 не подключена',
        },
      });
    }
    return { ok: true, analysisEnabled: enabled };
  }

  // ─────────────────────────── токены ───────────────────────────────

  /**
   * Валидный access_token для записи: если протух (или скоро) — refresh и
   * пересохранение. На провале refresh помечает `status=error` и бросает.
   * Публичен для будущего синк-слоя (вызовы REST с refresh-on-demand).
   */
  async getValidAccessToken(row: BitrixIntegration): Promise<string> {
    const stillValid =
      row.accessExpiresAt &&
      row.accessExpiresAt.getTime() - Date.now() >
        BitrixIntegrationService.EXPIRY_BUFFER_MS;
    if (stillValid) {
      return this.crypto.decrypt(row.accessTokenEnc);
    }

    let tokens: BitrixTokenResponse;
    try {
      tokens = await this.client.refresh(this.crypto.decrypt(row.refreshTokenEnc));
    } catch (err) {
      const message =
        err instanceof BitrixApiError
          ? `${err.code ?? 'refresh_failed'}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'refresh failed';
      await this.markError(row.id, message);
      throw this.connectionError(`Не удалось обновить токен Bitrix24: ${message}`);
    }

    const portalDomain = this.resolveDomain(tokens, row.portalDomain);
    await this.persistTokens(tokens, {
      tenantId: row.tenantId ?? undefined,
      portalDomain,
      status: 'connected',
    });
    return tokens.access_token;
  }

  // ─────────────────── REST с refresh-on-401 (для синка) ─────────────

  /**
   * Вызов REST-метода портала с реактивным refresh: проактивно берём валидный
   * токен (`getValidAccessToken`), а если Bitrix всё равно ответил
   * `expired_token`/`invalid_token` (токен протух раньше буфера) — форсим refresh
   * и повторяем один раз. Используется слоем синка.
   */
  async callApi<T = unknown>(
    row: BitrixIntegration,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const endpoint = this.requireEndpoint(row);
    const token = await this.getValidAccessToken(row);
    try {
      return await this.client.callMethod<T>(endpoint, token, method, params);
    } catch (err) {
      if (err instanceof BitrixApiError && err.isTokenExpired) {
        const fresh = await this.refreshNow(row);
        return this.client.callMethod<T>(endpoint, fresh, method, params);
      }
      throw err;
    }
  }

  /** Списочный вызов с пагинацией + тем же refresh-on-401. */
  async callApiList<T = unknown>(
    row: BitrixIntegration,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T[]> {
    const endpoint = this.requireEndpoint(row);
    const token = await this.getValidAccessToken(row);
    try {
      return await this.client.callMethodList<T>(endpoint, token, method, params);
    } catch (err) {
      if (err instanceof BitrixApiError && err.isTokenExpired) {
        const fresh = await this.refreshNow(row);
        return this.client.callMethodList<T>(endpoint, fresh, method, params);
      }
      throw err;
    }
  }

  /** Форс-refresh токена (реактивно при 401), с перечитыванием свежей строки. */
  private async refreshNow(row: BitrixIntegration): Promise<string> {
    const latest = await this.prisma.bitrixIntegration.findUnique({
      where: { id: row.id },
    });
    if (!latest) {
      throw this.connectionError('Интеграция Bitrix24 не найдена');
    }
    let tokens: BitrixTokenResponse;
    try {
      tokens = await this.client.refresh(
        this.crypto.decrypt(latest.refreshTokenEnc),
      );
    } catch (err) {
      const message =
        err instanceof BitrixApiError
          ? `${err.code ?? 'refresh_failed'}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'refresh failed';
      await this.markError(latest.id, message);
      throw this.connectionError(`Не удалось обновить токен Bitrix24: ${message}`);
    }
    await this.persistTokens(tokens, {
      tenantId: latest.tenantId ?? undefined,
      portalDomain: this.resolveDomain(tokens, latest.portalDomain),
      status: 'connected',
    });
    return tokens.access_token;
  }

  /** clientEndpoint или connection-ошибка (без эндпоинта REST-вызов невозможен). */
  private requireEndpoint(row: BitrixIntegration): string {
    if (!row.clientEndpoint) {
      throw this.connectionError(
        'У интеграции Bitrix24 нет client_endpoint — переподключите портал',
      );
    }
    return row.clientEndpoint;
  }

  // ─────────────────────────── helpers ──────────────────────────────

  /**
   * Upsert по memberId: шифрует и сохраняет токены + метаданные. `applicationToken`
   * шифруется только если передан (есть лишь при ONAPPINSTALL).
   */
  private async persistTokens(
    tokens: BitrixTokenResponse,
    meta: {
      tenantId?: string;
      portalDomain: string;
      status: 'pending' | 'connected';
      applicationToken?: string;
    },
  ): Promise<void> {
    const accessExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    const accessTokenEnc = this.crypto.encrypt(tokens.access_token);
    const refreshTokenEnc = this.crypto.encrypt(tokens.refresh_token);
    const appTokenEnc = meta.applicationToken
      ? this.crypto.encrypt(meta.applicationToken)
      : undefined;

    const common = {
      portalDomain: meta.portalDomain,
      clientEndpoint: tokens.client_endpoint || null,
      serverEndpoint: tokens.server_endpoint ?? null,
      scope: tokens.scope ?? null,
      accessTokenEnc,
      refreshTokenEnc,
      accessExpiresAt,
      status: meta.status,
      lastError: null,
      ...(meta.tenantId !== undefined ? { tenantId: meta.tenantId } : {}),
      ...(appTokenEnc !== undefined ? { applicationTokenEnc: appTokenEnc } : {}),
      ...(meta.status === 'connected' ? { lastConnectedAt: new Date() } : {}),
    };

    await this.prisma.bitrixIntegration.upsert({
      where: { memberId: tokens.member_id },
      create: { memberId: tokens.member_id, ...common },
      update: common,
    });
  }

  /** Запретить привязку портала к org, у которой уже есть ДРУГОЙ активный портал. */
  private async assertNoForeignActiveBinding(
    tenantId: string,
    memberId: string,
  ): Promise<void> {
    const other = await this.prisma.bitrixIntegration.findFirst({
      where: {
        tenantId,
        status: 'connected',
        memberId: { not: memberId },
      },
      select: { id: true },
    });
    if (other) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'bitrix_already_connected',
          message:
            'К этой компании уже подключён другой портал Bitrix24. Сначала отключите его.',
        },
      });
    }
  }

  private async requireConnectedRow(
    tenantId: string,
  ): Promise<BitrixIntegration> {
    const row = await this.prisma.bitrixIntegration.findFirst({
      where: { tenantId, status: { in: ['connected', 'error'] } },
      orderBy: { updatedAt: 'desc' },
    });
    if (!row) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'bitrix_not_connected',
          message: 'Интеграция Bitrix24 не подключена',
        },
      });
    }
    return row;
  }

  private async markError(id: string, message: string): Promise<void> {
    await this.prisma.bitrixIntegration
      .update({
        where: { id },
        data: { status: 'error', lastError: message.slice(0, 2000) },
      })
      .catch(() => undefined);
  }

  private verifyApplicationToken(
    row: BitrixIntegration,
    incoming: string | undefined,
  ): boolean {
    if (!incoming || !row.applicationTokenEnc) return false;
    let stored: string;
    try {
      stored = this.crypto.decrypt(row.applicationTokenEnc);
    } catch {
      return false;
    }
    if (stored.length !== incoming.length) return false;
    return timingSafeEqual(
      Buffer.from(stored, 'utf8'),
      Buffer.from(incoming, 'utf8'),
    );
  }

  /** Домен портала: из client_endpoint OAuth-ответа, иначе из переданного. */
  private resolveDomain(tokens: BitrixTokenResponse, fallback: string): string {
    if (tokens.client_endpoint) {
      try {
        return new URL(tokens.client_endpoint).host.toLowerCase();
      } catch {
        // fall through
      }
    }
    if (tokens.domain) return tokens.domain.toLowerCase();
    return fallback.toLowerCase();
  }

  private sanitize(row: BitrixIntegration): BitrixIntegrationResponseDto {
    return {
      id: row.id,
      portalDomain: row.portalDomain,
      status: row.status,
      scope: row.scope ?? null,
      hasTokens: Boolean(row.accessTokenEnc && row.refreshTokenEnc),
      lastError: row.lastError ?? null,
      accessExpiresAt: row.accessExpiresAt?.toISOString() ?? null,
      lastConnectedAt: row.lastConnectedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private misconfigured(): BadRequestException {
    return new BadRequestException({
      ok: false,
      error: {
        code: 'bitrix_misconfigured',
        message:
          'Интеграция Bitrix24 не настроена на сервере (нет client_id/secret приложения)',
      },
    });
  }

  private connectionError(message: string): BadRequestException {
    return new BadRequestException({
      ok: false,
      error: { code: 'bitrix_connection_error', message },
    });
  }
}
