import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { LlmRouterService, type LlmTaskType, type LlmProviderName } from '../../ai/services/llm-router.service';

import { TASK_TYPES_TUPLE, type PutLlmRouteDto } from './dto/llm-routes.dto';

@Injectable()
export class LlmRoutesService {
  constructor(@Inject(LlmRouterService) private readonly router: LlmRouterService) {}

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
    const providers = dto.providers.map((p) => p.provider) as LlmProviderName[];
    return this.router.setRoute({
      taskType: taskType as LlmTaskType,
      providers,
      isActive: dto.isActive,
    });
  }
}
