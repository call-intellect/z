import {
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { OrgAdminGuard } from '../../auth/guards/org-admin.guard';
import { EntitlementService } from '../../entitlements/entitlement.service';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';

/**
 * `GET / PATCH /api/v1/admin/org/memory-access` — управление доступом к
 * разделам «Памяти компании» для роли `member` (ТЗ 2026-05-26 §6).
 *
 * Дальше эти feature-флаги читаются:
 *   - на frontend — через `useMemoryAccess()` для скрытия пунктов в сайдбаре;
 *   - на backend — будущим member-guard (когда роль `member` появится).
 *
 * RBAC: только owner / admin Org (через `OrgAdminGuard`).
 *
 * Реализация — тонкая обвязка над `EntitlementService.setOverride('feature', …)`.
 */

const UpdateMemoryAccessSchema = z.object({
  regulationsForMembers: z.boolean().optional(),
  entitiesForMembers: z.boolean().optional(),
});
type UpdateMemoryAccessBody = z.infer<typeof UpdateMemoryAccessSchema>;

export interface MemoryAccessDto {
  regulationsForMembers: boolean;
  entitiesForMembers: boolean;
}

function requireUserId(req: Request): string {
  const userId = (req as Request & { user?: { id?: string } | null }).user?.id;
  if (!userId) {
    throw new Error('user_required');
  }
  return userId;
}

@ApiTags('admin-org-memory-access')
@Controller('api/v1/admin/org/memory-access')
@UseGuards(CookieAuthGuard, TenantGuard, OrgAdminGuard)
export class OrgAdminMemoryAccessController {
  constructor(
    @Inject(EntitlementService)
    private readonly entitlements: EntitlementService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Текущие настройки доступа к разделам «Памяти» для member',
  })
  async get(@CurrentOrg() tenantId: string): Promise<MemoryAccessDto> {
    const ent = await this.entitlements.getEntitlement(tenantId);
    return {
      regulationsForMembers:
        ent.features['feature.memory_regulations_for_members'] === true,
      entitiesForMembers:
        ent.features['feature.memory_entities_for_members'] === true,
    };
  }

  @Patch()
  @ApiOperation({
    summary: 'Изменить настройки доступа к разделам «Памяти» для member',
  })
  async update(
    @CurrentOrg() tenantId: string,
    @Req() req: Request,
    @Body(new ZodValidationPipe(UpdateMemoryAccessSchema))
    body: UpdateMemoryAccessBody,
  ): Promise<MemoryAccessDto> {
    const userId = requireUserId(req);

    if (body.regulationsForMembers !== undefined) {
      await this.entitlements.setOverride(
        tenantId,
        'feature',
        'feature.memory_regulations_for_members',
        body.regulationsForMembers,
        userId,
        'Изменено через org-admin/memory-access',
      );
    }
    if (body.entitiesForMembers !== undefined) {
      await this.entitlements.setOverride(
        tenantId,
        'feature',
        'feature.memory_entities_for_members',
        body.entitiesForMembers,
        userId,
        'Изменено через org-admin/memory-access',
      );
    }

    return this.get(tenantId);
  }
}
