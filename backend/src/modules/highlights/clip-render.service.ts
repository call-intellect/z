import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { MeetingHighlight } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { AiQueueService } from '../ai/ai-queue.service';
import { QuotaService } from '../quotas/quota.service';
import { S3Service } from '../recordings/s3.service';

import { HighlightsRepository } from './highlights.repository';

/**
 * Обёртка над `AiQueueService.enqueueClipRender` с idempotency и квотой.
 *
 *   - Если `renderStatus IN (queued, processing)` → 409 `render_in_progress`.
 *   - Если `ready` → возвращаем presigned URL уже отрендеренного MP4.
 *   - Иначе:
 *     1. checkAndIncrement квоты `MAX_RENDER_JOBS_PER_HOUR` (через QuotaService);
 *     2. ставим status=queued;
 *     3. enqueue в `clip.render`.
 */
@Injectable()
export class ClipRenderService {
  private readonly logger = new Logger(ClipRenderService.name);

  constructor(
    @Inject(HighlightsRepository) private readonly repo: HighlightsRepository,
    @Inject(AiQueueService) private readonly queue: AiQueueService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(QuotaService) private readonly quota: QuotaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async startRender(
    highlight: MeetingHighlight,
    userId: string,
  ): Promise<
    | { status: 'queued'; renderStatus: 'queued' }
    | { status: 'ready'; url: string; expiresAt: string }
  > {
    if (highlight.renderStatus === 'queued' || highlight.renderStatus === 'processing') {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'render_in_progress',
          message: 'Рендер этого клипа уже запущен',
        },
      });
    }
    if (highlight.renderStatus === 'ready' && highlight.renderedMp4Key) {
      const presigned = await this.s3.presignGet(highlight.renderedMp4Key);
      return {
        status: 'ready',
        url: presigned.url,
        expiresAt: presigned.expiresAt.toISOString(),
      };
    }

    // Реальный QuotaService сам бросит QuotaExceededError (HttpException 429)
    // при превышении — AllExceptionsFilter сериализует тело и Retry-After.
    await this.quota.checkAndIncrement({
      userId,
      quotaName: 'render_jobs_per_hour',
      max: this.cfg.workspace.maxRenderJobsPerHour,
      windowMs: 60 * 60 * 1000,
    });

    await this.repo.updateRenderStatus(highlight.id, 'queued', {
      renderError: null,
    });
    await this.queue.enqueueClipRender(highlight.id);
    this.logger.log(
      `clip.render enqueued highlight=${highlight.id} user=${userId}`,
    );
    return { status: 'queued', renderStatus: 'queued' };
  }

  async getDownloadUrl(highlight: MeetingHighlight): Promise<{ url: string; expiresAt: string }> {
    if (highlight.renderStatus !== 'ready' || !highlight.renderedMp4Key) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'clip_not_ready',
          message: 'Клип ещё не отрендерен',
        },
      });
    }
    const presigned = await this.s3.presignGet(highlight.renderedMp4Key);
    return {
      url: presigned.url,
      expiresAt: presigned.expiresAt.toISOString(),
    };
  }
}
