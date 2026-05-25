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

import {
  CreateEmailTemplateSchema,
  type CreateEmailTemplateDto,
  TestSendEmailTemplateSchema,
  type TestSendEmailTemplateDto,
  UpdateEmailTemplateSchema,
  type UpdateEmailTemplateDto,
} from './dto/email-templates-admin.dto';
import { EmailTemplatesAdminService } from './email-templates-admin.service';

/**
 * Admin-redesign Фаза 5 — `EmailTemplatesAdminController`.
 *
 * Управление шаблонами писем под `CookieAuthGuard + SuperAdminGuard` и
 * `SuperAdminAuditInterceptor`. При первом GET (БД пустая) — bootstrap из
 * `mail.templates.ts`. test-send защищён in-memory rate-limit'ом 5/мин.
 */
@ApiTags('admin-content-email-templates')
@Controller('api/v1/admin/content/email-templates')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class EmailTemplatesAdminController {
  constructor(
    @Inject(EmailTemplatesAdminService)
    private readonly svc: EmailTemplatesAdminService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Список EmailTemplate. На пустой БД — bootstrap-sync констант из mail.templates.ts.',
  })
  list() {
    return this.svc.list();
  }

  @Get(':key')
  @ApiOperation({
    summary:
      'Карточка EmailTemplate с preview (subject/body/htmlBody, отрисованные placeholder-значениями).',
  })
  detail(@Param('key') key: string) {
    return this.svc.getDetail(key);
  }

  @Post()
  @ApiOperation({ summary: 'Создать EmailTemplate. Валидация Handlebars body/subject.' })
  create(
    @Body(new ZodValidationPipe(CreateEmailTemplateSchema)) dto: CreateEmailTemplateDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    this.assertUser(user);
    return this.svc.create(dto, user.id);
  }

  @Patch(':key')
  @ApiOperation({
    summary:
      'Обновить EmailTemplate. Валидация Handlebars body/subject/htmlBody — 400 при синтаксической ошибке.',
  })
  update(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(UpdateEmailTemplateSchema)) dto: UpdateEmailTemplateDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    this.assertUser(user);
    return this.svc.update(key, dto, user.id);
  }

  @Post(':key/test-send')
  @ApiOperation({
    summary:
      'Отправить тестовое письмо. Rate-limit 5/мин на super_admin. Subject префиксуется «[ТЕСТ]».',
  })
  testSend(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(TestSendEmailTemplateSchema)) dto: TestSendEmailTemplateDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    this.assertUser(user);
    return this.svc.testSend(key, dto.to, user.id);
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
