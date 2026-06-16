import {
  ConflictException,
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
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import { OnboardingService } from '../../onboarding/onboarding.service';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

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
      isReferenceDemo: boolean;
      demoSeededAt: Date | null;
      owner: { id: string; email: string; name: string } | null;
    }>;
  }> {
    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        isReferenceDemo: true,
        demoWorkspaceSeededAt: true,
        owner: { select: { id: true, email: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return {
      orgs: orgs.map((o) => ({
        id: o.id,
        name: o.name,
        isReferenceDemo: o.isReferenceDemo,
        demoSeededAt: o.demoWorkspaceSeededAt,
        owner: o.owner ? { id: o.owner.id, email: o.owner.email, name: o.owner.name } : null,
      })),
    };
  }

  @Post('orgs/:orgId/mark-reference')
  @HttpCode(HttpStatus.OK)
  async markReference(@Param('orgId') orgId: string): Promise<{ ok: true }> {
    const target = await this.prisma.org.findFirst({
      where: { id: orgId, deletedAt: null },
      select: { id: true, isReferenceDemo: true },
    });
    if (!target) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'org_not_found', message: 'Org не найдена' },
      });
    }
    if (target.isReferenceDemo) {
      return { ok: true };
    }
    const existingReference = await this.prisma.org.findFirst({
      where: { isReferenceDemo: true, deletedAt: null, id: { not: orgId } },
      select: { id: true },
    });
    if (existingReference) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'reference_already_exists',
          message: `Эталонная демо-Org уже существует: ${existingReference.id}. В системе может быть только одна.`,
        },
      });
    }
    await this.prisma.org.update({
      where: { id: orgId },
      data: { isReferenceDemo: true },
    });
    return { ok: true };
  }

  @Post('orgs/:orgId/seed')
  @HttpCode(HttpStatus.OK)
  async seed(@Param('orgId') orgId: string): Promise<{ ok: true; stats: Record<string, number> }> {
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
    return this.onboarding.seedDemoWorkspace({ orgId: org.id, userId: org.ownerId });
  }

  @Post('orgs/:orgId/reset')
  @HttpCode(HttpStatus.OK)
  async reset(
    @Param('orgId') orgId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true; deletedByTable: Record<string, number> }> {
    const org = await this.prisma.org.findFirst({
      where: { id: orgId, deletedAt: null },
      select: { id: true, demoWorkspaceSeededAt: true },
    });
    if (!org) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'org_not_found', message: 'Org не найдена' },
      });
    }
    return this.onboarding.resetDemoWorkspace({ orgId: org.id, actorUserId: user.id });
  }
}
