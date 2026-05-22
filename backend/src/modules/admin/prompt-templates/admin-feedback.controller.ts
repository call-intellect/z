/**
 * Фаза A.3 — AdminFeedbackController.
 *
 * GET /api/v1/admin/feedback — список фидбека для аналитики (ТЗ A §7.3).
 *
 * RBAC: super_admin видит ВЕСЬ фидбек, owner/admin Org — только встречи своих Org.
 */

import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

import { AiResultFeedbackService } from './ai-result-feedback.service';
import {
  ListFeedbackQuerySchema,
  type ListFeedbackQueryDto,
} from './dto/ai-result-feedback.dto';

@ApiExcludeController()
@Controller('api/v1/admin/feedback')
@UseGuards(CookieAuthGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminFeedbackController {
  constructor(
    @Inject(AiResultFeedbackService)
    private readonly svc: AiResultFeedbackService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(ListFeedbackQuerySchema))
    query: ListFeedbackQueryDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    if (!user || !user.id) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'no_user_context' },
      });
    }
    const u = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { isSuperAdmin: true },
    });
    if (!u) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'no_user_found' },
      });
    }
    const memberships = await this.prisma.membership.findMany({
      where: { userId: user.id, role: { in: ['owner', 'admin'] } },
      select: { orgId: true },
    });
    return this.svc.adminList(query, {
      isSuperAdmin: u.isSuperAdmin === true,
      ownedOrgIds: memberships.map((m) => m.orgId),
    });
  }
}
