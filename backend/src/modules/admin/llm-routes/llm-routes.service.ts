import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { LlmRouterService, type LlmTaskType, type LlmProviderName } from '../../ai/services/llm-router.service';
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
    // На Фазе 7 шаг 4: используем AdminFunctionsService.setRouteForTaskType,
    // который сохраняет провайдеров с моделями (а не только именами) и
    // инвалидирует AdminCacheService('usage:'). Для backward-compat возвращаем
    // в том же виде, что раньше — список роутов из LlmRouter.
    await this.functions.setRouteForTaskType({
      taskType,
      providers: dto.providers.map((p) => ({
        provider: p.provider as LlmProviderName,
        ...(p.model ? { model: p.model } : {}),
      })),
      isActive: dto.isActive,
      // ТЗ 2026-05-25 clone-reliability-hardening, Фаза 6.5 — заморозка версии.
      ...(dto.pinnedVersionNote !== undefined
        ? { pinnedVersionNote: dto.pinnedVersionNote }
        : {}),
    });
    const updated = (await this.router.getRoutes()).find(
      (r) => r.taskType === taskType && r.tenantId === null,
    );
    return updated ?? null;
  }
}
