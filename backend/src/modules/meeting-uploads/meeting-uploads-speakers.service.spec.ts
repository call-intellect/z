import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { S3Service } from '../recordings/s3.service';

import type { MeetingUploadsQueueService } from './meeting-uploads-queue.service';
import { MeetingUploadsService } from './meeting-uploads.service';

interface SpeakerRow {
  label: string;
  displayLabel: string;
  turnsCount: number;
  speakingSeconds: number;
  sampleText: string;
  assignment: string;
  personId: string | null;
  externalName: string | null;
  externalCompany: string | null;
  externalPosition: string | null;
  mergedIntoLabel: string | null;
  participantId: string | null;
}

function makeSpeaker(
  over: Partial<SpeakerRow> & Pick<SpeakerRow, 'label' | 'displayLabel'>,
): SpeakerRow {
  return {
    turnsCount: 1,
    speakingSeconds: 30,
    sampleText: 'текст',
    assignment: 'unassigned',
    personId: null,
    externalName: null,
    externalCompany: null,
    externalPosition: null,
    mergedIntoLabel: null,
    participantId: null,
    ...over,
  };
}

function makeService(setup: {
  meetingStatus?: string;
  speakers: SpeakerRow[];
  turns?: any[];
  persons?: Record<string, { id: string; name: string }>;
}): {
  service: MeetingUploadsService;
  prisma: any;
  s3: any;
  meetings: any;
  aiQueue: any;
  coreQueue: any;
  personsSvc: any;
  participantCreate: ReturnType<typeof vi.fn>;
  speakerUpdate: ReturnType<typeof vi.fn>;
  transcriptUpdate: ReturnType<typeof vi.fn>;
} {
  const speakers = setup.speakers;
  const turns = setup.turns ?? [];
  const personsById = setup.persons ?? {};

  const participantCreate = vi.fn(async ({ data, select }: any) => ({
    id: `part-${data.livekitIdentity}`,
    name: data.name,
    ...(select ? {} : {}),
  }));
  const speakerUpdate = vi.fn(async () => ({}));
  const transcriptUpdate = vi.fn(async () => ({}));

  const prisma = {
    meeting: {
      findUnique: vi.fn(async () => ({
        id: 'm-1',
        tenantId: 'org-1',
        source: 'upload',
        status: setup.meetingStatus ?? 'awaiting_speakers',
      })),
    },
    meetingUploadSpeaker: {
      findMany: vi.fn(async () => speakers.map((s) => ({ ...s }))),
      update: speakerUpdate,
    },
    transcript: {
      findUnique: vi.fn(async () => ({ turns })),
      update: transcriptUpdate,
    },
    participant: {
      create: participantCreate,
      findUnique: vi.fn(async ({ where }: any) => {
        const reuse = Object.values(personsById);
        void reuse;
        if (where.id?.startsWith?.('part-')) {
          return { id: where.id, name: 'Переиспользован' };
        }
        return null;
      }),
    },
    person: {
      findFirst: vi.fn(async ({ where }: any) => {
        const p = personsById[where.id];
        return p ? { id: p.id, name: p.name } : null;
      }),
      findMany: vi.fn(async ({ where }: any) => {
        const ids: string[] = where.id?.in ?? [];
        return ids.filter((id) => personsById[id]).map((id) => ({ id }));
      }),
    },
  } as unknown as PrismaService;

  const s3 = {
    putJson: vi.fn(async () => undefined),
  } as unknown as S3Service;

  const cfg = {
    knowledgeCore: { meetingReportFastEnabled: true },
  } as unknown as TypedConfigService;

  const queue = {} as unknown as MeetingUploadsQueueService;

  const meetings = { transitionStatus: vi.fn(async () => ({})) } as any;
  const personsSvc = {
    findOrCreateExternal: vi.fn(async (args: any) => ({
      id: `ext-${args.name}`,
    })),
  } as any;
  const aiQueue = {
    enqueueAnalyze: vi.fn(async () => undefined),
    enqueueBehaviorMetrics: vi.fn(async () => undefined),
  } as any;
  const coreQueue = {
    enqueueMeetingReportFast: vi.fn(async () => undefined),
  } as any;

  const service = new MeetingUploadsService(
    prisma,
    s3,
    cfg,
    queue,
    meetings,
    personsSvc,
    aiQueue,
    coreQueue,
  );

  return {
    service,
    prisma,
    s3,
    meetings,
    aiQueue,
    coreQueue,
    personsSvc,
    participantCreate,
    speakerUpdate,
    transcriptUpdate,
  };
}

