import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import jwt, { type SignOptions } from 'jsonwebtoken';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RbacService } from '../../rbac/rbac.service';

import {
  ServiceMapGeneratorService,
  type ToolSchema,
} from './service-map-generator.service';

/**
 * SBA γ-2 — ToolRouterService.
 *
 * Получает (toolName, args, userId, tenantId) → проверяет whitelist +
 * RBAC + базовую валидацию аргументов → выполняет tool через internal
 * HTTP call (axios на localhost:PORT/api/v1/... с request-id) и возвращает
 * result.
 *
 * Важно (§17 ТЗ):
 *   - RBAC проверяется ОТ userId — concierge НЕ bypassит permissions.
 *   - Если tool мутирующий и undoableVia задан — после выполнения caller
 *     должен записать ConciergeUndoLog (это делает ConciergeService).
 *   - Tool без undoableVia → mutating == true должен confirm'нуться на UI
 *     (concierge.service подмешает в SSE event 'requires_confirm').
 *
 * NB: на MVP — direct in-process вызов через fetch на localhost, чтобы
 * не дублировать бизнес-логику и не обходить guard'ы. vNext — DiscoveryService
 * + direct service call с TenantGuard context.
 *
 * Ф4 (ТЗ 2026-06-11 assistant-channels): два режима аутентификации loopback:
 *   - `authMode: 'cookie'` (default) — passthrough cookie из исходного HTTP
 *     запроса (web-чат). Поведение бит-в-бит как до Ф4.
 *   - `authMode: 'service'` — канал (Telegram/MAX) без HTTP-cookie: ToolRouter
 *     сам минтит короткоживущую (60с) self-signed session JWT для userId
 *     (sub/email/role из Prisma User, БЕЗ jti → CookieAuthGuard не ходит в
 *     UserSession) и шлёт её как `Cookie: z_session=<jwt>`. Guard'ы/RBAC/
 *     TenantGuard работают как для живого пользователя.
 */

/** TTL self-signed session JWT в service-режиме — 60 секунд, минт дёшев. */
const SERVICE_SESSION_TTL_SECONDS = 60;
/** Имя session-cookie — то же, что читает CookieAuthGuard. */
const SESSION_COOKIE_NAME = 'z_session';
// Константы подписи — зеркало auth/services/jwt.service.ts (ISSUER/AUDIENCE/
// ALGORITHM). Должны совпадать, иначе CookieAuthGuard.verifySession отклонит.
const JWT_ISSUER = 'z';
const JWT_AUDIENCE = 'z';
const JWT_ALGORITHM: jwt.Algorithm = 'HS256';

export interface ExecuteToolInput {
  toolName: string;
  args: Record<string, unknown>;
  userId: string;
  tenantId: string;
  /**
   * Режим аутентификации loopback-вызова. Default `'cookie'` — прежнее
   * поведение (web-чат, passthrough `authCookie`). `'service'` — для каналов
   * без HTTP-запроса (Telegram/MAX): `authCookie` игнорируется, минтится
   * self-signed короткоживущая session JWT.
   */
  authMode?: 'cookie' | 'service';
  /** Cookie из исходного запроса для passthrough аутентификации (cookie-режим). */
  authCookie?: string;
  /**
   * Базовый URL backend'а (для in-process loopback). Обязателен в
   * cookie-режиме; в service-режиме при отсутствии берётся из
   * `TypedConfigService.concierge.loopbackBaseUrl` (ENV `CONCIERGE_LOOPBACK_BASE_URL`).
   */
  baseUrl?: string;
}

export interface ExecuteToolResult {
  tool: ToolSchema;
  ok: boolean;
  status: number;
  result: unknown;
  errorMessage?: string;
}

@Injectable()
export class ToolRouterService {
  private readonly logger = new Logger(ToolRouterService.name);

