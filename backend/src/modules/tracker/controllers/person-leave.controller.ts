import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { RequireSubscription } from '../../billing/guards/require-subscription.decorator';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import {
  CreatePersonLeaveSchema,
  type CreatePersonLeaveDto,
  ListPersonLeavesQuerySchema,
  type ListPersonLeavesQuery,
  type ListPersonLeavesResponse,
  type PersonLeaveResponseDto,
} from '../dto/person-leaves/person-leaves.dto';

@ApiTags('tracker / person-leaves')
@ApiBearerAuth()
@Controller('api/v1/admin')
@UseGuards(CookieAuthGuard, TenantGuard)
export class PersonLeaveController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('person-leaves')
  @ApiOperation({ summary: 'Список отпусков/отсутствий сотрудников' })
  async list(
    @Query(new ZodValidationPipe(ListPersonLeavesQuerySchema))
    query: ListPersonLeavesQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListPersonLeavesResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const fromFilter = query.from
      ? { toDate: { gte: new Date(`${query.from}T00:00:00.000Z`) } }
      : {};
    const toFilter = query.to ? { fromDate: { lte: new Date(`${query.to}T00:00:00.000Z`) } } : {};
    const rows = await this.prisma.personLeave.findMany({
      where: {
        tenantId: t,
        ...(query.personId ? { personId: query.personId } : {}),
        ...fromFilter,
        ...toFilter,
      },
      orderBy: { fromDate: 'asc' },
    });
    return { items: rows.map((r) => PersonLeaveController.toResponse(r)) };
  }

  @Post('person-leaves')
  @RequireSubscription()
  @ApiOperation({ summary: 'Добавить отпуск/отсутствие' })
  async create(
    @Body(new ZodValidationPipe(CreatePersonLeaveSchema))
    body: CreatePersonLeaveDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<PersonLeaveResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    const fromDate = new Date(`${body.fromDate}T00:00:00.000Z`);
    const toDate = new Date(`${body.toDate}T00:00:00.000Z`);
    if (toDate < fromDate) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'invalid_range', message: 'Дата окончания раньше даты начала' },
      });
    }
    const created = await this.prisma.personLeave.create({
      data: {
        tenantId: t,
        personId: body.personId,
        fromDate,
        toDate,
        kind: body.kind,
        comment: body.comment ?? null,
      },
    });
    return PersonLeaveController.toResponse(created);
  }

  @Delete('person-leaves/:id')
  @ApiOperation({ summary: 'Удалить отпуск/отсутствие' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    const { count } = await this.prisma.personLeave.deleteMany({ where: { id, tenantId: t } });
    if (count === 0) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'not_found', message: 'Запись не найдена' },
      });
    }
    return { ok: true };
  }

  private static toResponse(row: {
    id: string;
    personId: string;
    fromDate: Date;
    toDate: Date;
    kind: string;
    comment: string | null;
  }): PersonLeaveResponseDto {
    return {
      id: row.id,
      personId: row.personId,
      fromDate: row.fromDate.toISOString().slice(0, 10),
      toDate: row.toDate.toISOString().slice(0, 10),
      kind: row.kind,
      comment: row.comment ?? null,
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
