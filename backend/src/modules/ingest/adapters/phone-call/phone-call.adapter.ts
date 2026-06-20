import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DataClass, Source } from '@prisma/client';

import { VoxService } from '../../../ai/services/vox.service';
import { IngestService, type IngestResult } from '../../ingest.service';

import { MangoAdapterService } from './mango.service';

export interface PhoneCallParticipant {
  role: 'from' | 'to';
  extension: string | null;
  number: string | null;
  name: string | null;
}

export interface PhoneCallEvent {
  callId: string;
  occurredAt: Date;
  from: { extension?: string; number?: string; name?: string } | null;
  to: { extension?: string; number?: string; name?: string } | null;
  direction: string | null;
  durationSec: number | null;
  recordingUrlExternal: string | null;
  raw: unknown;
}

export interface PhoneCallPayload {
  kind: 'phone_call';
  callId: string;
  direction: string | null;
  durationSec: number | null;
  participants: PhoneCallParticipant[];
  recordingS3Key: string | null;
  recordingUrlExternal: string | null;
  fullText: string;
  asrProvider: 'vox' | null;
  startedAt: string;
  endedAt: string | null;
  raw: unknown;
}

@Injectable()
export class PhoneCallIngestAdapter {
  private readonly logger = new Logger(PhoneCallIngestAdapter.name);

  constructor(
    @Inject(MangoAdapterService) private readonly mango: MangoAdapterService,
    @Inject(IngestService) private readonly ingest: IngestService,
    @Inject(VoxService) private readonly vox: VoxService,
  ) {}

  async ingestCall(input: {
    source: Pick<Source, 'id' | 'tenantId' | 'dataClass'>;
    event: PhoneCallEvent;
  }): Promise<IngestResult> {
    const { source, event } = input;

    const recordingS3Key = await this.tryDownloadRecording({
      tenantId: source.tenantId,
      callId: event.callId,
      recordingUrlExternal: event.recordingUrlExternal,
    });

    const asr = recordingS3Key
      ? await this.tryTranscribe({ tenantId: source.tenantId, callId: event.callId })
      : { fullText: '', provider: null as 'vox' | null };

    const participants = this.buildParticipants(event);

    const startedAt = event.occurredAt;
    const endedAt =
      event.durationSec && event.durationSec > 0
        ? new Date(startedAt.getTime() + event.durationSec * 1000)
        : null;

    const payload: PhoneCallPayload = {
      kind: 'phone_call',
      callId: event.callId,
      direction: event.direction,
      durationSec: event.durationSec,
      participants,
      recordingS3Key,
      recordingUrlExternal: event.recordingUrlExternal,
      fullText: asr.fullText,
      asrProvider: asr.provider,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt ? endedAt.toISOString() : null,
      raw: event.raw,
    };

    const result = await this.ingest.ingest({
      tenantId: source.tenantId,
      sourceId: source.id,
      sourceExternalId: `mango:${event.callId}`,
      occurredAt: startedAt,
      payload,
      dataClass: source.dataClass as DataClass,
    });

    this.logger.log(
      {
        callId: event.callId,
        tenantId: source.tenantId,
        rawEventId: result.rawEvent.id,
        idempotent: result.idempotent,
        hasRecording: recordingS3Key !== null,
        transcriptChars: asr.fullText.length,
      },
      'phone-call-adapter: ingest завершён',
    );
    return result;
  }

  private buildParticipants(event: PhoneCallEvent): PhoneCallParticipant[] {
    const out: PhoneCallParticipant[] = [];
    if (event.from) {
      out.push({
        role: 'from',
        extension: event.from.extension ?? null,
        number: event.from.number ?? null,
        name: event.from.name ?? null,
      });
    }
    if (event.to) {
      out.push({
        role: 'to',
        extension: event.to.extension ?? null,
        number: event.to.number ?? null,
        name: event.to.name ?? null,
      });
    }
    return out;
  }

  private async tryDownloadRecording(input: {
    tenantId: string;
    callId: string;
    recordingUrlExternal: string | null;
  }): Promise<string | null> {
    if (!input.recordingUrlExternal) return null;
    try {
      return await this.mango.downloadRecording({
        tenantId: input.tenantId,
        callId: input.callId,
        recordUrl: input.recordingUrlExternal,
      });
    } catch (err) {
      this.logger.warn(
        {
          tenantId: input.tenantId,
          callId: input.callId,
          err: err instanceof Error ? err.message : String(err),
        },
        'phone-call-adapter: не удалось скачать запись звонка',
      );
      return null;
    }
  }

  private async tryTranscribe(input: {
    tenantId: string;
    callId: string;
  }): Promise<{ fullText: string; provider: 'vox' | null }> {
    try {
      const audio = await this.mango.readRecording({
        tenantId: input.tenantId,
        callId: input.callId,
      });
      const { taskId } = await this.vox.submit(audio);
      const result = await this.vox.poll(taskId);
      const fullText = result.transcriptText.trim();
      return { fullText, provider: fullText.length > 0 ? 'vox' : null };
    } catch (err) {
      this.logger.warn(
        {
          tenantId: input.tenantId,
          callId: input.callId,
          err: err instanceof Error ? err.message : String(err),
        },
        'phone-call-adapter: ASR записи звонка недоступна — fullText пуст (graceful)',
      );
      return { fullText: '', provider: null };
    }
  }
}
