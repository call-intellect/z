import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { VoxService } from '../../ai/services/vox.service';
import type { VoxDiarizedSegment } from '../../ai/services/vox.types';
import type { MeetingsService } from '../../meetings/meetings.service';
import type { S3Service } from '../../recordings/s3.service';

import { MeetingUploadTranscribeWorker } from './meeting-upload-transcribe.worker';

/**
 * Фикстура результата Vox в форме Ф0 (diarizationEnabled:true), 2 спикера.
 * `segments` — то, что отдаёт `vox.poll` после parseVoxResult: startSec/endSec
 * в СЕКУНДАХ (float), speaker = "SPEAKER N", speakerId = int.
 */
const SEGMENTS: VoxDiarizedSegment[] = [
  { startSec: 0.0, endSec: 3.2, speaker: 'SPEAKER 1', speakerId: 1, text: 'Привет' },
  {
    startSec: 3.5,
    endSec: 12.8,
    speaker: 'SPEAKER 2',
    speakerId: 2,
    text: 'Давайте обсудим план на следующий квартал подробно и по пунктам',
  },
  { startSec: 13.0, endSec: 15.0, speaker: 'SPEAKER 1', speakerId: 1, text: 'Согласен с тобой' },
];

function make(opts: { numSpeakersHint?: number | null } = {}): {
  worker: MeetingUploadTranscribeWorker;
  prisma: any;
  s3: any;
  vox: any;
  meetings: any;
} {
  const prisma = {
    meeting: {
      findUnique: vi.fn(async () => ({
        id: 'm-1',
        source: 'upload',
        status: 'recording_ready',
        uploadNumSpeakersHint: opts.numSpeakersHint ?? null,
      })),
    },
    transcript: { upsert: vi.fn(async () => ({ id: 't-1' })) },
    meetingUploadSpeaker: { upsert: vi.fn(async () => ({ id: 'sp-1' })) },
  } as unknown as PrismaService;

  const s3 = {
    getObject: vi.fn(async () => Buffer.from('AUDIO_BYTES')),
    putJson: vi.fn(async () => undefined),
  } as unknown as S3Service;

  const vox = {
    submit: vi.fn(async () => ({ taskId: 'vox-task-1' })),
    poll: vi.fn(async () => ({
      status: 'COMPLETED' as const,
      transcriptText: 'Привет Давайте обсудим план ... Согласен с тобой',
      durationSeconds: 15,
      segments: SEGMENTS,
    })),
  } as unknown as VoxService;

  const meetings = {
    transitionStatus: vi.fn(async () => ({ id: 'm-1' })),
  } as unknown as MeetingsService;

  const redis = { client: {} } as unknown as RedisService;
  const cfg = {
    ai: { vox: { pollIntervalMs: 10, pollMaxAttempts: 3 } },
  } as unknown as TypedConfigService;

  const worker = new MeetingUploadTranscribeWorker(
    redis,
    prisma,
    vox,
    s3,
    meetings,
    cfg,
  );
  return { worker, prisma, s3, vox, meetings };
}

