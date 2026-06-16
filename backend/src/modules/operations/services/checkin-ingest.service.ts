import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { IngestService } from '../../ingest/ingest.service';

const SOURCE_TYPE = 'daily_checkin' as const;
const SOURCE_NAME = 'Ежедневные чек-ины' as const;

export interface CheckinItem {
  text: string;
  severity?: string;
}

const SEVERITY_RU: Record<string, string> = {
  low: 'низкая',
  medium: 'средняя',
  high: 'высокая',
};

export function extractCheckinItems(json: unknown): CheckinItem[] {
  if (!Array.isArray(json)) return [];
  const out: CheckinItem[] = [];
  for (const el of json) {
    if (!el || typeof el !== 'object') continue;
    const rec = el as Record<string, unknown>;
    const text = typeof rec.text === 'string' ? rec.text.trim() : '';
    if (!text) continue;
    const severity = typeof rec.severity === 'string' ? rec.severity : undefined;
    out.push(severity ? { text, severity } : { text });
  }
  return out;
}

export interface RenderCheckinInput {
  personName: string;
  dateLocal: string;
  kind: string;
  plans: CheckinItem[];
  dones: CheckinItem[];
  blockers: CheckinItem[];
  rawResponseText: string | null;
}

export function renderCheckinText(input: RenderCheckinInput): string {
  const kindLabel = input.kind === 'morning' ? 'утренний план' : 'вечерний отчёт';
  const lines: string[] = [
    `Чек-ин сотрудника ${input.personName}, ${input.dateLocal}, ${kindLabel}.`,
  ];
  const hasStructure =
    input.plans.length > 0 || input.dones.length > 0 || input.blockers.length > 0;
  if (hasStructure) {
    if (input.plans.length > 0) {
      lines.push('План на день:');
      for (const p of input.plans) lines.push(`- ${p.text}`);
    }
    if (input.dones.length > 0) {
      lines.push('Сделано:');
      for (const d of input.dones) lines.push(`- ${d.text}`);
    }
    if (input.blockers.length > 0) {
      lines.push('Блокеры:');
      for (const b of input.blockers) {
        const sev = b.severity ? ` (важность: ${SEVERITY_RU[b.severity] ?? b.severity})` : '';
        lines.push(`- ${b.text}${sev}`);
      }
    }
  } else if (input.rawResponseText && input.rawResponseText.trim()) {
    lines.push(input.rawResponseText.trim());
  }
  return lines.join('\n');
}

export function checkinOccurredAt(dateLocal: string, fallback: Date): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateLocal)) return fallback;
  const d = new Date(`${dateLocal}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

@Injectable()
export class CheckinIngestService {
  private readonly logger = new Logger(CheckinIngestService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IngestService) private readonly ingest: IngestService,
  ) {}

  private async upsertSource(tenantId: string): Promise<{ id: string }> {
    const existing = await this.prisma.source.findUnique({
      where: {
        tenantId_type_name: { tenantId, type: SOURCE_TYPE, name: SOURCE_NAME },
      },
      select: { id: true },
    });
    if (existing) return existing;
    try {
      return await this.prisma.source.create({
        data: {
          tenantId,
          type: SOURCE_TYPE,
          name: SOURCE_NAME,
          dataClass: 'sensitive',
          isActive: true,
        },
        select: { id: true },
      });
    } catch (err) {
      const retry = await this.prisma.source.findUnique({
        where: {
          tenantId_type_name: {
            tenantId,
            type: SOURCE_TYPE,
            name: SOURCE_NAME,
          },
        },
        select: { id: true },
      });
      if (retry) return retry;
      throw err;
    }
  }

  async ingestCheckin(tenantId: string, checkInId: string): Promise<{ rawEventId: string } | null> {
    const checkIn = await this.prisma.dailyCheckIn.findFirst({
      where: { id: checkInId, tenantId },
      select: {
        id: true,
        personId: true,
        kind: true,
        dateLocal: true,
        plansJson: true,
        donesJson: true,
        blockersJson: true,
        rawResponseText: true,
        curatorReview: true,
        completedAt: true,
      },
    });
    if (!checkIn || checkIn.completedAt === null) return null;

    const person = await this.prisma.person.findFirst({
      where: { id: checkIn.personId, tenantId },
      select: { name: true },
    });
    const personName = person?.name ?? 'сотрудник';

    const plans = extractCheckinItems(checkIn.plansJson);
    const dones = extractCheckinItems(checkIn.donesJson);
    const blockers = extractCheckinItems(checkIn.blockersJson);

    const fullText = renderCheckinText({
      personName,
      dateLocal: checkIn.dateLocal,
      kind: checkIn.kind,
      plans,
      dones,
      blockers,
      rawResponseText: checkIn.rawResponseText,
    });

    const transcriptTurns = [
      {
        speaker: personName,
        text: fullText,
        startSec: 0,
        endSec: 1,
        speakerParticipantId: null,
        authorPersonId: checkIn.personId,
      },
    ];

    const payload = {
      kind: 'daily_checkin' as const,
      checkInId: checkIn.id,
      checkInKind: checkIn.kind,
      dateLocal: checkIn.dateLocal,
      personId: checkIn.personId,
      personName,
      curatorReview: checkIn.curatorReview,
      fullText,
      transcript: { turns: transcriptTurns },
    };

    const source = await this.upsertSource(tenantId);

    const occurredAt = checkinOccurredAt(checkIn.dateLocal, checkIn.completedAt);

    const res = await this.ingest.ingest({
      tenantId,
      sourceId: source.id,
      sourceExternalId: checkInId,
      occurredAt,
      payload,
      dataClass: 'sensitive',
    });

    return { rawEventId: res.rawEvent.id };
  }
}
