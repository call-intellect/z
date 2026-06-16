import { Logger } from '@nestjs/common';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { DialogTurn, RoomChatMessage } from './prompts/common';

export type { DialogTurn };

const roomChatLogger = new Logger('Merger.roomChat');

export interface PerTrackWords {
  speakerName: string;
  words: Array<{ word: string; startMs: number; endMs: number }>;
  trackStartedAt: Date;
  baseStartedAt: Date;
  participantId?: string | null;
  livekitIdentity?: string | null;
}

interface AbsoluteWord {
  speaker: string;
  word: string;
  absStartSec: number;
  absEndSec: number;
  participantId?: string | null;
  livekitIdentity?: string | null;
}

const DEFAULT_TURN_GAP_SEC = 1.5;

export function mergeWordTimestamps(
  perTrack: PerTrackWords[],
  options: { gapSec?: number } = {},
): DialogTurn[] {
  if (perTrack.length === 0) return [];

  const gapSec = options.gapSec ?? DEFAULT_TURN_GAP_SEC;

  const allWords: AbsoluteWord[] = [];
  for (const track of perTrack) {
    const trackOffsetMs = track.trackStartedAt.getTime() - track.baseStartedAt.getTime();
    for (const w of track.words) {
      const absStartMs = trackOffsetMs + w.startMs;
      const absEndMs = trackOffsetMs + w.endMs;
      allWords.push({
        speaker: track.speakerName,
        word: w.word,
        absStartSec: absStartMs / 1000,
        absEndSec: absEndMs / 1000,
        participantId: track.participantId ?? null,
        livekitIdentity: track.livekitIdentity ?? null,
      });
    }
  }

  if (allWords.length === 0) return [];

  allWords.sort((a, b) => a.absStartSec - b.absStartSec || a.absEndSec - b.absEndSec);

  const turns: DialogTurn[] = [];
  let currentSpeaker: string | null = null;
  let currentText: string[] = [];
  let currentStart = 0;
  let currentEnd = 0;
  let currentParticipantId: string | null = null;
  let currentLivekitIdentity: string | null = null;

  const flush = (): void => {
    if (currentSpeaker !== null && currentText.length > 0) {
      turns.push({
        speaker: currentSpeaker,
        text: currentText.join(' ').trim(),
        startSec: currentStart,
        endSec: currentEnd,
        speakerParticipantId: currentParticipantId,
        speakerLivekitIdentity: currentLivekitIdentity,
      });
    }
    currentSpeaker = null;
    currentText = [];
    currentStart = 0;
    currentEnd = 0;
    currentParticipantId = null;
    currentLivekitIdentity = null;
  };

  for (const w of allWords) {
    const speakerChanged = currentSpeaker !== null && currentSpeaker !== w.speaker;
    const gap = currentSpeaker !== null ? w.absStartSec - currentEnd : 0;
    const gapTooLarge = currentSpeaker !== null && gap > gapSec;

    if (speakerChanged || gapTooLarge) {
      flush();
    }

    if (currentSpeaker === null) {
      currentSpeaker = w.speaker;
      currentStart = w.absStartSec;
      currentParticipantId = w.participantId ?? null;
      currentLivekitIdentity = w.livekitIdentity ?? null;
    }
    currentText.push(w.word);
    currentEnd = w.absEndSec;
  }
  flush();

  return turns;
}

export function countWords(turns: DialogTurn[]): number {
  return turns.reduce((sum, t) => sum + (t.text === '' ? 0 : t.text.split(/\s+/).length), 0);
}

export function maxEndSec(turns: DialogTurn[]): number {
  let max = 0;
  for (const t of turns) {
    if (t.endSec > max) max = t.endSec;
  }
  return Math.round(max);
}

export async function loadRoomChatForMerge(args: {
  prisma: PrismaService;
  cfg: TypedConfigService;
  meetingId: string;
}): Promise<RoomChatMessage[] | null> {
  const { prisma, cfg, meetingId } = args;
  const includeRoomChat = cfg.aiFeatures.includeRoomChat;
  if (!includeRoomChat) {
    roomChatLogger.debug({ meetingId, includeRoomChat: false }, 'roomChat выключен флагом');
    return null;
  }

  const rows = await prisma.meetingRoomMessage.findMany({
    where: { meetingId },
    orderBy: { sentAt: 'asc' },
    select: { authorName: true, content: true, sentAt: true },
  });

  if (rows.length === 0) {
    roomChatLogger.debug(
      { meetingId, chatCount: 0, includeRoomChat: true },
      'roomChat пустой — ключ в merged.json не добавляется',
    );
    return null;
  }

  roomChatLogger.debug(
    { meetingId, chatCount: rows.length, includeRoomChat: true },
    'roomChat подмешан в merged.json',
  );

  return rows.map((r) => ({
    sentAt: r.sentAt.toISOString(),
    authorName: r.authorName,
    content: r.content,
  }));
}