  constructor(
    @Inject(ServiceMapGeneratorService)
    private readonly serviceMap: ServiceMapGeneratorService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async execute(input: ExecuteToolInput): Promise<ExecuteToolResult> {
    const tool = this.serviceMap.findTool(input.toolName);
    if (!tool) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'tool_not_whitelisted',
          message: `Tool '${input.toolName}' не входит в whitelist Concierge`,
        },
      });
    }

    // Базовая валидация: required параметры присутствуют.
    const missing =
      tool.parameters.required?.filter(
        (k) =>
          input.args[k] === undefined ||
          input.args[k] === null ||
          input.args[k] === '',
      ) ?? [];
    if (missing.length > 0) {
      return {
        tool,
        ok: false,
        status: 400,
        result: null,
        errorMessage: `Не хватает параметров: ${missing.join(', ')}`,
      };
    }

    // RBAC: concierge НЕ обходит. Если rbacResource задан — проверяем.
    if (tool.rbacResource) {
      const allowed = await this.rbac.check({
        userId: input.userId,
        tenantId: input.tenantId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        obj: tool.rbacResource as any,
        act: tool.rbacAction ?? 'read',
      });
      if (!allowed) {
        this.metrics.incConciergeToolCall?.({
          tenantTop: this.tenantTop(input.tenantId),
          tool: tool.name,
          status: 'forbidden',
        });
        return {
          tool,
          ok: false,
          status: 403,
          result: null,
          errorMessage: `RBAC: у вас нет прав на ${tool.rbacResource}/${tool.rbacAction}`,
        };
      }
    }

    // Ф4: аутентификация loopback-вызова. RBAC уже проверен выше — в обоих
    // режимах ДО fetch. В service-режиме минтим self-signed session JWT
    // (60с, без jti), authCookie из input игнорируется.
    const authMode = input.authMode ?? 'cookie';
    let cookieHeader = input.authCookie;
    if (authMode === 'service') {
      const token = await this.mintServiceSessionToken(input.userId);
      if (!token) {
        this.metrics.incConciergeToolCall?.({
          tenantTop: this.tenantTop(input.tenantId),
          tool: tool.name,
          status: 'forbidden',
        });
        return {
          tool,
          ok: false,
          status: 403,
          result: null,
          errorMessage:
            'Service-auth: пользователь не найден или деактивирован',
        };
      }
      cookieHeader = `${SESSION_COOKIE_NAME}=${token}`;
    }

    // baseUrl: cookie-режим — приходит из исходного HTTP-запроса; service —
    // fallback на сконфигурированный loopback (у канала нет req).
    const baseUrl = input.baseUrl?.trim()
      ? input.baseUrl
      : authMode === 'service'
        ? this.cfg.concierge.loopbackBaseUrl
        : undefined;
    if (!baseUrl) {
      return {
        tool,
        ok: false,
        status: 500,
        result: null,
        errorMessage: 'baseUrl не задан для loopback-вызова (cookie-режим)',
      };
    }

    // Подставляем path-параметры (e.g. :id) из args.
    let path = tool.path;
    for (const [k, v] of Object.entries(input.args)) {
      if (path.includes(`:${k}`)) {
        path = path.replace(`:${k}`, encodeURIComponent(String(v)));
      }
    }

    // Тело и query — простая эвристика.
    let url = `${baseUrl.replace(/\/+$/, '')}${path}`;
    let body: string | undefined;
    if (tool.method === 'GET' || tool.method === 'DELETE') {
      const usp = new URLSearchParams();
      for (const [k, v] of Object.entries(input.args)) {
        if (path.includes(`:${k}`)) continue;
        if (v === undefined || v === null) continue;
        usp.set(k, String(v));
      }
      const qs = usp.toString();
      if (qs) url += `?${qs}`;
    } else {
      const bodyArgs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input.args)) {
        if (path.includes(`:${k}`)) continue;
        bodyArgs[k] = v;
      }
      body = JSON.stringify(bodyArgs);
    }

    try {
      const res = await fetch(url, {
        method: tool.method,
        headers: {
          'Content-Type': 'application/json',
          'X-Org-Id': input.tenantId,
          'X-Concierge-Origin': 'true',
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        ...(body ? { body } : {}),
      });
      const status = res.status;
      let result: unknown = null;
      const text = await res.text();
      try {
        result = text ? JSON.parse(text) : null;
      } catch {
        result = text;
      }
      const ok = status >= 200 && status < 300;
      this.metrics.incConciergeToolCall?.({
        tenantTop: this.tenantTop(input.tenantId),
        tool: tool.name,
        status: ok ? 'ok' : 'error',
      });
      return {
        tool,
        ok,
        status,
        result,
        ...(ok ? {} : { errorMessage: `HTTP ${status}` }),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        { tool: tool.name, err: message },
        'ToolRouter.execute: HTTP call failed',
      );
      this.metrics.incConciergeToolCall?.({
        tenantTop: this.tenantTop(input.tenantId),
        tool: tool.name,
        status: 'error',
      });
      return { tool, ok: false, status: 500, result: null, errorMessage: message };
    }
  }

  /**
   * Ф4: self-signed session JWT для service-режима (каналы Telegram/MAX).
   *
   * Payload — {sub, email, role} (то, что CookieAuthGuard кладёт в
   * request.user), подпись — тем же `auth.sessionSecret`/HS256/issuer/audience,
   * что и `JwtService.signSession`. БЕЗ jti → guard пропускает БД-проверку
   * `UserSession` (ветка legacy). TTL 60с — токен живёт только на время
   * loopback-вызова, не кэшируется.
   *
   * @returns подписанный JWT или `null`, если user не найден / soft-deleted.
   */
  private async mintServiceSessionToken(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, role: true, deletedAt: true },
    });
    if (!user || user.deletedAt !== null) {
      this.logger.warn(
        { userId },
        'ToolRouter.mintServiceSessionToken: user не найден или удалён',
      );
      return null;
    }
    const options: SignOptions = {
      algorithm: JWT_ALGORITHM,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: SERVICE_SESSION_TTL_SECONDS,
    };
    return jwt.sign(
      { sub: userId, email: user.email, role: user.role },
      this.cfg.auth.sessionSecret,
      options,
    );
  }

  private tenantTop(tenantId: string): string {
    let h = 0;
    for (let i = 0; i < tenantId.length; i++) {
      h = (h * 31 + tenantId.charCodeAt(i)) >>> 0;
    }
    return `bucket_${(h % 100).toString().padStart(2, '0')}`;
  }
}
