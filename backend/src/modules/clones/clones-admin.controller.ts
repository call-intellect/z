import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AdminAuditInterceptor } from '../admin/admin.audit.interceptor';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { OrgAdminGuard } from '../auth/guards/org-admin.guard';
import { RequireSubscription } from '../billing/guards/require-subscription.decorator';
import { RoleClonePersonaVersioningHandler } from '../knowledge-core/services/role-clone-persona-versioning.handler';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import {
  AccessGrantListQuerySchema,
  AccessGrantPerCloneQuerySchema,
  CloneTypeSchema,
  CreateAccessGrantSchema,
  UpdateAccessGrantSchema,
  type AccessGrantDto,
  type AccessGrantListQueryDto,
  type AccessGrantListResponseDto,
  type AccessGrantPerCloneQueryDto,
  type CreateAccessGrantDto,
  type UpdateAccessGrantDto,
} from './dto/clone-access-grant.dto';
import { ClonesAdminService } from './services/clones-admin.service';

const ForceNewVersionBodySchema = z.object({
  newPersonId: z.string().min(1).optional(),
});

type ForceNewVersionBody = z.infer<typeof ForceNewVersionBodySchema>;

@ApiTags('admin-clones')
@Controller('api/v1/admin/clones')
@UseGuards(CookieAuthGuard, TenantGuard, OrgAdminGuard)
@UseInterceptors(AdminAuditInterceptor)
export class ClonesAdminController {
  private readonly logger = new Logger(ClonesAdminController.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(RoleClonePersonaVersioningHandler)
    private readonly versioning: RoleClonePersonaVersioningHandler,
    @Inject(ClonesAdminService)
    private readonly admin: ClonesAdminService,
  ) {}

  @Post(':roleId/force-new-version')
  @RequireSubscription()
  @ApiOperation({
    summary: 'Clones=Roles Ф2: вручную создать новую версию клона роли (owner/admin)',
  })
  async forceNewVersion(
    @Param('roleId') roleId: string,
    @Body(new ZodValidationPipe(ForceNewVersionBodySchema))
    body: ForceNewVersionBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; personaId: string | null; reason?: string }> {
    const t = this.requireTenant(tenantId);

    const allowed = await this.rbac.check({
      userId: user.id,
      tenantId: t,
      obj: 'clone_persona',
      act: 'write',
      resourceOwnerId: null,
    });
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Нет прав на принудительное обновление клона роли',
        },
      });
    }

    let newPersonId: string | null = body.newPersonId ?? null;
    if (!newPersonId) {
      const active = await this.prisma.appointment.findFirst({
        where: { tenantId: t, roleId, validTo: null },
        orderBy: [{ loadPercent: 'desc' }, { validFrom: 'desc' }],
        select: { personId: true },
      });
      newPersonId = active?.personId ?? null;
    }

    const prevActive = await this.prisma.executablePersona.findFirst({
      where: {
        tenantId: t,
        scope: 'role',
        scopeRefId: roleId,
        status: 'active',
      },
      select: { currentBearerPersonId: true },
    });
    const oldPersonId = prevActive?.currentBearerPersonId ?? null;

    const personaId = await this.versioning.handle({
      tenantId: t,
      roleId,
      oldPersonId,
      newPersonId,
      changedAt: new Date(),
    });

    if (!personaId) {
      return {
        ok: true,
        personaId: null,
        reason:
          'no_change_needed (active persona уже указывает на newPersonId или роль не найдена)',
      };
    }

    return { ok: true, personaId };
  }

  @Get('access-grants')
  @ApiOperation({
    summary: 'ТЗ 2026-05-26 §2.1: список грантов доступа к клонам с фильтрами и pagination.',
  })
  @ApiResponse({ status: 200, description: 'Список грантов с enrichment' })
  async listAccessGrants(
    @CurrentOrg() tenantId: string | undefined,
    @Query(new ZodValidationPipe(AccessGrantListQuerySchema))
    query: AccessGrantListQueryDto,
  ): Promise<AccessGrantListResponseDto> {
    const t = this.requireTenant(tenantId);
    return this.admin.listAccessGrants({ tenantId: t, query });
  }

  @Post('access-grants')
  @RequireSubscription()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'ТЗ 2026-05-26 §2.2: выдать грант доступа к клону (owner/admin Org).',
  })
  @ApiResponse({ status: 201, description: 'Грант создан (или возвращён существующий)' })
  @ApiResponse({ status: 400, description: 'user_not_in_org / invalid_payload' })
  @ApiResponse({ status: 404, description: 'role_not_found / person_not_found' })
  async createAccessGrant(
    @CurrentOrg() tenantId: string | undefined,
    @CurrentUser() user: CurrentUserPayload,
    @Body(new ZodValidationPipe(CreateAccessGrantSchema))
    dto: CreateAccessGrantDto,
  ): Promise<AccessGrantDto> {
    const t = this.requireTenant(tenantId);
    return this.admin.createAccessGrant({
      tenantId: t,
      actorUserId: user.id,
      dto,
    });
  }

  @Delete('access-grants/:id')
  @RequireSubscription()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'ТЗ 2026-05-26 §2.3: soft-revoke гранта (запись остаётся для audit-trail).',
  })
  @ApiResponse({ status: 200, description: 'Грант помечен как отозванный' })
  @ApiResponse({ status: 400, description: 'already_revoked' })
  @ApiResponse({ status: 404, description: 'not_found' })
  async revokeAccessGrant(
    @CurrentOrg() tenantId: string | undefined,
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<AccessGrantDto> {
    const t = this.requireTenant(tenantId);
    return this.admin.revokeAccessGrant({
      tenantId: t,
      actorUserId: user.id,
      id,
    });
  }

  @Patch('access-grants/:id')
  @RequireSubscription()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'ТЗ 2026-05-26 §2.4: продление / изменение expiresAt гранта (нельзя для отозванных).',
  })
  @ApiResponse({ status: 200, description: 'expiresAt обновлён' })
  @ApiResponse({ status: 400, description: 'cannot_update_revoked / invalid_payload' })
  @ApiResponse({ status: 404, description: 'not_found' })
  async extendAccessGrant(
    @CurrentOrg() tenantId: string | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateAccessGrantSchema))
    dto: UpdateAccessGrantDto,
  ): Promise<AccessGrantDto> {
    const t = this.requireTenant(tenantId);
    return this.admin.extendAccessGrant({ tenantId: t, id, dto });
  }

  @Get(':cloneType/:cloneRefId/access-grants')
  @ApiOperation({
    summary:
      'ТЗ 2026-05-26 §2.5: список всех грантов на конкретного клона (для страницы «Управление доступом»).',
  })
  @ApiResponse({ status: 200, description: 'Список грантов на клона' })
  @ApiResponse({ status: 404, description: 'role_not_found / person_not_found' })
  async listAccessGrantsByClone(
    @CurrentOrg() tenantId: string | undefined,
    @Param('cloneType') cloneTypeRaw: string,
    @Param('cloneRefId') cloneRefId: string,
    @Query(new ZodValidationPipe(AccessGrantPerCloneQuerySchema))
    query: AccessGrantPerCloneQueryDto,
  ): Promise<AccessGrantListResponseDto> {
    const t = this.requireTenant(tenantId);
    const parsedType = CloneTypeSchema.safeParse(cloneTypeRaw);
    if (!parsedType.success) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invalid_clone_type',
          message: 'cloneType должен быть `person` или `role`',
        },
      });
    }
    return this.admin.listAccessGrantsByClone({
      tenantId: t,
      cloneType: parsedType.data,
      cloneRefId,
      includeInactive: query.includeInactive,
    });
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
