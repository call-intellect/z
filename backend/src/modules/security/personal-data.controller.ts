import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import {
  PersonalDataDeletionService,
  type EraseReport,
} from './personal-data-deletion.service';

/**
 * REST-эндпоинт «право на удаление личных данных» (Фаза 11 knowledge-core).
 *
 * 152-ФЗ / GDPR-style: владелец Org инициирует удаление всех данных,
 * связанных с конкретной персоной (`Entity.type='person'`). Каскадно:
 *   - удаляются RawEvent'ы из evidence связанных блоков (S3 + БД),
 *   - удаляются IdeaBlockEntity-связи,
 *   - блоки без оставшихся evidence архивируются,
 *   - удаляются EntityLink (входящие/исходящие к персоне),
 *   - сама Entity обезличивается (`canonicalName='[удалено по запросу]'`).
 *
 * RBAC: только owner Org (action='erase' на ресурсе 'person').
 * super_admin — bypass через RbacService.
 *
 * Идемпотентность: повторный вызов на уже обезличенной персоне →
 * `{...нули, alreadyErased: true}`.
 */
const EraseBodySchema = z.object({
  reason: z
    .string()
    .min(3, 'reason должен быть указан (минимум 3 символа)')
    .max(2000),
});

type EraseBodyDto = z.infer<typeof EraseBodySchema>;

@ApiTags('persons')
@Controller('api/v1/persons')
@UseGuards(CookieAuthGuard, TenantGuard)
export class PersonalDataController {
  constructor(
    @Inject(PersonalDataDeletionService)
    private readonly svc: PersonalDataDeletionService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Delete(':entityId/data')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Удалить все личные данные о персоне (152-ФЗ). owner-only, идемпотентно.',
  })
  async erase(
    @Param('entityId') entityId: string,
    @Body(new ZodValidationPipe(EraseBodySchema)) body: EraseBodyDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<EraseReport> {
    const t = this.requireTenant(tenantId);
    await this.requireErase(user.id, t);
    return this.svc.eraseEntity({
      entityId,
      tenantId: t,
      requestedBy: user.id,
      reason: body.reason,
    });
  }

  // ────────────────────────── helpers ──────────────────────────────────

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    return tenantId;
  }

  private async requireErase(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'person',
      act: 'erase',
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message:
            'Удалять личные данные может только владелец Org (152-ФЗ). super_admin — через Z-Admin.',
        },
      });
    }
  }
}
