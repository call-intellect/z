import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { IngestService } from '../../ingest.service';

import { MangoAdapterService } from './mango.service';

/**
 * Webhook-контроллер Mango Office (Фаза 10 knowledge-core, Шаг 5).
 *
 * `POST /api/v1/ingest/calls/mango/:sourceId` — endpoint для notify-событий
 * АТС Mango. Mango отправляет form-encoded body с полями `json` (raw JSON-строка
 * payload'а) и `sign` (sha256(apiKey + json + apiSalt)).
 *
 * Особенности:
 *   - Авторизация — через подпись (timing-safe в `MangoAdapterService.verifySignature`).
 *   - Только summary-события (`event.entry === 'call'`) обрабатываются.
 *   - На MVP Шага 5 НЕ создаём `Meeting` — храним только `RawEvent` с
 *     metadata-only payload (см. plans/decisions-log.md 2026-05-10).
 *   - Запись звонка (`recordUrl`) скачивается в S3 fire-and-forget.
 *
 * FIXME knowledge-core Фаза 12: добавить @RequireEntitlement('feature.adapter_phone_call').
 */
@ApiExcludeController()
@Controller('api/v1/ingest/calls/mango')
export class MangoCallWebhookController {
  private readonly logger = new Logger(MangoCallWebhookController.name);

  constructor(
    @Inject(MangoAdapterService) private readonly mango: MangoAdapterService,
    @Inject(IngestService) private readonly ingest: IngestService,
  ) {}

  @Post(':sourceId')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('sourceId') sourceId: string,
    @Body() body: MangoFormBody,
  ): Promise<{ ok: true; idempotent?: boolean }> {
    const { source, apiKey, apiSalt, config } = await this.mango.loadActiveSource(sourceId);

    const json = typeof body.json === 'string' ? body.json : '';
    const sign = typeof body.sign === 'string' ? body.sign : '';
    if (!json || !sign) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'invalid_mango_payload', message: 'Отсутствует json или sign' },
      });
    }
    const valid = this.mango.verifySignature({ apiKey, apiSalt, json, presented: sign });
    if (!valid) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'invalid_mango_signature' },
      });
    }

    let event: MangoEvent;
    try {
      event = JSON.parse(json) as MangoEvent;
    } catch (err) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'invalid_mango_json', message: err instanceof Error ? err.message : String(err) },
      });
    }

    // Принимаем только финальное summary call-события.
    if (event.entry !== 'call') {
      this.logger.debug({ sourceId, entry: event.entry }, 'mango: skip non-call entry');
      return { ok: true };
    }

    // Фильтр по добавочному.
    if (
      config.extensions.length > 0 &&
      event.from?.extension &&
      !config.extensions.includes(event.from.extension) &&
      event.to?.extension &&
      !config.extensions.includes(event.to.extension)
    ) {
      this.logger.debug({ sourceId, extension: event.from?.extension }, 'mango: skip extension');
      return { ok: true };
    }

    const callId = event.call_id ?? event.entry_id ?? '';
    if (!callId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'mango_no_call_id' },
      });
    }

    // Скачивание записи (если есть) — fire-and-forget, не блокируем ingest.
    let recordS3Key: string | null = null;
    if (event.recording_url) {
      try {
        recordS3Key = await this.mango.downloadRecording({
          tenantId: source.tenantId,
          callId,
          recordUrl: event.recording_url,
        });
      } catch (err) {
        this.logger.warn(
          { sourceId, callId, err: err instanceof Error ? err.message : String(err) },
          'mango: не удалось скачать запись',
        );
      }
    }

    const occurredAtSec = event.timestamp ?? event.start_time ?? Math.floor(Date.now() / 1000);
    const occurredAt = new Date(occurredAtSec * 1000);

    const payload = {
      callId,
      from: event.from ?? null,
      to: event.to ?? null,
      durationSec: event.duration ?? event.talk_duration ?? null,
      direction: event.direction ?? null,
      recordingUrlExternal: event.recording_url ?? null,
      recordS3Key,
      raw: event,
      // TODO Фаза 10b: добавить enqueue в transcribe.queue для phone-transcribe.worker.
      // Сейчас — metadata-only RawEvent. См. plans/decisions-log.md 2026-05-10.
    };

    const result = await this.ingest.ingest({
      tenantId: source.tenantId,
      sourceId: source.id,
      sourceExternalId: `mango:${callId}`,
      occurredAt,
      payload,
      dataClass: source.dataClass,
    });
    return { ok: true, idempotent: result.idempotent };
  }
}

interface MangoFormBody {
  json?: string;
  sign?: string;
}

interface MangoEvent {
  entry?: string;
  entry_id?: string;
  call_id?: string;
  timestamp?: number;
  start_time?: number;
  direction?: string;
  duration?: number;
  talk_duration?: number;
  recording_url?: string;
  from?: { extension?: string; number?: string; name?: string };
  to?: { extension?: string; number?: string; name?: string };
}
