import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import jwt, { type SignOptions } from 'jsonwebtoken';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RbacService } from '../../rbac/rbac.service';

import { ServiceMapGeneratorService, type ToolSchema } from './service-map-generator.service';

const SERVICE_SESSION_TTL_SECONDS = 60;
const SESSION_COOKIE_NAME = 'z_session';
const JWT_ISSUER = 'z';
const JWT_AUDIENCE = 'z';
const JWT_ALGORITHM: jwt.Algorithm = 'HS256';

export interface ExecuteToolInput {
  toolName: string;
  args: Record<string, unknown>;
  userId: string;
  tenantId: string;
  authMode?: 'cookie' | 'service';
  authCookie?: string;
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

    const missing =
      tool.parameters.required?.filter(
        (k) => input.args[k] === undefined || input.args[k] === null || input.args[k] === '',
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
          errorMessage: 'Service-auth: пользователь не найден или деактивирован',
        };
      }
      cookieHeader = `${SESSION_COOKIE_NAME}=${token}`;
    }

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

    let path = tool.path;
    for (const [k, v] of Object.entries(input.args)) {
      if (path.includes(`:${k}`)) {
        path = path.replace(`:${k}`, encodeURIComponent(String(v)));
      }
    }

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
      this.logger.error({ tool: tool.name, err: message }, 'ToolRouter.execute: HTTP call failed');
      this.metrics.incConciergeToolCall?.({
        tenantTop: this.tenantTop(input.tenantId),
        tool: tool.name,
        status: 'error',
      });
      return { tool, ok: false, status: 500, result: null, errorMessage: message };
    }
  }

  private async mintServiceSessionToken(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, role: true, deletedAt: true },
    });
    if (!user || user.deletedAt !== null) {
      this.logger.warn({ userId }, 'ToolRouter.mintServiceSessionToken: user не найден или удалён');
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
