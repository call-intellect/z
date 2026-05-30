import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import {
  ConsentUpsertSchema,
  type ConsentUpsertBody,
} from '../onboarding/dto/consent.dto';
import {
  ConsentService,
  type ConsentDataType,
  type ConsentRecordDto,
} from '../onboarding/services/consent.service';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { IpHashingService } from '../security/ip-hashing.service';

import { MeService, type MeProfileDto } from './me.service';

interface AccessLogItemDto {
  accessedAt: string;
  viewerUserName: string | null;
  viewerUserEmail: string | null;
  sectionAccessed: string;
}

/**
 * `GET /api/v1/me/profile` — кто я в контексте текущей Org (X-Org-Id).
 *
 * Pulse Wave 4 §4.1-4.2 — Compliance endpoints:
 *   - `POST/GET /api/v1/me/consents` — управление согласиями 152-ФЗ.
 *   - `GET     /api/v1/me/privacy/access-log` — кто открывал мою карточку.
 */
@ApiTags('me')
@Controller('api/v1/me')
@UseGuards(CookieAuthGuard, TenantGuard)
export class MeController {
  constructor(
    @Inject(MeService) private readonly svc: MeService,
    @Inject(ConsentService) private readonly consents: ConsentService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IpHashingService) private readonly ipHasher: IpHashingService,
  ) {}

  @Get('profile')
  @ApiOperation({ summary: 'Профиль текущего пользователя в текущей Org' })
  async profile(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<MeProfileDto> {
    const t = this.requireTenant(tenantId);
    return this.svc.getProfile({ tenantId: t, userId: user.id });
  }

  /**
   * Pulse Wave 4 §4.1 — текущее состояние согласий 152-ФЗ.
   */
  @Get('consents')
  @ApiOperation({ summary: 'Мои активные согласия 152-ФЗ (последняя запись per dataType)' })
  @ApiOkResponse({ description: '{ items: ConsentRecordDto[] }' })
  async getMyConsents(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: ConsentRecordDto[] }> {
    const t = this.requireTenant(tenantId);
    const person = await this.findMyPerson({ tenantId: t, userId: user.id });
    if (!person) return { items: [] };
    const items = await this.consents.getActiveConsents({
      tenantId: t,
      personId: person.id,
    });
    return { items };
  }

  /**
   * Pulse Wave 4 §4.1 — выдать или отозвать согласие.
   * Каждый POST = новая запись `ConsentLog` (append-only).
   */
  @Post('consents')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Выдать или отозвать согласие 152-ФЗ (per dataType)' })
  @ApiOkResponse({ description: '{ ok: true }' })
  async upsertConsent(
    @Body(new ZodValidationPipe(ConsentUpsertSchema)) body: ConsentUpsertBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    const person = await this.findMyPerson({ tenantId: t, userId: user.id });
    if (!person) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'person_not_found',
          message: 'Не найден Person для текущего пользователя в этой Org',
        },
      });
    }
    const ipHash = this.extractIpHash(req);
    const userAgent = this.extractUserAgent(req);
    await this.consents.recordConsent({
      tenantId: t,
      personId: person.id,
      dataType: body.dataType as ConsentDataType,
      consented: body.consented,
      policyVersion: body.policyVersion,
      ...(ipHash !== null ? { ipHash } : {}),
      ...(userAgent !== null ? { userAgent } : {}),
    });
    return { ok: true };
  }

  /**
   * Pulse Wave 4 §4.2 — кто и когда открывал мою pulse-карточку.
   * Записи копит `KnowledgeAccessLoggerInterceptor` на `PersonsController`.
   */
  @Get('privacy/access-log')
  @ApiOperation({ summary: 'История просмотров моей карточки (audit log)' })
  async getMyAccessLog(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
    @Query('limit') limit?: string,
  ): Promise<{ items: AccessLogItemDto[] }> {
    const t = this.requireTenant(tenantId);
    const person = await this.findMyPerson({ tenantId: t, userId: user.id });
    if (!person) return { items: [] };

    const parsedLimit = Number.parseInt(limit ?? '', 10);
    const lim =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 200)
        : 50;

    const logs = await this.prisma.knowledgeAccessLog.findMany({
      where: { tenantId: t, viewedPersonId: person.id },
      orderBy: { accessedAt: 'desc' },
      take: lim,
    });

    if (logs.length === 0) return { items: [] };

    const userIds = Array.from(new Set(logs.map((l) => l.viewerUserId)));
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const items: AccessLogItemDto[] = logs.map((l) => ({
      accessedAt: l.accessedAt.toISOString(),
      viewerUserName: userMap.get(l.viewerUserId)?.name ?? null,
      viewerUserEmail: userMap.get(l.viewerUserId)?.email ?? null,
      sectionAccessed: l.sectionAccessed,
    }));
    return { items };
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

  private async findMyPerson(args: {
    tenantId: string;
    userId: string;
  }): Promise<{ id: string } | null> {
    return this.prisma.person.findFirst({
      where: {
        tenantId: args.tenantId,
        userId: args.userId,
        deletedAt: null,
      },
      select: { id: true },
    });
  }

  private extractIpHash(req: Request): string | null {
    const xff = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
    const ip = xff ?? req.socket?.remoteAddress ?? null;
    if (!ip) return null;
    try {
      return this.ipHasher.hashIp(ip);
    } catch {
      return null;
    }
  }

  private extractUserAgent(req: Request): string | null {
    const ua = req.headers['user-agent'];
    if (typeof ua !== 'string' || ua.length === 0) return null;
    return ua.slice(0, 1000);
  }
}
