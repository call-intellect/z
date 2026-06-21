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
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import {
  PostAssignTaskBodySchema,
  type PostAssignTaskBodyDto,
  type PostAssignTaskResponseDto,
} from '../dto/issues/post-assign-task.dto';
import {
  PostMeTaskBodySchema,
  type PostMeTaskBodyDto,
  type PostMeTaskResponseDto,
} from '../dto/issues/post-me-task.dto';
import {
  PostSuggestAssigneeBodySchema,
  type PostSuggestAssigneeBodyDto,
  type PostSuggestAssigneeResponseDto,
} from '../dto/issues/post-suggest-assignee.dto';
import { MeTasksService } from '../services/me-tasks.service';

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

  @Post('me/tasks/assign')
  @ApiOperation({
    summary: 'Поставить задачу другому сотруднику по имени (проект «Входящие»)',
    description:
      'Создаёт задачу в общей папке «Входящие» с исполнителем = сотрудник, ' +
      'найденный по имени (assigneeName), и шлёт ему уведомление в бот/кабинет. ' +
      'Требует право issue:write (есть у рядового member/manager). Предусловие ' +
      'инструмента помощника assign_task.',
  })
  @ApiResponse({
    status: 201,
    description: 'Созданная задача: { id, title, projectId, status, assignee }',
  })
  @ApiResponse({ status: 400, description: 'Validation error / tenant_required' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав на создание задач' })
  @ApiResponse({ status: 404, description: 'assignee_not_found — сотрудник не найден по имени' })
  @ApiResponse({ status: 409, description: 'assignee_ambiguous — несколько одноимённых сотрудников' })
  async assignTask(
    @Body(new ZodValidationPipe(PostAssignTaskBodySchema)) body: PostAssignTaskBodyDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<PostAssignTaskResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.assignTask(body, t, user.id);
  }

  @Post('me/tasks/suggest-assignee')
  @ApiOperation({
    summary: 'Предложить исполнителя для задачи без явного назначенца (по компетенциям)',
    description:
      'Возвращает кандидатов-исполнителей по профилю компетенций (роль / ' +
      'отдел / навыки), отсортированных по уверенности. Ничего НЕ присваивает — ' +
      'только предлагает; присвоение делает POST /me/tasks/assign по решению ' +
      'человека. Требует право issue:write (есть у рядового member/manager).',
  })
  @ApiResponse({
    status: 201,
    description: 'Кандидаты: { suggestions: AssigneeSuggestion[] } (пусто — нет уверенного)',
  })
  @ApiResponse({ status: 400, description: 'Validation error / tenant_required' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав на создание задач' })
  async suggestAssignee(
    @Body(new ZodValidationPipe(PostSuggestAssigneeBodySchema)) body: PostSuggestAssigneeBodyDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<PostSuggestAssigneeResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.suggestAssignee(body, t);
  }

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
