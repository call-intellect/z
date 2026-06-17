import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import { UpdateCompanyRoleSchema, type UpdateCompanyRoleBody } from './dto/update-company-role.dto';
import { WelcomePatchSchema, type WelcomePatchBody } from './dto/welcome-patch.dto';
import { OnboardingService, type SetupProgressDto } from './onboarding.service';

@ApiTags('onboarding')
@ApiBearerAuth()
@UseGuards(CookieAuthGuard)
@Controller('api/v1')
export class OnboardingController {
  constructor(
    @Inject(OnboardingService) private readonly svc: OnboardingService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Patch('users/me')
  @ApiOperation({ summary: 'Обновить роль пользователя в компании (companyRole)' })
  @ApiOkResponse({ description: 'ok: true' })
  async updateCompanyRole(
    @Body(new ZodValidationPipe(UpdateCompanyRoleSchema)) body: UpdateCompanyRoleBody,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    return this.svc.updateCompanyRole({ userId: user.id, companyRole: body.companyRole });
  }

  @Patch('orgs/:orgId/welcome')
  @UseGuards(TenantGuard)
  @ApiOperation({ summary: 'Сохранение ответов Блока A онбординга (пошагово)' })
  @ApiOkResponse({ description: 'ok: true' })
  async patchWelcome(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(WelcomePatchSchema)) body: WelcomePatchBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    await this.requireOwnerOrAdmin(user.id, orgId);
    return this.svc.patchWelcome({ orgId: tenantId ?? orgId, userId: user.id, body });
  }

  @Post('orgs/:orgId/welcome/complete')
  @HttpCode(HttpStatus.OK)
  @UseGuards(TenantGuard)
  @ApiOperation({
    summary: 'Завершить Блок A онбординга — создать документ, выставить profileCompletedAt',
  })
  @ApiOkResponse({ description: '{ ok: true, redirectTo: "/dashboard" }' })
  async completeWelcome(
    @Param('orgId') orgId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; redirectTo: string }> {
    await this.requireOwnerOrAdmin(user.id, orgId);
    return this.svc.completeWelcome({ orgId: tenantId ?? orgId, userId: user.id });
  }

  @Get('orgs/:orgId/setup-progress')
  @UseGuards(TenantGuard)
  @ApiOperation({
    summary:
      'Прогресс настройки компании: 6 вех по принципу «timestamp ИЛИ факт существования сущности» (QA B6)',
  })
  @ApiOkResponse({ description: '{ completed, total, steps }' })
  async getSetupProgress(
    @Param('orgId') orgId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<SetupProgressDto> {
    await this.requireOwnerOrAdmin(user.id, orgId);
    return this.svc.getSetupProgress(tenantId ?? orgId);
  }

  @Post('orgs/:orgId/setup/complete')
  @HttpCode(HttpStatus.OK)
  @UseGuards(TenantGuard)
  @ApiOperation({ summary: 'Завершить Блок B онбординга — выставить setupCompletedAt' })
  @ApiOkResponse({ description: '{ ok: true }' })
  async completeSetup(
    @Param('orgId') orgId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    await this.requireOwnerOrAdmin(user.id, orgId);
    return this.svc.completeSetup({ orgId: tenantId ?? orgId });
  }

  @Post('orgs/:orgId/demo-workspace')
  @HttpCode(HttpStatus.OK)
  @UseGuards(TenantGuard)
  @ApiOperation({ summary: 'Загрузить демо-воркспейс «ТехноСтрим»' })
  @ApiOkResponse({ description: '{ ok: true, stats: { ... } }' })
  async seedDemoWorkspace(
    @Param('orgId') orgId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; stats: Record<string, number> }> {
    await this.requireOwnerOrAdmin(user.id, orgId);
    return this.svc.seedDemoWorkspace({ orgId: tenantId ?? orgId, userId: user.id });
  }

  @Post('orgs/:orgId/reset-demo')
  @HttpCode(HttpStatus.OK)
  @UseGuards(TenantGuard)
  @ApiOperation({ summary: 'Сбросить демо-данные «ТехноСтрим»' })
  @ApiOkResponse({ description: '{ ok: true }' })
  async resetDemoWorkspace(
    @Param('orgId') orgId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; deletedByTable: Record<string, number> }> {
    await this.requireOwnerOrAdmin(user.id, orgId);
    return this.svc.resetDemoWorkspace({
      orgId: tenantId ?? orgId,
      actorUserId: user.id,
    });
  }

  private async requireOwnerOrAdmin(userId: string, orgId: string): Promise<void> {
    const ctx = await this.rbac.loadContext(userId, orgId);
    if (!ctx || (ctx.role !== 'owner' && ctx.role !== 'admin' && !ctx.isSuperAdmin)) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Действие доступно только владельцу или администратору компании',
        },
      });
    }
  }
}
