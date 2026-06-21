import { Inject, Injectable, Logger } from '@nestjs/common';
import { RawEvent } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { DialogTurn } from '../../ai/services/prompts/common';
import { EntityResolutionService } from '../../knowledge-core/services/entity-resolution.service';
import { S3Service } from '../../recordings/s3.service';

export interface DaySignalMessage {
  personId: string;
  text: string;
  source: 'meeting' | 'bitrix' | 'chatbox' | 'email' | 'phone_call' | 'self_initiated';
  occurredAt: Date;
}

interface DialogSessionPayload {
  transcript?: { turns?: Array<{ text?: string | null; authorPersonId?: string | null }> } | null;
}

interface EmailPayload {
  from?: { name?: string | null; address?: string | null } | null;
  subject?: string | null;
  text?: string | null;
  fullText?: string | null;
}

interface FreeNotePayload {
  kind?: string;
  userId?: string;
  text?: string;
}

@Injectable()
export class DaySignalExtractorService {
  private readonly logger = new Logger(DaySignalExtractorService.name);

  constructor(
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(EntityResolutionService) private readonly entities: EntityResolutionService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
  ) {}

  async extractFromRawEvent(event: RawEvent): Promise<DaySignalMessage[]> {
    try {
      switch (event.sourceType) {
        case 'bitrix':
          return await this.extractFromDialogSession(event, 'bitrix');
        case 'chatbox':
          return await this.extractFromDialogSession(event, 'chatbox');
        case 'email':
          return await this.extractFromEmail(event);
        case 'conversational':
          return await this.extractFromConversational(event);
        case 'phone_call':
          return [];
        default:
          return [];
      }
    } catch (err) {
      this.logger.warn(
        { rawEventId: event.id, sourceType: event.sourceType, err: String(err) },
        'day-signal-extractor: ошибка разбора payload — пропуск',
      );
      return [];
    }
  }

  async extractFromMeeting(args: {
    tenantId: string;
    turns: DialogTurn[];
    occurredAt: Date;
  }): Promise<DaySignalMessage[]> {
    const messages: DaySignalMessage[] = [];
    const cache = new Map<string, string | null>();

    for (const turn of args.turns) {
      const text = turn.text?.trim();
      if (!text) continue;

      const speakerParticipantId = turn.speakerParticipantId;
      if (!speakerParticipantId) {
        this.metrics.incDaySignalDroppedNoPerson({ sourceType: 'meeting' });
        continue;
      }

      let personId = cache.get(speakerParticipantId);
      if (personId === undefined) {
        personId = await this.entities.resolveSubjectPersonId(args.tenantId, { speakerParticipantId });
        cache.set(speakerParticipantId, personId);
      }

      if (!personId) {
        this.metrics.incDaySignalDroppedNoPerson({ sourceType: 'meeting' });
        continue;
      }

      messages.push({ personId, text: turn.text, source: 'meeting', occurredAt: args.occurredAt });
    }

    return messages;
  }

  private async extractFromDialogSession(
    event: RawEvent,
    source: 'bitrix' | 'chatbox',
  ): Promise<DaySignalMessage[]> {
    const payload = (await this.loadPayload(event)) as DialogSessionPayload | null;
    const turns = payload?.transcript?.turns ?? [];
    const messages: DaySignalMessage[] = [];

    for (const turn of turns) {
      const text = turn.text?.trim();
      if (!text) continue;

      if (!turn.authorPersonId) {
        this.metrics.incDaySignalDroppedNoPerson({ sourceType: source });
        continue;
      }

      messages.push({
        personId: turn.authorPersonId,
        text: turn.text!,
        source,
        occurredAt: event.occurredAt,
      });
    }

    return messages;
  }

  private async extractFromEmail(event: RawEvent): Promise<DaySignalMessage[]> {
    const payload = (await this.loadPayload(event)) as EmailPayload | null;
    const address = payload?.from?.address ?? null;
    const text = payload?.fullText ?? payload?.text ?? payload?.subject ?? null;

    const personId = address
      ? await this.entities.resolveSubjectPersonId(event.tenantId, { authorEmail: address })
      : null;

    const trimmed = text?.trim();
    if (!personId || !trimmed) {
      this.metrics.incDaySignalDroppedNoPerson({ sourceType: 'email' });
      return [];
    }

    return [{ personId, text: text!, source: 'email', occurredAt: event.occurredAt }];
  }

  private async extractFromConversational(event: RawEvent): Promise<DaySignalMessage[]> {
    const payload = (await this.loadPayload(event)) as FreeNotePayload | null;
    if (payload?.kind !== 'free_note') return [];

    const userId = payload.userId;
    const text = payload.text?.trim();
    const personId = userId
      ? await this.entities.resolveSubjectPersonId(event.tenantId, { authorUserId: userId })
      : null;

    if (!personId || !text) {
      this.metrics.incDaySignalDroppedNoPerson({ sourceType: 'conversational' });
      return [];
    }

    return [{ personId, text: payload.text!, source: 'self_initiated', occurredAt: event.occurredAt }];
  }

  private async loadPayload(event: RawEvent): Promise<unknown> {
    if (event.payloadStorage === 's3') {
      if (!event.payloadS3Key) {
        this.logger.warn({ rawEventId: event.id }, 'day-signal-extractor: payloadStorage=s3 без payloadS3Key — пропуск');
        return null;
      }
      return this.s3.getJson<unknown>(event.payloadS3Key);
    }
    return event.payload;
  }
}