describe('MeetingUploadsService.confirmSpeakers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('неполная разметка → SPEAKERS_NOT_FULLY_ASSIGNED, статус не меняется', async () => {
    const { service, meetings, aiQueue } = makeService({
      speakers: [
        makeSpeaker({ label: 'SPEAKER 0', displayLabel: '«Человек 0»', assignment: 'unassigned' }),
      ],
    });

    await expect(service.confirmSpeakers('m-1', 'org-1')).rejects.toMatchObject({
      response: { error: { code: 'SPEAKERS_NOT_FULLY_ASSIGNED' } },
    });
    expect(meetings.transitionStatus).not.toHaveBeenCalled();
    expect(aiQueue.enqueueAnalyze).not.toHaveBeenCalled();
  });

  it('1 employee + 1 external → 2 Participant, переразметка имён + participantId, ai_processing, 3 enqueue', async () => {
    const ctx = makeService({
      persons: { 'pers-1': { id: 'pers-1', name: 'Иван Петров' } },
      speakers: [
        makeSpeaker({
          label: 'SPEAKER 0',
          displayLabel: '«Человек 0»',
          assignment: 'employee',
          personId: 'pers-1',
        }),
        makeSpeaker({
          label: 'SPEAKER 1',
          displayLabel: '«Человек 1»',
          assignment: 'external',
          externalName: 'Анна Клиент',
          externalCompany: 'ООО Ромашка',
          externalPosition: 'Директор',
        }),
      ],
      turns: [
        {
          speaker: '«Человек 0»',
          text: 'Привет',
          startSec: 0,
          endSec: 2,
          speakerParticipantId: null,
          speakerLivekitIdentity: null,
        },
        {
          speaker: '«Человек 1»',
          text: 'Здравствуйте',
          startSec: 2,
          endSec: 4,
          speakerParticipantId: null,
          speakerLivekitIdentity: null,
        },
      ],
    });

    const res = await ctx.service.confirmSpeakers('m-1', 'org-1');

    expect(res.status).toBe('ai_processing');
    expect(ctx.participantCreate).toHaveBeenCalledTimes(2);
    const idents = ctx.participantCreate.mock.calls.map((c: any) => c[0].data.livekitIdentity);
    expect(idents).toContain('upload:SPEAKER 0');
    expect(idents).toContain('upload:SPEAKER 1');
    for (const c of ctx.participantCreate.mock.calls) {
      expect(c[0].data.role).toBe('guest');
    }
    expect(ctx.personsSvc.findOrCreateExternal).toHaveBeenCalledWith({
      tenantId: 'org-1',
      name: 'Анна Клиент',
      company: 'ООО Ромашка',
      jobTitle: 'Директор',
    });
    const written = (ctx.transcriptUpdate.mock.calls[0] as any)[0].data.turns;
    expect(written[0].speaker).toBe('Иван Петров');
    expect(written[0].speakerParticipantId).toBe('part-upload:SPEAKER 0');
    expect(written[1].speaker).toBe('Анна Клиент');
    expect(written[1].speakerParticipantId).toBe('part-upload:SPEAKER 1');
    expect((ctx.s3 as any).putJson).toHaveBeenCalledTimes(1);
    expect(ctx.meetings.transitionStatus).toHaveBeenCalledWith(
      'm-1',
      'ai_processing',
      expect.anything(),
    );
    expect(ctx.aiQueue.enqueueAnalyze).toHaveBeenCalledWith('m-1');
    expect(ctx.aiQueue.enqueueBehaviorMetrics).toHaveBeenCalledWith('m-1');
    expect(ctx.coreQueue.enqueueMeetingReportFast).toHaveBeenCalledWith('m-1');
  });

  it('merge → 1 Participant на обе метки, обе реплики становятся одним именем', async () => {
    const ctx = makeService({
      persons: { 'pers-1': { id: 'pers-1', name: 'Иван Петров' } },
      speakers: [
        makeSpeaker({
          label: 'SPEAKER 0',
          displayLabel: '«Человек 0»',
          assignment: 'employee',
          personId: 'pers-1',
        }),
        makeSpeaker({
          label: 'SPEAKER 1',
          displayLabel: '«Человек 1»',
          assignment: 'merged',
          mergedIntoLabel: 'SPEAKER 0',
        }),
      ],
      turns: [
        {
          speaker: '«Человек 0»',
          text: 'Раз',
          startSec: 0,
          endSec: 1,
          speakerParticipantId: null,
          speakerLivekitIdentity: null,
        },
        {
          speaker: '«Человек 1»',
          text: 'Два',
          startSec: 1,
          endSec: 2,
          speakerParticipantId: null,
          speakerLivekitIdentity: null,
        },
      ],
    });

    await ctx.service.confirmSpeakers('m-1', 'org-1');

    expect(ctx.participantCreate).toHaveBeenCalledTimes(1);
    expect((ctx.participantCreate.mock.calls[0] as any)[0].data.livekitIdentity).toBe(
      'upload:SPEAKER 0',
    );
    const written = (ctx.transcriptUpdate.mock.calls[0] as any)[0].data.turns;
    expect(written).toHaveLength(2);
    expect(written[0].speaker).toBe('Иван Петров');
    expect(written[1].speaker).toBe('Иван Петров');
    expect(written[0].speakerParticipantId).toBe('part-upload:SPEAKER 0');
    expect(written[1].speakerParticipantId).toBe('part-upload:SPEAKER 0');
  });

  it('exclude → реплики метки удаляются из транскрипта', async () => {
    const ctx = makeService({
      persons: { 'pers-1': { id: 'pers-1', name: 'Иван Петров' } },
      speakers: [
        makeSpeaker({
          label: 'SPEAKER 0',
          displayLabel: '«Человек 0»',
          assignment: 'employee',
          personId: 'pers-1',
        }),
        makeSpeaker({
          label: 'SPEAKER 1',
          displayLabel: '«Человек 1»',
          assignment: 'excluded',
        }),
      ],
      turns: [
        {
          speaker: '«Человек 0»',
          text: 'Оставить',
          startSec: 0,
          endSec: 1,
          speakerParticipantId: null,
          speakerLivekitIdentity: null,
        },
        {
          speaker: '«Человек 1»',
          text: 'Выкинуть',
          startSec: 1,
          endSec: 2,
          speakerParticipantId: null,
          speakerLivekitIdentity: null,
        },
      ],
    });

    await ctx.service.confirmSpeakers('m-1', 'org-1');

    const written = (ctx.transcriptUpdate.mock.calls[0] as any)[0].data.turns;
    expect(written).toHaveLength(1);
    expect(written[0].speaker).toBe('Иван Петров');
    expect(ctx.participantCreate).toHaveBeenCalledTimes(1);
  });

  it('re-confirm → no-op: переиспользует participantId, новый Participant не создаётся', async () => {
    const ctx = makeService({
      persons: { 'pers-1': { id: 'pers-1', name: 'Иван Петров' } },
      speakers: [
        makeSpeaker({
          label: 'SPEAKER 0',
          displayLabel: '«Человек 0»',
          assignment: 'employee',
          personId: 'pers-1',
          participantId: 'part-upload:SPEAKER 0',
        }),
      ],
      turns: [
        {
          speaker: '«Человек 0»',
          text: 'Привет',
          startSec: 0,
          endSec: 1,
          speakerParticipantId: null,
          speakerLivekitIdentity: null,
        },
      ],
    });

    await ctx.service.confirmSpeakers('m-1', 'org-1');

    expect(ctx.participantCreate).not.toHaveBeenCalled();
    const written = (ctx.transcriptUpdate.mock.calls[0] as any)[0].data.turns;
    expect(written[0].speakerParticipantId).toBe('part-upload:SPEAKER 0');
  });

  it('встреча не awaiting_speakers → MEETING_NOT_AWAITING_SPEAKERS', async () => {
    const { service } = makeService({
      meetingStatus: 'ai_processing',
      speakers: [],
    });
    await expect(service.confirmSpeakers('m-1', 'org-1')).rejects.toMatchObject({
      response: { error: { code: 'MEETING_NOT_AWAITING_SPEAKERS' } },
    });
  });
});
