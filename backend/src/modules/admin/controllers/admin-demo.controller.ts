import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import { OnboardingService } from '../../onboarding/onboarding.service';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

/**
 * Z-Admin: управление демо-кабинетом «ТехноСтрим» для любой Org.
 *
 *   GET  /api/v1/admin/demo/orgs          — список Org (+ статус демо, владелец)
 *   POST /api/v1/admin/demo/orgs/:id/seed — залить демо (от имени owner'а Org)
 *   POST /api/v1/admin/demo/orgs/:id/reset — сбросить демо
 *
 * Только super-admin. Переиспользует OnboardingService — ту же логику, что
 * `/onboarding/demo-choice` и CLI `seed-demo-workspace.ts`.
 */
@ApiExcludeController()
@Controller('api/v1/admin/demo')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminDemoController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OnboardingService) private readonly onboarding: OnboardingService,
  ) {}

  @Get('orgs')
  async listOrgs(): Promise<{
    orgs: Array<{
      id: string;
      name: string;
      demoSeededAt: Date | null;
      owner: { id: string; email: string; name: string } | null;
    }>;
  }> {
    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        demoWorkspaceSeededAt: true,
        owner: { select: { id: true, email: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return {
      orgs: orgs.map((o) => ({
        id: o.id,
        name: o.name,
        demoSeededAt: o.demoWorkspaceSeededAt,
        owner: o.owner
          ? { id: o.owner.id, email: o.owner.email, name: o.owner.name }
          : null,
      })),
    };
  }

  @Post('orgs/:orgId/seed')
  @HttpCode(HttpStatus.OK)
  async seed(
    @Param('orgId') orgId: string,
  ): Promise<{ ok: true; stats: Record<string, number> }> {
    const org = await this.prisma.org.findFirst({
      where: { id: orgId, deletedAt: null },
      select: { id: true, ownerId: true },
    });
    if (!org) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'org_not_found', message: 'Org не найдена' },
      });
    }
    // Демо создаётся от имени владельца Org (а не текущего super-admin).
    return this.onboarding.seedDemoWorkspace({ orgId: org.id, userId: org.ownerId });
  }

  @Post('orgs/:orgId/reset')
  @HttpCode(HttpStatus.OK)
  async reset(@Param('orgId') orgId: string): Promise<{ ok: true }> {
    const org = await this.prisma.org.findFirst({
      where: { id: orgId, deletedAt: null },
      select: { id: true },
    });
    if (!org) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'org_not_found', message: 'Org не найдена' },
      });
    }
    return this.onboarding.resetDemoWorkspace({ orgId: org.id });
  }
}
