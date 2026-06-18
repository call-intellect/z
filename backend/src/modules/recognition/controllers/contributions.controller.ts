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
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import type {
  ContributionsSnapshotDto,
  ListRecognitionsResponseDto,
  MyContributionsResponseDto,
} from '../dto/recognition.dto';
import { ListRecognitionsQuerySchema, type ListRecognitionsQuery } from '../dto/recognition.dto';
import { RecognitionService } from '../services/recognition.service';

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
          message: 'Профиль вклада сотрудника доступен только руководителям (owner / admin)',
        },
      });
    }
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
