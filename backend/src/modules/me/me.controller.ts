import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';

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

import {
  MeService,
  type MeProfileDto,
  type MeWorkProfileDto,
} from './me.service';

interface AccessLogItemDto {
  accessedAt: string;
  viewerUserName: string | null;
  viewerUserEmail: string | null;
  sectionAccessed: string;
}

/**
 * TZ-1 Фаза 0 (daily-value-engine) — body для PATCH /me/notification-preferences.
 * Все поля опциональны (частичное обновление). Хранятся в preferences
 * in_app-ChannelBinding текущего пользователя; их читает
 * NotificationBudgetService при решении о push-доставке.
 */
const NotificationPreferencesSchema = z
  .object({
    /** eventType'ы, от которых отписаться (push не приходит; in_app остаётся). */
    optOutEventTypes: z.array(z.string().min(1)).max(100).optional(),
    /** Час начала тихих часов 0..23 (перекрывает дефолт). */
    quietHoursStart: z.number().int().min(0).max(23).optional(),
    /** Час конца тихих часов 0..23 (перекрывает дефолт). */
    quietHoursEnd: z.number().int().min(0).max(23).optional(),
  })
  .strict();

type NotificationPreferencesBody = z.infer<typeof NotificationPreferencesSchema>;

/**
 * ТЗ 2026-06-18 (assistant-calendar-master) Ф4 — body для
 * PATCH /me/work-profile. Все поля опциональны (частичное обновление); должно
 * быть передано хотя бы одно. Хранятся на Person текущего пользователя; их
 * читают расчёты «сегодня/рабочее время» и помощник (set_my_work_profile).
 */
const WorkProfilePatchSchema = z
  .object({
    /** IANA-таймзона (валидируется в сервисе через isValidTimezone). */
    timezone: z.string().trim().min(1).max(64).optional(),
    /** Час начала рабочего дня 0..23. */
    workStartHour: z.number().int().min(0).max(23).optional(),
    /** Час конца рабочего дня 0..23. */
    workEndHour: z.number().int().min(0).max(23).optional(),
    /** Рабочие дни: 0=вс..6=сб (до 7 значений). */
    workingDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Передайте хотя бы одно поле',
  });

