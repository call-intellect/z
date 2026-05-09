import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';

import { BulkExportSchema, type BulkExportDto } from './dto/export.dto';
import { ExportsService } from './exports.service';

@ApiTags('exports')
@Controller('api/v1/exports')
@UseGuards(CookieAuthGuard)
export class ExportsController {
  constructor(@Inject(ExportsService) private readonly svc: ExportsService) {}

  @Get()
  @ApiOperation({ summary: 'Список экспортов юзера' })
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.svc.list(user.id).then((items) => ({ items }));
  }

  @Post('meeting/:id/md')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Экспорт встречи в MD' })
  meetingMd(
    @Param('id') meetingId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.svc.createMeetingExport(user.id, meetingId, 'meeting_md');
  }

  @Post('meeting/:id/docx')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Экспорт встречи в DOCX' })
  meetingDocx(
    @Param('id') meetingId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.svc.createMeetingExport(user.id, meetingId, 'meeting_docx');
  }

  @Post('meeting/:id/pdf')
  @ApiOperation({ summary: 'Экспорт встречи в PDF (501)', description: 'Не реализовано в V1' })
  meetingPdf(): never {
    throw new HttpException(
      {
        ok: false,
        error: { code: 'pdf_not_implemented', message: 'PDF-экспорт пока не реализован' },
      },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  @Post('bulk')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Bulk-экспорт нескольких встреч в ZIP' })
  bulk(
    @CurrentUser() user: CurrentUserPayload,
    @Body(new ZodValidationPipe(BulkExportSchema)) dto: BulkExportDto,
  ) {
    return this.svc.createBulkExport(user.id, dto);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Получить presigned download-ссылку (если ready)' })
  download(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.svc.getDownloadUrl(id, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить export' })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<void> {
    await this.svc.delete(id, user.id);
  }
}
