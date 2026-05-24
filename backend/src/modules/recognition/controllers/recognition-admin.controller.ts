import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Inject,
  NotImplementedException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';

/**
 * Wave 2 — Recognition admin actions (stubs).
 *
 *   POST /api/v1/recognitions/:id/forward-as-self — руководитель пересылает
 *     благодарность от своего имени (stub: реализация в Sprint 4).
 *
 *   POST /api/v1/me/settings/notifications/recognition — опт-аут (заметка
 *     для пользователя; реальная настройка — через me/notification-preferences,
 *     которая ещё не подключена). Сейчас возвращает 200 + TODO в логах.
 *
 * Эти endpoint'ы зарезервированы под этическую защиту (ТЗ §8). На MVP они
 * возвращают `501 Not Implemented` либо no-op `200`, чтобы фронт не падал.
 */
@ApiTags('recognition / admin')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class RecognitionAdminController {
  constructor(@Inject(RbacService) private readonly rbac: RbacService) {}

  @Post('recognitions/:id/forward-as-self')
  @ApiOperation({
    summary:
      'Руководитель «одобряет и пересылает от себя» благодарность (stub Sprint 4)',
  })
  async forwardAsSelf(
    @Param('id') recognitionId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<void> {
    const t = this.requireTenant(tenantId);
    const canManage = await this.rbac.check({
      userId: user.id,
      tenantId: t,
      obj: 'org',
      act: 'manage',
    });
    if (!canManage) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Только руководитель (owner / admin) может пересылать благодарности',
        },
      });
    }
    // TODO(sprint-4): реализовать — создать второй Recognition fromUserId=user.id,
    //   message = «<руководитель> поддержал благодарность за: <оригинал>». Не
    //   подменять оригинал — только создавать копию с прозрачным fromUserId.
    throw new NotImplementedException({
      ok: false,
      error: {
        code: 'not_implemented',
        message: 'Forward-as-self будет реализован в Sprint 4',
        recognitionId,
      },
    });
  }

  @Post('me/settings/notifications/recognition')
  @ApiOperation({
    summary:
      'Опт-аут уведомлений Recognition Agent (stub: noop, реальная настройка в me/notification-preferences)',
  })
  async optOutRecognition(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; note: string }> {
    this.requireTenant(tenantId);
    // TODO(sprint-4): подключить к me/notification-preferences (когда появится
    //   таблица настроек). Пока — возвращаем заметку, чтобы фронт мог
    //   отрисовать «настройка сохранена» без 404.
    return {
      ok: true,
      note: `TODO sprint-4: подключить опт-аут к notification-preferences (userId=${user.id})`,
    };
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
}
