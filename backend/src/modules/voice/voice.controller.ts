import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

interface MulterFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import { SynthesizeVoiceSchema, type SynthesizeVoiceDto } from './dto/voice.dto';
import { VoiceAdapterError } from './services/voice-channel-adapter.service';
import { VoiceChannelAdapter } from './services/voice-channel-adapter.service';

@ApiTags('voice')
@Controller('api/v1/voice')
@UseGuards(CookieAuthGuard, TenantGuard)
export class VoiceController {
  private readonly logger = new Logger(VoiceController.name);

  static readonly MAX_AUDIO_BYTES = 10 * 1024 * 1024;

  constructor(
    @Inject(VoiceChannelAdapter)
    private readonly adapter: VoiceChannelAdapter,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Post('transcribe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Распознать речь из аудио (ASR через Vox)',
    description:
      'Multipart upload поля `audio`. Лимит — 10 MB. Возвращает { text, durationSeconds, provider }.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        audio: { type: 'string', format: 'binary' },
      },
      required: ['audio'],
    },
  })
  @UseInterceptors(FileInterceptor('audio'))
  async transcribe(
    @UploadedFile() file: MulterFile | undefined,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{
    text: string;
    durationSeconds: number;
    provider: string;
  }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);

    if (!file) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'audio_required', message: 'Поле audio обязательно' },
      });
    }
    if (file.size > VoiceController.MAX_AUDIO_BYTES) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'audio_too_large',
          message: `Аудио больше ${VoiceController.MAX_AUDIO_BYTES} байт`,
        },
      });
    }

    try {
      const result = await this.adapter.transcribe({
        audio: file.buffer,
        tenantId: t,
        mimeType: file.mimetype,
      });
      return {
        text: result.text,
        durationSeconds: result.durationSeconds,
        provider: result.provider,
      };
    } catch (err) {
      if (err instanceof VoiceAdapterError) {
        throw new BadRequestException({
          ok: false,
          error: { code: err.code, message: err.message },
        });
      }
      throw err;
    }
  }

  @Post('synthesize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Синтезировать речь из текста (TTS)',
    description:
      'JSON `{ text, voice?, format? }`. text ≤ 500 символов. Возвращает binary audio (Content-Type зависит от format; по умолчанию audio/mpeg).',
  })
  async synthesize(
    @Body(new ZodValidationPipe(SynthesizeVoiceSchema))
    body: SynthesizeVoiceDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);

    try {
      const result = await this.adapter.synthesize({
        tenantId: t,
        input: {
          text: body.text,
          ...(body.voice !== undefined ? { voice: body.voice } : {}),
          format: body.format,
        },
      });

      res
        .status(HttpStatus.OK)
        .set({
          'Content-Type': contentTypeForFormat(body.format),
          'Content-Length': String(result.bytes),
          'X-Voice-Provider': result.provider,
          'X-Voice-Voice': result.voice,
          'X-Voice-Chars': String(result.chars),
        })
        .send(result.audio);
    } catch (err) {
      if (err instanceof VoiceAdapterError) {
        throw new BadRequestException({
          ok: false,
          error: { code: err.code, message: err.message },
        });
      }
      throw err;
    }
  }

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'tenant_required',
          message: 'Не определена текущая Org (заголовок X-Org-Id)',
        },
      });
    }
    return tenantId;
  }

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'voice');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'voice_forbidden_read',
          message: 'Нет права voice.transcribe',
        },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'voice');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'voice_forbidden_write',
          message: 'Нет права voice.synthesize',
        },
      });
    }
  }
}

function contentTypeForFormat(format: 'mp3' | 'opus' | 'aac' | 'flac'): string {
  switch (format) {
    case 'mp3':
      return 'audio/mpeg';
    case 'opus':
      return 'audio/ogg; codecs=opus';
    case 'aac':
      return 'audio/aac';
    case 'flac':
      return 'audio/flac';
    default:
      return 'application/octet-stream';
  }
}
