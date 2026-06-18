import { BadRequestException, Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import type { BadgeDto, UserBadgeDto } from '../dto/recognition.dto';
import { RecognitionService } from '../services/recognition.service';

@ApiTags('recognition / badges')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class BadgesController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RecognitionService) private readonly svc: RecognitionService,
  ) {}

  @Get('badges')
  @ApiOperation({ summary: 'Каталог бейджей' })
  async catalog(): Promise<BadgeDto[]> {
    const rows = await this.prisma.badge.findMany({
      orderBy: { slug: 'asc' },
    });
    return rows.map((b) => ({
      id: b.id,
      slug: b.slug,
      name: b.name,
      description: b.description,
      iconUrl: b.iconUrl,
      condition: (b.condition ?? {}) as Record<string, unknown>,
    }));
  }

  @Get('me/badges')
  @ApiOperation({ summary: 'Мои выданные бейджи' })
  async myBadges(@CurrentUser() user: CurrentUserPayload): Promise<UserBadgeDto[]> {
    if (!user?.id) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'auth_required', message: 'Требуется авторизация' },
      });
    }
    return this.svc.getBadgesForUser(user.id);
  }
}
