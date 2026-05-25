import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Inject,
  Logger,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { PrismaService } from '../../common/prisma/prisma.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { RoleClonePersonaVersioningHandler } from '../knowledge-core/services/role-clone-persona-versioning.handler';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

/**
 * Clones=Roles Ф2 — admin-роутер для ручных операций над клонами ролей.
 *
 * Эндпоинты:
 *   - POST /api/v1/admin/clones/:roleId/force-new-version — принудительно
 *     создать новую версию ExecutablePersona(scope='role') для роли. Используется
 *     для отладки и ручной пересборки после изменений в SkillProfile'ах
 *     носителя. Body опционален: если `newPersonId` не передан — берём
 *     текущего активного носителя (Appointment с validTo IS NULL, max loadPercent).
 *
 * RBAC: только `clone_persona` write (owner/admin Org).
 */
const ForceNewVersionBodySchema = z.object({
  newPersonId: z.string().min(1).optional(),
});

type ForceNewVersionBody = z.infer<typeof ForceNewVersionBodySchema>;

@ApiTags('admin-clones')
@Controller('api/v1/admin/clones')
@UseGuards(CookieAuthGuard, TenantGuard)
export class ClonesAdminController {
  private readonly logger = new Logger(ClonesAdminController.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(RoleClonePersonaVersioningHandler)
    private readonly versioning: RoleClonePersonaVersioningHandler,
  ) {}

  @Post(':roleId/force-new-version')
  @ApiOperation({
    summary:
      'Clones=Roles Ф2: вручную создать новую версию клона роли (owner/admin)',
  })
  async forceNewVersion(
    @Param('roleId') roleId: string,
    @Body(new ZodValidationPipe(ForceNewVersionBodySchema))
    body: ForceNewVersionBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; personaId: string | null; reason?: string }> {
    const t = this.requireTenant(tenantId);

    // RBAC: clone_persona write — owner/admin Org.
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

    // Если newPersonId не передан — берём текущего активного носителя.
    let newPersonId: string | null = body.newPersonId ?? null;
    if (!newPersonId) {
      const active = await this.prisma.appointment.findFirst({
        where: { tenantId: t, roleId, validTo: null },
        orderBy: [{ loadPercent: 'desc' }, { validFrom: 'desc' }],
        select: { personId: true },
      });
      newPersonId = active?.personId ?? null;
    }

    // Определяем oldPersonId из текущей active persona (если есть).
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
