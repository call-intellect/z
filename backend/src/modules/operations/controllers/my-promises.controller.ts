import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
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
} from '../dto/commitments.dto';
import { CommitmentsService } from '../services/commitments.service';

/**
 * SBA β-8.2 — `/api/v1/me/promises`.
 *
 *   GET  /?status=open|asked|all&limit=50 — список моих обещаний.
 *   POST /:blockId/mark body={status, note?} — ручное закрытие.
 *
 * Auth: CookieAuthGuard + TenantGuard. Self-only — фильтр идёт по
 * `Person.userId === currentUserId` через JOIN IdeaBlockEntity → Entity →
 * Person (см. `CommitmentsService.listMine`). Сотрудник НЕ видит обещания
 * других сотрудников.
 */
@ApiTags('me-promises')
@Controller('api/v1/me/promises')
@UseGuards(CookieAuthGuard, TenantGuard)
export class MyPromisesController {
  constructor(
    @Inject(CommitmentsService)
    private readonly svc: CommitmentsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список моих обещаний (фильтр по статусу)' })
  async list(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(ListMyPromisesQuerySchema))
    q: ListMyPromisesQuery,
  ): Promise<{ items: CommitmentDto[] }> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    // Ф9 (no_person): отсутствие Person ≠ запрет на просмотр кабинета —
    // отдаём пустой список (200) вместо hard-403. `mark()` оставляем строгим
    // (для записи нужен реальный subject).
    let person: { id: string };
    try {
      person = await this.svc.resolveSelfPerson({
        tenantId: tenantId!,
        userId: uid,
      });
    } catch (err) {
      if (
        err instanceof ForbiddenException &&
        this.isNoPersonError(err)
      ) {
        return { items: [] };
      }
      throw err;
    }
    return this.svc.listMine({
      tenantId: tenantId!,
      selfPersonId: person.id,
      query: q,
    });
  }

  /** Различает ForbiddenException c кодом `no_person` (Ф9 graceful). */
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
