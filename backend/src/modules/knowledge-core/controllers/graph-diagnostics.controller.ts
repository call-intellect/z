import { Controller, Get, NotFoundException, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import { GraphMaterializationService } from '../services/graph-materialization.service';

export const GraphMaterializationQuerySchema = z.object({
  meetingId: z.string().trim().min(1).max(256),
  orgId: z.string().trim().min(1).max(256).optional(),
});
export type GraphMaterializationQueryDto = z.infer<typeof GraphMaterializationQuerySchema>;

@ApiTags('platform-graph')
@Controller('api/v1/platform/graph')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
export class GraphDiagnosticsController {
  constructor(
    private readonly graphMat: GraphMaterializationService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('materialization')
  @ApiOperation({
    summary:
      'Материализация графа из встречи: распределение блоков по signalType/status + счётчики Decision/Idea/Goal + расхождения.',
  })
  async materialization(
    @Query(new ZodValidationPipe(GraphMaterializationQuerySchema))
    q: GraphMaterializationQueryDto,
  ) {
    let tenantId = q.orgId;
    if (!tenantId) {
      const meeting = await this.prisma.meeting.findUnique({
        where: { id: q.meetingId },
        select: { tenantId: true },
      });
      if (!meeting) {
        throw new NotFoundException(`Встреча ${q.meetingId} не найдена (передайте orgId явно).`);
      }
      tenantId = meeting.tenantId;
    }
    return this.graphMat.getMeetingMaterialization(tenantId, q.meetingId);
  }
}
