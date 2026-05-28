import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Inject,
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
import { nanoid } from 'nanoid';

import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { RequireSubscription } from '../../billing/guards/require-subscription.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import { S3Service } from '../../recordings/s3.service';

/**
 * Минимальный тип файла, который multer кладёт в req. Лежит локально —
 * чтобы не ломать сборку без `@types/multer` (он опциональный peer-dep).
 * Идентично attachments.controller.ts.
 */
interface MulterFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Лимит для картинки внутри документа — 10 MB. */
const MAX_DOCUMENT_ASSET_SIZE = 10 * 1024 * 1024;

/** Разрешённые MIME — только изображения. Для других файлов есть /attachments. */
const ALLOWED_MIME_PREFIXES = ['image/'];

/**
 * Ответ на upload документа: presigned URL для использования в TipTap-image.
 */
interface DocumentAssetUploadResponse {
  /** S3-key (для удаления / повторного presign). */
  key: string;
  /** Готовый presigned URL (TTL ~1 час), который вставляется в редактор. */
  url: string;
  /** ISO-время истечения URL. */
  expiresAt: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

/**
 * REST `/api/v1/uploads/document-asset` — загрузка картинки для вставки в
 * редактор документа проекта.
 *
 * Файл кладётся в S3 (`document-assets/${tenantId}/${nanoid}-${name}`); в БД
 * запись НЕ создаётся — ссылка живёт только внутри content документа (TipTap
 * image node). Retention делается по orphan-cron'у (либо человек удаляет
 * вручную; обычно ассет «забывается» — это допустимо).
 *
 * RBAC: `project_document.write`. Любой пользователь с правом писать
 * документы может загрузить картинку (необязательно для конкретного
 * проекта — ассет глобален per tenant).
 *
 * ТЗ: plans/tz/2026-05-27-tracker-project-documents.md §"Загрузка файлов
 * внутри документа".
 */
@ApiTags('tracker / uploads')
@ApiBearerAuth()
@Controller('api/v1/uploads')
@UseGuards(CookieAuthGuard, TenantGuard)
export class DocumentUploadsController {
  constructor(
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Post('document-asset')
  @RequireSubscription()
  @ApiOperation({
    summary:
      'Загрузить картинку для вставки в редактор документа проекта (multipart/form-data, поле "file")',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: MulterFile | undefined,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<DocumentAssetUploadResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);

    if (!file || !file.buffer || file.size === 0) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'file_required',
          message: 'Файл обязателен (поле "file")',
        },
      });
    }
    if (file.size > MAX_DOCUMENT_ASSET_SIZE) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'file_too_large',
          message: `Размер картинки превышает ${MAX_DOCUMENT_ASSET_SIZE} байт`,
        },
      });
    }
    const mime = (file.mimetype ?? '').toLowerCase();
    const allowed = ALLOWED_MIME_PREFIXES.some((prefix) =>
      mime.startsWith(prefix),
    );
    if (!allowed) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'mime_type_not_allowed',
          message: `MIME-тип "${file.mimetype}" не разрешён (только изображения)`,
        },
      });
    }

    const safeName = this.sanitizeFileName(file.originalname);
    const key = `document-assets/${t}/${nanoid()}-${safeName}`;

    await this.s3.putObject({
      key,
      body: file.buffer,
      contentType: file.mimetype,
    });

    const { url, expiresAt } = await this.s3.presignGet(key);

    return {
      key,
      url,
      expiresAt: expiresAt.toISOString(),
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
    };
  }

  // ── helpers ───────────────────────────────────────────────────────────

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'tenant_required',
          message: 'Организация не определена',
        },
      });
    }
    return tenantId;
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'project_document');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для загрузки картинок в документ',
        },
      });
    }
  }

  private sanitizeFileName(name: string): string {
    const trimmed = name.trim().replace(/\s+/g, '_');
    const safe = trimmed.replace(/[^A-Za-z0-9._-]/g, '_');
    return safe.length > 200 ? safe.slice(safe.length - 200) : safe;
  }
}
