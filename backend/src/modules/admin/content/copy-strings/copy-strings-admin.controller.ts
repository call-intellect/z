import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../../auth/guards/super-admin.guard';
import { SuperAdminAuditInterceptor } from '../../super-admin.audit.interceptor';

import { CopyStringsAdminService } from './copy-strings-admin.service';
import {
  BulkImportCopyStringsSchema,
  type BulkImportCopyStringsDto,
  UpdateCopyStringSchema,
  type UpdateCopyStringDto,
} from './dto/copy-strings-admin.dto';

@ApiTags('admin-content-copy-strings')
@Controller('api/v1/admin/content/copy-strings')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class CopyStringsAdminController {
  constructor(
    @Inject(CopyStringsAdminService)
    private readonly svc: CopyStringsAdminService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Все AdminSetting с category=content section=copy-strings (UI-строки + глоссарий).',
  })
  list() {
    return this.svc.list();
  }

  @Patch(':key')
  @ApiOperation({
    summary:
      'Обновить значение строки. Запись через AdminSettingsService.set() — history/audit бесплатно.',
  })
  update(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(UpdateCopyStringSchema)) dto: UpdateCopyStringDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    this.assertUser(user);
    return this.svc.update(key, dto.value, user.id, dto.reason ?? null);
  }

  @Post('bulk-import')
  @ApiOperation({
    summary:
      'Массовая загрузка пар key→value. Каждая пара пишется отдельно (history/audit на каждую).',
  })
  bulkImport(
    @Body(new ZodValidationPipe(BulkImportCopyStringsSchema)) dto: BulkImportCopyStringsDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    this.assertUser(user);
    return this.svc.bulkImport(dto.entries, user.id, dto.reason ?? null);
  }

  private assertUser(
    user: CurrentUserPayload | null | undefined,
  ): asserts user is CurrentUserPayload {
    if (!user || !user.id) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'no_user_context' },
      });
    }
  }
}
