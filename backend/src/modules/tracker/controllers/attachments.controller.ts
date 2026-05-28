import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { RequireSubscription } from '../../billing/guards/require-subscription.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import {
  AttachmentsService,
  type AttachmentResponseDto,
} from '../services/attachments.service';

/**
 * Минимальный тип файла, который multer кладёт в req. Лежит локально —
 * чтобы не ломать сборку без `@types/multer` (он опциональный peer-dep).
 */
interface MulterFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const UploadAttachmentSchema = z
  .object({
    commentId: z.string().min(1).max(64).optional(),
  })
  .strict();
type UploadAttachmentDto = z.infer<typeof UploadAttachmentSchema>;

/**
 * REST `/api/v1/issues/:id/attachments` + `/api/v1/attachments/:id`.
 *
 * Загрузка — multipart/form-data, поле `file`. Optional поле `commentId` в
 * body — если приложение относится к комментарию (а не задаче в целом).
 *
 * Лимит размера и валидация MIME — в `AttachmentsService` (25 MB,
 * картинки/документы/архивы/text/audio/video).
 *
 * RBAC:
 *   - upload   → `issue.update`
 *   - download → `issue.read`
 *   - delete   → `issue.update`
 */
@ApiTags('tracker / issues / attachments')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class AttachmentsController {
  constructor(
    @Inject(AttachmentsService) private readonly svc: AttachmentsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Post('issues/:id/attachments')
  @RequireSubscription()
  @ApiOperation({ summary: 'Загрузить файл к задаче (multipart/form-data)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        commentId: { type: 'string' },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Param('id') issueId: string,
    @UploadedFile() file: MulterFile | undefined,
    @Body(new ZodValidationPipe(UploadAttachmentSchema))
    body: UploadAttachmentDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<AttachmentResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    if (!file) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'file_required', message: 'Файл обязателен (поле "file")' },
      });
    }
    return this.svc.upload({
      tenantId: t,
      issueId,
      userId: user.id,
      file: {
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        buffer: file.buffer,
      },
      commentId: body.commentId ?? null,
    });
  }

  @Get('attachments/:id')
  @ApiOperation({ summary: 'Получить presigned URL для скачивания приложения' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<AttachmentResponseDto & { downloadUrl: string; expiresAt: string }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.getPresigned(id, t);
  }

  @Delete('attachments/:id')
  @RequireSubscription()
  @HttpCode(204)
  @ApiOperation({ summary: 'Удалить приложение (БД + S3)' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<void> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    await this.svc.delete(id, t, user.id);
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

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'issue');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав на чтение задач' },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'issue');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав на изменение задач' },
      });
    }
  }
}
