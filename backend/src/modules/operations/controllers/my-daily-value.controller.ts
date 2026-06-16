import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { TypedConfigService } from '../../../common/config';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';
import { IdeasService } from '../../ideas/services/ideas.service';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import type {
  MyIdeasResponseDto,
  MyRecognitionDto,
  MyRecognitionsResponseDto,
} from '../dto/my-daily-value.dto';

@ApiTags('me-daily-value')
@Controller('api/v1/me')
@UseGuards(CookieAuthGuard, TenantGuard)
export class MyDailyValueController {
  constructor(
    @Inject(IdeasService) private readonly ideas: IdeasService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Get('ideas')
  @ApiOperation({
    summary: 'Судьба моих идей (self-scope: только мои идеи как автора)',
  })
  async myIdeas(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
  ): Promise<MyIdeasResponseDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);

    if (!(await this.isEnabled())) {
      return { items: [] };
    }

    const res = await this.ideas.listMine({
      tenantId: tenantId!,
      userId: uid,
      query: { role: 'author', page: 1, limit: 20 },
    });

    this.metrics.incMyIdeasFateServed({ tenantTop: tenantTopOf(tenantId!) });

    return { items: res.items };
  }

  @Get('recognitions')
  @ApiOperation({
    summary: 'Мои полученные признания (self-scope: toUserId = я)',
  })
  async myRecognitions(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
  ): Promise<MyRecognitionsResponseDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);

    if (!(await this.isEnabled())) {
      return { items: [] };
    }

    const rows = await this.prisma.recognition.findMany({
      where: { tenantId: tenantId!, toUserId: uid },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const giverUserIds = [
      ...new Set(
        rows.map((r) => r.fromUserId).filter((id): id is string => id !== null && id.length > 0),
      ),
    ];
    const nameByUserId = new Map<string, string>();
    if (giverUserIds.length > 0) {
      const persons = await this.prisma.person.findMany({
        where: {
          tenantId: tenantId!,
          userId: { in: giverUserIds },
          deletedAt: null,
        },
        select: { userId: true, name: true },
      });
      for (const p of persons) {
        if (p.userId) nameByUserId.set(p.userId, p.name);
      }
    }

    const items: MyRecognitionDto[] = rows.map((r) => ({
      id: r.id,
      type: r.type,
      message: r.message ?? null,
      fromPersonName: r.fromUserId ? (nameByUserId.get(r.fromUserId) ?? null) : null,
      visibility: r.visibility,
      createdAt: r.createdAt.toISOString(),
    }));

    this.metrics.incMyRecognitionsServed({ tenantTop: tenantTopOf(tenantId!) });

    return { items };
  }

  private async isEnabled(): Promise<boolean> {
    return this.cfg.getDynamic<boolean>(
      'me.daily_value_widgets.enabled',
      'ME_DAILY_VALUE_WIDGETS_ENABLED',
      true,
    );
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
