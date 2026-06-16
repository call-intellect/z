import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { LlmRouterService, type LlmProviderName } from '../../ai/services/llm-router.service';
import { AdminFunctionsService } from '../services/admin-functions.service';

import { TASK_TYPES_TUPLE, type PutLlmRouteDto } from './dto/llm-routes.dto';

@Injectable()
export class LlmRoutesService {
  constructor(
    @Inject(LlmRouterService) private readonly router: LlmRouterService,
    @Inject(AdminFunctionsService) private readonly functions: AdminFunctionsService,
  ) {}

  list() {
    return this.router.getRoutes();
  }

  async upsert(taskType: string, dto: PutLlmRouteDto) {
    if (!(TASK_TYPES_TUPLE as readonly string[]).includes(taskType)) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'invalid_task_type', message: `Unknown taskType: ${taskType}` },
      });
    }
    await this.functions.setRouteForTaskType({
      taskType,
      providers: dto.providers.map((p) => ({
        provider: p.provider as LlmProviderName,
        ...(p.model ? { model: p.model } : {}),
      })),
      isActive: dto.isActive,
      ...(dto.pinnedVersionNote !== undefined ? { pinnedVersionNote: dto.pinnedVersionNote } : {}),
    });
    const updated = (await this.router.getRoutes()).find(
      (r) => r.taskType === taskType && r.tenantId === null,
    );
    return updated ?? null;
  }
}
