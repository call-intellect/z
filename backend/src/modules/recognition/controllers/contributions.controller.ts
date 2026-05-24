import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
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
import type {
  ContributionsSnapshotDto,
  ListRecognitionsResponseDto,
  MyContributionsResponseDto,
} from '../dto/recognition.dto';
import {
  ListRecognitionsQuerySchema,
  type ListRecognitionsQuery,
} from '../dto/recognition.dto';
import { RecognitionService } from '../services/recognition.service';

/**
 * Wave 2 — Contributions / Recognitions REST API.
 *
 *   GET /api/v1/me/contributions            — свой профиль вклада + бейджи + последние 10 Recognition
 *   GET /api/v1/persons/:id/contributions   — для руководителя (manage по org)
 *   GET /api/v1/me/recognitions             — все мои Recognition (фильтр по type/period)
 *
 * RBAC:
 *   - /me/* — авторизация = self; нет RBAC-обвязки кроме CookieAuth + TenantGuard.
 *   - /persons/:id/contributions — manager+ может смотреть подчинённых;
 *     на MVP проверка через rbac.check(act='manage', obj='org') — допустимо для
 *     owner/admin (HR-доступ). Полная иерархия «direct manager» — γ-фаза.
 */
@ApiTags('recognition / contributions')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class ContributionsController {
  constructor(
    @Inject(RecognitionService) private readonly svc: RecognitionService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get('me/contributions')
  @ApiOperation({ summary: 'Мой профиль вклада (Recognition + Badges)' })
  async myContributions(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<MyContributionsResponseDto> {
    const t = this.requireTenant(tenantId);
    return this.svc.getMyContributions(user.id, t);
  }

  @Get('persons/:id/contributions')
  @ApiOperation({ summary: 'Профиль вклада сотрудника (для руководителя)' })
  async personContributions(
    @Param('id') personId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<MyContributionsResponseDto> {
    const t = this.requireTenant(tenantId);
    // Manage по org = доступ owner/admin (HR-функция).
    const canManage = await this.rbac.check({
      userId: user.id,
      tenantId: t,
      obj: 'org',
      act: 'manage',
    });
    if (!canManage) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message:
            'Профиль вклада сотрудника доступен только руководителям (owner / admin)',
        },
      });
    }
    // Person.userId → User.id. Если у Person нет linked User — отдаём 404
    // (нет смысла показывать contributions для контакта без аккаунта).
    const person = await this.prisma.person.findFirst({
      where: { id: personId, tenantId: t },
      select: { userId: true },
    });
    if (!person?.userId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'person_not_found_or_no_account',
          message: 'Сотрудник не найден либо у него нет аккаунта',
        },
      });
    }
    return this.svc.getMyContributions(person.userId, t);
  }

  @Get('me/recognitions')
  @ApiOperation({ summary: 'Мои Recognition (с фильтрами по type/period)' })
  async myRecognitions(
    @Query(new ZodValidationPipe(ListRecognitionsQuerySchema))
    q: ListRecognitionsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListRecognitionsResponseDto> {
    const t = this.requireTenant(tenantId);
    return this.svc.listMyRecognitions(user.id, t, q);
  }

  @Get('me/contributions/snapshot')
  @ApiOperation({ summary: 'Только числовые показатели (без бейджей и recognition)' })
  async mySnapshotOnly(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ContributionsSnapshotDto> {
    this.requireTenant(tenantId);
    return this.svc.getContributionsForUser(user.id);
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
}