describe('MeetingUploadTranscribeWorker.processMeeting', () => {
  beforeEach(() => vi.clearAllMocks());

  it('диаризация 2 спикеров → Transcript.turns, MeetingUploadSpeaker[], status awaiting_speakers, БЕЗ анализа', async () => {
    const { worker, prisma, s3, vox, meetings } = make();

    await worker.processMeeting('m-1');

    // Vox вызван с диаризацией.
    expect((vox as any).submit).toHaveBeenCalledTimes(1);
    expect((vox as any).submit.mock.calls[0][1]).toMatchObject({
      diarizationEnabled: true,
    });

    // Transcript.turns: один turn на сегмент, ≥2 разных speaker.
    const transcriptArg = (prisma as any).transcript.upsert.mock.calls[0][0];
    const turns = transcriptArg.create.turns as Array<{
      speaker: string;
      text: string;
      startSec: number;
      endSec: number;
    }>;
    expect(turns).toHaveLength(3);
    const distinctSpeakers = new Set(turns.map((t) => t.speaker));
    expect(distinctSpeakers.size).toBeGreaterThanOrEqual(2);
    // displayLabel «Человек N».
    expect([...distinctSpeakers].every((s) => /^«Человек \d+»$/.test(s))).toBe(true);

    // startSec/endSec — СЕКУНДЫ напрямую из сегмента (без конвертации).
    expect(turns[1]!.startSec).toBeCloseTo(SEGMENTS[1]!.startSec);
    expect(turns[1]!.endSec).toBeCloseTo(SEGMENTS[1]!.endSec);

    // mergedS3Url + merged.json в S3 (как MergeWorker).
    expect(transcriptArg.create.mergedS3Url).toBe(
      'meetings/m-1/transcripts/merged.json',
    );
    expect((s3 as any).putJson).toHaveBeenCalledWith(
      'meetings/m-1/transcripts/merged.json',
      expect.objectContaining({ meetingId: 'm-1' }),
    );

    // MeetingUploadSpeaker — по числу меток (2 говорящих).
    expect((prisma as any).meetingUploadSpeaker.upsert).toHaveBeenCalledTimes(2);
    const speakerRows = (prisma as any).meetingUploadSpeaker.upsert.mock.calls.map(
      (c: any[]) => c[0],
    );
    const labels = speakerRows.map((r: any) => r.create.label).sort();
    expect(labels).toEqual(['SPEAKER 1', 'SPEAKER 2']);

    // sampleText спикера 1 — самый ДЛИННЫЙ его сегмент ("Согласен с тобой" >
    // "Привет"); у спикера 2 — единственный длинный сегмент.
    const sp1 = speakerRows.find((r: any) => r.create.label === 'SPEAKER 1')!;
    expect(sp1.create.sampleText).toBe('Согласен с тобой');
    expect(sp1.create.turnsCount).toBe(2);
    // speakingSeconds = round((3.2-0) + (15-13)) = round(5.2) = 5.
    expect(sp1.create.speakingSeconds).toBe(5);
    expect(sp1.create.displayLabel).toBe('«Человек 1»');

    const sp2 = speakerRows.find((r: any) => r.create.label === 'SPEAKER 2')!;
    expect(sp2.create.sampleText).toBe(SEGMENTS[1]!.text);
    expect(sp2.create.turnsCount).toBe(1);
    // round(12.8 - 3.5) = round(9.3) = 9.
    expect(sp2.create.speakingSeconds).toBe(9);

    // FSM: recording_processing → awaiting_speakers.
    const transitions = (meetings as any).transitionStatus.mock.calls.map(
      (c: any[]) => c[1],
    );
    expect(transitions).toContain('transcription_processing');
    expect(transitions).toContain('awaiting_speakers');
    // ГЕЙТ: НЕ ушли в ai_processing/transcription_ready.
    expect(transitions).not.toContain('ai_processing');
    expect(transitions).not.toContain('transcription_ready');
  });

  it('numSpeakersHint пробрасывается в Vox.submit', async () => {
    const { worker, vox } = make({ numSpeakersHint: 4 });

    await worker.processMeeting('m-1');

    expect((vox as any).submit.mock.calls[0][1]).toMatchObject({
      diarizationEnabled: true,
      numSpeakers: 4,
    });
  });

  it('повторный запуск (встреча уже в awaiting_speakers) → no-op', async () => {
    const { worker, prisma, vox } = make();
    (prisma as any).meeting.findUnique.mockResolvedValueOnce({
      id: 'm-1',
      source: 'upload',
      status: 'awaiting_speakers',
      uploadNumSpeakersHint: null,
    });

    await worker.processMeeting('m-1');

    expect((vox as any).submit).not.toHaveBeenCalled();
    expect((prisma as any).transcript.upsert).not.toHaveBeenCalled();
  });

  it('audio.ogg отсутствует → fallback на audio.wav', async () => {
    const { worker, s3, vox } = make();
    (s3 as any).getObject
      .mockRejectedValueOnce(new Error('NoSuchKey'))
      .mockResolvedValueOnce(Buffer.from('WAV_BYTES'));

    await worker.processMeeting('m-1');

    const keys = (s3 as any).getObject.mock.calls.map((c: any[]) => c[0]);
    expect(keys).toContain('meetings/m-1/upload/audio.ogg');
    expect(keys).toContain('meetings/m-1/upload/audio.wav');
    expect((vox as any).submit).toHaveBeenCalledTimes(1);
  });
});
