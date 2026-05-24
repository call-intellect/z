import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';

/**
 * REST `/api/v1/team-templates` — публичные шаблоны команд.
 *
 * Phase 1: read-only. Seed системных шаблонов (10–15 команд: sales /
 * development / installation / marketing / management / …) — Sprint 9
 * (Phase 4). До seed'а endpoint возвращает пустой массив или системные
 * шаблоны если они уже загружены.
 *
 * `POST /projects/from-template` — заглушка (501 Not Implemented) до Phase 4.
 */
@ApiTags('tracker / team-templates')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class TeamTemplatesController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get('team-templates')
  @ApiOperation({ summary: 'Список доступных шаблонов команд (read-only)' })
  async list(@CurrentOrg() tenantId: string | undefined): Promise<{
    items: Array<{
      id: string;
      slug: string;
      name: string;
      description: string;
      category: string;
      isPublic: boolean;
      usageCount: number;
      tenantId: string | null;
    }>;
  }> {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Организация не определена' },
      });
    }
    // Системные (tenantId=null) + Org-specific.
    const rows = await this.prisma.teamTemplate.findMany({
      where: {
        isPublic: true,
        OR: [{ tenantId: null }, { tenantId }],
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        category: r.category,
        isPublic: r.isPublic,
        usageCount: r.usageCount,
        tenantId: r.tenantId,
      })),
    };
  }

  @Get('team-templates/:slug')
  @ApiOperation({ summary: 'Получить шаблон команды по slug' })
  async bySlug(
    @Param('slug') slug: string,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{
    id: string;
    slug: string;
    name: string;
    description: string;
    category: string;
    isPublic: boolean;
    definition: unknown;
  }> {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Организация не определена' },
      });
    }
    // Сначала ищем Org-specific, потом системный (tenantId=null).
    const row =
      (await this.prisma.teamTemplate.findUnique({
        where: { tenantId_slug: { tenantId, slug } },
      })) ??
      (await this.prisma.teamTemplate.findFirst({
        where: { tenantId: null, slug, isPublic: true },
      }));
    if (!row) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'team_template_not_found', message: 'Шаблон команды не найден' },
      });
    }
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      category: row.category,
      isPublic: row.isPublic,
      definition: row.definition,
    };
  }

  @Post('projects/from-template')
  @ApiOperation({
    summary: 'Создать проект из шаблона команды (Phase 4 / Sprint 9)',
  })
  fromTemplate(): never {
    // Реализация — Sprint 9 (Phase 4 трекера). Сейчас 501.
    throw new HttpException(
      {
        ok: false,
        error: {
          code: 'not_implemented',
          message:
            'Создание проекта из шаблона команды появится в Sprint 9 (Phase 4 трекера)',
        },
      },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }
}
