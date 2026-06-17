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
        error: {
          code: 'invalid_mango_json',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }

    if (event.entry !== 'call') {
      this.logger.debug({ sourceId, entry: event.entry }, 'mango: skip non-call entry');
      return { ok: true };
    }

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
