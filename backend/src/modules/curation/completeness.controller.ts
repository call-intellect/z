import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import {
  ListCompletenessSlotsQuerySchema,
  MarkCompletenessSlotFilledBodySchema,
  type CompletenessParentCardTypeDto,
  type CompletenessSlotDto,
  type CompletenessSlotKindDto,
  type ListCompletenessSlotsQuery,
  type ListCompletenessSlotsResponse,
  type MarkCompletenessSlotFilledBody,
} from './dto/curation.dto';
import { CompletenessScannerService } from './workers/completeness-scanner.cron';

@ApiTags('curation')
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class CompletenessController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(CompletenessScannerService)
    private readonly scanner: CompletenessScannerService,
  ) {}

  @Get('curation/completeness-slots')
  @ApiOperation({
    summary:
      'Список слотов «незаполненных полей» нормативных карточек (фильтры по cardType / cardId / status).',
  })
  async listSlots(
    @Query(new ZodValidationPipe(ListCompletenessSlotsQuerySchema))
    query: ListCompletenessSlotsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListCompletenessSlotsResponse> {
    const t = this.requireTenant(tenantId);
    const ok = await this.rbac.canRead(user.id, t, 'completeness_slot', user.id);
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для просмотра карты пробелов',
        },
      });
    }

    const where: Prisma.CompletenessSlotWhereInput = { tenantId: t };
    if (query.cardType) where.parentCardType = query.cardType;
    if (query.cardId) where.parentCardId = query.cardId;
    if (query.status === 'open') where.filledAt = null;
    if (query.status === 'filled') where.filledAt = { not: null };

    const [rows, totalCount] = await Promise.all([
      this.prisma.completenessSlot.findMany({
        where,
        orderBy: [{ parentCardType: 'asc' }, { slotName: 'asc' }],
        take: query.take,
        skip: query.skip,
      }),
      this.prisma.completenessSlot.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toDto(r)),
      totalCount,
    };
  }

  @Post('curation/completeness-slots/:id/mark-filled')
  @ApiOperation({
    summary: 'Вручную пометить CompletenessSlot заполненным (curation.write).',
  })
  async markFilled(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(MarkCompletenessSlotFilledBodySchema))
    body: MarkCompletenessSlotFilledBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<CompletenessSlotDto> {
    const t = this.requireTenant(tenantId);
    const slot = await this.prisma.completenessSlot.findUnique({
      where: { id },
    });
    if (!slot || slot.tenantId !== t) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'completeness_slot_not_found',
          message: 'Слот не найден',
        },
      });
    }
    const ok = await this.rbac.canWrite(user.id, t, 'completeness_slot', user.id);
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для закрытия слота',
        },
      });
    }
    if (slot.filledAt) {
      return this.toDto(slot);
    }
    const filledBy = body.filledByUserId ?? user.id;
    const updated = await this.prisma.completenessSlot.update({
      where: { id: slot.id },
      data: {
        filledAt: new Date(),
        filledByUserId: filledBy,
      },
    });
    this.scanner.noteManualFilled(slot.parentCardType);
    return this.toDto(updated);
  }

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    return tenantId;
  }

  private toDto(row: {
    id: string;
    tenantId: string;
    parentCardType: string;
    parentCardId: string;
    slotName: string;
    slotKind: string;
    filledAt: Date | null;
    filledByUserId: string | null;
    lastProbedAt: Date | null;
    probeAttempts: number;
    createdAt: Date;
    updatedAt: Date;
  }): CompletenessSlotDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      parentCardType: row.parentCardType as CompletenessParentCardTypeDto,
      parentCardId: row.parentCardId,
      slotName: row.slotName,
      slotKind: row.slotKind as CompletenessSlotKindDto,
      status: row.filledAt ? 'filled' : 'open',
      filledAt: row.filledAt ? row.filledAt.toISOString() : null,
      filledByUserId: row.filledByUserId,
      lastProbedAt: row.lastProbedAt ? row.lastProbedAt.toISOString() : null,
      probeAttempts: row.probeAttempts,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
