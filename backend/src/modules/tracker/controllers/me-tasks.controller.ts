import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import {
  PostMeTaskBodySchema,
  type PostMeTaskBodyDto,
  type PostMeTaskResponseDto,
} from '../dto/issues/post-me-task.dto';
import { MeTasksService } from '../services/me-tasks.service';

/**
 * REST `POST /api/v1/me/tasks` — постановка задачи СЕБЕ.
 *
 * ТЗ#3 (2026-06-15): предусловие инструмента помощника `create_task`. Рядовой
 * сотрудник (member/manager) ставит задачу себе из помощника, БЕЗ права
 * `intake_issue/write` (только у owner/admin/coo) и без правки policy.csv —
 * используется существующее право `issue:write` (рядовой им обладает:
 * `p, manager, *, *, issue, write`).
 *
 * Семантика жёстко сужена, чтобы не расширять доступ: проект всегда дефолтный
 * «Входящие» (find-or-create), исполнитель всегда сам запрашивающий. Чужого
 * исполнителя/проект через этот эндпоинт задать нельзя.
 *
 * Отдельный контроллер (не часть IssuesController), как и `MeInboxController`:
 * путь не привязан к `:projectId`, семантика — «мой помощник», не «таблица
 * задач проекта».
 */
@ApiTags('tracker / me')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class MeTasksController {
  constructor(
    @Inject(MeTasksService) private readonly svc: MeTasksService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Post('me/tasks')
  @ApiOperation({
    summary: 'Поставить задачу себе (дефолт-проект «Входящие», исполнитель = я)',
    description:
      'Создаёт задачу в общей папке «Входящие» с исполнителем = текущий ' +
      'пользователь. Требует право issue:write (есть у рядового member/manager). ' +
      'Эндпоинт не принимает ни проект, ни чужого исполнителя — доступ не ' +
      'расширяется. Предусловие инструмента помощника create_task.',
  })
  @ApiResponse({
    status: 201,
    description: 'Созданная задача: { id, title, projectId, status }',
  })
  @ApiResponse({ status: 400, description: 'Validation error / tenant_required' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав на создание задач' })
  async createSelfTask(
    @Body(new ZodValidationPipe(PostMeTaskBodySchema)) body: PostMeTaskBodyDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<PostMeTaskResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.createSelfTask(body, t, user.id);
  }

  // ── helpers ──

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Организация не определена' },
      });
    }
    return tenantId;
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'issue');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав на создание задач' },
      });
    }
  }
}
