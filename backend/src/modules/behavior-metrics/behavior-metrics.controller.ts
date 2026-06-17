import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';

import { BehaviorMetricsService } from './behavior-metrics.service';
import {
  type BehaviorMetricsResponse,
  type OrgAggregateQuery,
  OrgAggregateQuerySchema,
  type OrgAggregateResponse,
} from './dto/behavior-metrics.dto';

@Controller('api/v1')
@UseGuards(CookieAuthGuard)
export class BehaviorMetricsController {
  constructor(
    @Inject(BehaviorMetricsService)
    private readonly svc: BehaviorMetricsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get('meetings/:id/behavior-metrics')
  async getForMeeting(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<BehaviorMetricsResponse> {
    return this.svc.getForMeeting(id, user.id);
  }

  @Get('org/behavior-metrics/aggregate')
  async getOrgAggregate(
    @Query(new ZodValidationPipe(OrgAggregateQuerySchema)) query: OrgAggregateQuery,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<OrgAggregateResponse & { tenantId: string }> {
    const member = await this.prisma.membership.findFirst({
      where: { userId: user.id },
      select: { orgId: true },
    });
    if (!member) {
      throw new HttpException('no_active_org_membership', HttpStatus.BAD_REQUEST);
    }
    const result = await this.svc.getOrgAggregate(member.orgId, user.id, query);
    return { ...result, tenantId: member.orgId };
  }
}