type WorkProfileBody = z.infer<typeof WorkProfilePatchSchema>;

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
   * ТЗ 2026-06-18 (assistant-calendar-master) Ф4 — мой рабочий профиль
   * (эффективная таймзона + рабочие часы + рабочие дни). Поля живут на Person;
   * NULL/[] заменяются дефолтами из AdminSetting.
   */
  @Get('work-profile')
  @ApiOperation({
    summary:
      'Мой рабочий профиль: таймзона, рабочие часы и дни (с дефолтами компании)',
  })
  async getWorkProfile(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<MeWorkProfileDto> {
    const t = this.requireTenant(tenantId);
    return this.svc.getWorkProfile({ tenantId: t, userId: user.id });
  }

  /**
   * ТЗ 2026-06-18 (assistant-calendar-master) Ф4 — сохранить рабочий профиль
   * (частично): таймзона / рабочие часы / рабочие дни. Этот же эндпоинт дёргает
   * помощник через инструмент `set_my_work_profile`.
   */
  @Patch('work-profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Сохранить мой рабочий профиль: таймзона, рабочие часы и дни',
  })
  @ApiOkResponse({ description: 'Обновлённый эффективный рабочий профиль' })
  async updateWorkProfile(
    @Body(new ZodValidationPipe(WorkProfilePatchSchema)) body: WorkProfileBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<MeWorkProfileDto> {
    const t = this.requireTenant(tenantId);
    return this.svc.updateWorkProfile({
      tenantId: t,
      userId: user.id,
      patch: body,
    });
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

  /**
   * TZ-1 Фаза 0 (daily-value-engine) — настройки уведомлений текущего
   * пользователя (opt-out по eventType + личное окно тихих часов). Хранится в
   * preferences in_app-ChannelBinding'а (переиспользуем существующий механизм
   * preferences, без новой колонки). Читается NotificationBudgetService.
   */
  @Patch('notification-preferences')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Настройки моих уведомлений: отписка по типам + личные тихие часы (push)',
  })
  @ApiOkResponse({ description: '{ ok: true }' })
  async updateNotificationPreferences(
    @Body(new ZodValidationPipe(NotificationPreferencesSchema))
    body: NotificationPreferencesBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    if (
      body.quietHoursStart !== undefined &&
      body.quietHoursEnd !== undefined &&
      body.quietHoursStart === body.quietHoursEnd
    ) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invalid_quiet_hours',
          message: 'Начало и конец тихих часов не должны совпадать',
        },
      });
    }

    // Гарантируем наличие in_app-канала + binding'а текущего пользователя.
    const channel = await this.prisma.channel.upsert({
      where: { tenantId_kind: { tenantId: t, kind: 'in_app' } },
      update: {},
      create: {
        tenantId: t,
        kind: 'in_app',
        direction: 'bidirectional',
        maxDataClass: 'private',
        status: 'active',
      },
      select: { id: true },
    });
    const binding = await this.prisma.channelBinding.upsert({
      where: {
        channelId_externalId: { channelId: channel.id, externalId: user.id },
      },
      update: {},
      create: {
        userId: user.id,
        channelId: channel.id,
        externalId: user.id,
        verifiedAt: new Date(),
      },
      select: { id: true, preferences: true },
    });

    const prev =
      binding.preferences &&
      typeof binding.preferences === 'object' &&
      !Array.isArray(binding.preferences)
        ? (binding.preferences as Record<string, unknown>)
        : {};
    const next: Record<string, unknown> = { ...prev };
    if (body.optOutEventTypes !== undefined) {
      next['notificationOptOutEventTypes'] = body.optOutEventTypes;
    }
    if (body.quietHoursStart !== undefined) {
      next['notificationQuietHoursStart'] = body.quietHoursStart;
    }
    if (body.quietHoursEnd !== undefined) {
      next['notificationQuietHoursEnd'] = body.quietHoursEnd;
    }

    await this.prisma.channelBinding.update({
      where: { id: binding.id },
      data: { preferences: next as Prisma.InputJsonValue },
    });
    return { ok: true };
  }

  /**
   * ТЗ coo-orphan-agents Ф8 — чтение моих настроек уведомлений (для UI-галочек).
   * Зеркало PATCH: читает preferences in_app-ChannelBinding текущего пользователя.
   */
  @Get('notification-preferences')
  @ApiOperation({
    summary: 'Мои настройки уведомлений (opt-out типы + тихие часы)',
  })
  async getNotificationPreferences(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{
    optOutEventTypes: string[];
    quietHoursStart: number | null;
    quietHoursEnd: number | null;
  }> {
    const t = this.requireTenant(tenantId);
    const channel = await this.prisma.channel.findUnique({
      where: { tenantId_kind: { tenantId: t, kind: 'in_app' } },
      select: { id: true },
    });
    const empty = {
      optOutEventTypes: [],
      quietHoursStart: null,
      quietHoursEnd: null,
    };
    if (!channel) return empty;
    const binding = await this.prisma.channelBinding.findUnique({
      where: {
        channelId_externalId: { channelId: channel.id, externalId: user.id },
      },
      select: { preferences: true },
    });
    const prefs =
      binding?.preferences &&
      typeof binding.preferences === 'object' &&
      !Array.isArray(binding.preferences)
        ? (binding.preferences as Record<string, unknown>)
        : {};
    const optOut = Array.isArray(prefs['notificationOptOutEventTypes'])
      ? (prefs['notificationOptOutEventTypes'] as unknown[]).filter(
          (x): x is string => typeof x === 'string',
        )
      : [];
    const qhs =
      typeof prefs['notificationQuietHoursStart'] === 'number'
        ? (prefs['notificationQuietHoursStart'] as number)
        : null;
    const qhe =
      typeof prefs['notificationQuietHoursEnd'] === 'number'
        ? (prefs['notificationQuietHoursEnd'] as number)
        : null;
    return { optOutEventTypes: optOut, quietHoursStart: qhs, quietHoursEnd: qhe };
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
