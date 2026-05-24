import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import {
  CreateHolidaySchema,
  type CreateHolidayDto,
  type HolidayResponseDto,
  ListHolidaysQuerySchema,
  type ListHolidaysQuery,
  type ListHolidaysResponse,
} from '../dto/holidays/holidays.dto';

/**
 * REST `/api/v1/holidays` — производственный календарь.
 *
 *   - GET — список праздников за год: per-tenant override + глобальный РФ-календарь
 *     (если `tenantOnly=false`). Доступно любому авторизованному в Org (читает project).
 *   - POST — per-tenant override (RBAC: write на `project`, т.е. admin/owner Org).
 *
 * Глобальные записи (`tenantId=null`) создаются seed-скриптом
 * `backend/scripts/seed-holiday-calendar-ru-2026.ts` — через POST их добавить нельзя.
 */
@ApiTags('tracker / holidays')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class HolidaysController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('holidays')
  @ApiOperation({ summary: 'Список праздников года (per-tenant + глобальные)' })
  async list(
    @Query(new ZodValidationPipe(ListHolidaysQuerySchema))
    query: ListHolidaysQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListHolidaysResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const yearStart = new Date(Date.UTC(query.year, 0, 1));
    const yearEnd = new Date(Date.UTC(query.year + 1, 0, 1));
    const tenantFilter = query.tenantOnly
      ? { tenantId: t }
      : { OR: [{ tenantId: t }, { tenantId: null }] };
    const rows = await this.prisma.holidayCalendar.findMany({
      where: {
        ...tenantFilter,
        date: { gte: yearStart, lt: yearEnd },
      },
      orderBy: { date: 'asc' },
    });
    return {
      year: query.year,
      items: rows.map((r) => HolidaysController.toResponse(r)),
    };
  }

  @Post('holidays')
  @ApiOperation({ summary: 'Добавить per-tenant override (admin/owner)' })
  async create(
    @Body(new ZodValidationPipe(CreateHolidaySchema))
    body: CreateHolidayDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<HolidayResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    const date = new Date(`${body.date}T00:00:00.000Z`);
    const existing = await this.prisma.holidayCalendar.findFirst({
      where: { tenantId: t, date },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'holiday_already_exists',
          message: 'Запись на эту дату уже существует',
        },
      });
    }
    const created = await this.prisma.holidayCalendar.create({
      data: {
        tenantId: t,
        date,
        name: body.name,
        isWorking: body.isWorking,
      },
    });
    return HolidaysController.toResponse(created);
  }

  private static toResponse(row: {
    id: string;
    tenantId: string | null;
    date: Date;
    name: string;
    isWorking: boolean;
  }): HolidayResponseDto {
    const iso = row.date.toISOString().slice(0, 10);
    return {
      id: row.id,
      date: iso,
      name: row.name,
      isWorking: row.isWorking,
      tenantId: row.tenantId,
    };
  }

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Организация не определена' },
      });
    }
    return tenantId;
  }

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'project');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав на чтение календаря' },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'project');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Только admin / owner могут изменять календарь',
        },
      });
    }
  }
}
