import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import {
  type CommitmentDto,
  ListMyPromisesQuerySchema,
  type ListMyPromisesQuery,
  MarkPromiseBodySchema,
  type MarkPromiseBody,
  type MyPromisesListDto,
  ReschedulePromiseBodySchema,
  type ReschedulePromiseBody,
} from '../dto/commitments.dto';
import { CommitmentsService } from '../services/commitments.service';

@ApiTags('me-promises')
@Controller('api/v1/me/promises')
@UseGuards(CookieAuthGuard, TenantGuard)
export class MyPromisesController {
  constructor(
    @Inject(CommitmentsService)
    private readonly svc: CommitmentsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Список моих обещаний (полные обещания + «открытые вопросы», фильтр по статусу)',
  })
  async list(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(ListMyPromisesQuerySchema))
    q: ListMyPromisesQuery,
  ): Promise<MyPromisesListDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    let person: { id: string };
    try {
      person = await this.svc.resolveSelfPerson({
        tenantId: tenantId!,
        userId: uid,
      });
    } catch (err) {
      if (err instanceof ForbiddenException && this.isNoPersonError(err)) {
        return { items: [], openQuestions: [] };
      }
      throw err;
    }
    return this.svc.listMine({
      tenantId: tenantId!,
      selfPersonId: person.id,
      query: q,
    });
  }

  private isNoPersonError(err: ForbiddenException): boolean {
    const response = err.getResponse();
    return (
      typeof response === 'object' &&
      response !== null &&
      (response as { error?: { code?: string } }).error?.code === 'no_person'
    );
  }

  @Post(':blockId/mark')
  @ApiOperation({ summary: 'Ручное закрытие моего обещания' })
  async mark(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Param('blockId') blockId: string,
    @Body(new ZodValidationPipe(MarkPromiseBodySchema))
    body: MarkPromiseBody,
  ): Promise<CommitmentDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    const person = await this.svc.resolveSelfPerson({
      tenantId: tenantId!,
      userId: uid,
    });
    return this.svc.markMine({
      tenantId: tenantId!,
      selfPersonId: person.id,
      blockId,
      body,
    });
  }

  @Patch(':blockId/reschedule')
  @ApiOperation({
    summary: 'Перенести срок моего обещания (статус остаётся open)',
  })
  async reschedule(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Param('blockId') blockId: string,
    @Body(new ZodValidationPipe(ReschedulePromiseBodySchema))
    body: ReschedulePromiseBody,
  ): Promise<CommitmentDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    const person = await this.svc.resolveSelfPerson({
      tenantId: tenantId!,
      userId: uid,
    });
    return this.svc.rescheduleMine({
      tenantId: tenantId!,
      selfPersonId: person.id,
      blockId,
      body,
    });
  }

  private requireUser(req: Request): string {
    const uid = req.user?.id;
    if (!uid) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'no_user', message: 'Требуется авторизация' },
      });
    }
    return uid;
  }

  private requireTenant(tenantId: string | undefined): void {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Не передан tenantId' },
      });
    }
  }
}
