export interface BehaviorDiarizationSegment {
  speaker: string;
  startMs: number;
  endMs: number;
  text?: string;
  confidence?: number;
}

export interface BehaviorParticipantInput {
  id: string;
  identity: string;
  displayName: string;
  isGuest: boolean;
}

export interface BehaviorCalculatorInput {
  meetingId: string;
  tenantId: string;
  totalDurationMs: number;
  diarization: BehaviorDiarizationSegment[];
  participants: BehaviorParticipantInput[];
  diarizationConfidence?: number;
  wordTimingsAvailable?: boolean;
}

export interface BehaviorMeetingMetrics {
  totalDurationMs: number;
  totalSpeechMs: number;
  silenceMs: number;
  silencePercent: number;
  crossTalkMs: number;
  dominanceIndex: number;
  diarizationConfidence: number;
  lowConfidence: boolean;
}

export interface BehaviorParticipantMetrics {
  participantId: string | null;
  displayName: string;
  isGuest: boolean;
  speakingTimeMs: number;
  speakingTimePercent: number;
  turnsCount: number;
  avgTurnDurationMs: number;
  monologueCount: number;
  longestMonologueMs: number;
  questionCount: number;
  fillerWordsCount: number;
  interruptionsMadeCount: number;
  interruptionsReceivedCount: number;
}

export interface BehaviorCalculatorResult {
  meeting: BehaviorMeetingMetrics;
  participants: BehaviorParticipantMetrics[];
}

export const MONOLOGUE_THRESHOLD_MS = 60_000;
export const TURN_GAP_MS = 2_000;
export const INTERRUPTION_MIN_OVERLAP_MS = 500;
export const MIN_MEETING_DURATION_MS = 60_000;
export const LOW_CONFIDENCE_THRESHOLD = 0.85;

export const FILLER_WORDS_RU: readonly string[] = [
  'эээ',
  'ммм',
  'ну',
  'вот',
  'как бы',
  'типа',
  'короче',
  'значит',
  'это самое',
  'в общем',
  'в принципе',
  'так сказать',
];

interface NormalisedSegment extends BehaviorDiarizationSegment {
  speakerKey: string;
}

export function calculateBehaviorMetrics(input: BehaviorCalculatorInput): BehaviorCalculatorResult {
  const diarizationConfidence = resolveDiarizationConfidence(input);
  const lowConfidenceFromDiar = diarizationConfidence < LOW_CONFIDENCE_THRESHOLD;
  const lowConfidenceFromDuration = input.totalDurationMs < MIN_MEETING_DURATION_MS;

  if (lowConfidenceFromDuration) {
    return {
      meeting: emptyMeetingMetrics(input.totalDurationMs, diarizationConfidence, true),
      participants: input.participants.map((p) => emptyParticipantMetrics(p)),
    };
  }

  const segments = normaliseSegments(input.diarization);

  const speakerMap = buildSpeakerMap(input.participants, segments);

  const segmentsByParticipantKey = new Map<string, NormalisedSegment[]>();
  for (const seg of segments) {
    const key = seg.speakerKey;
    const list = segmentsByParticipantKey.get(key) ?? [];
    list.push(seg);
    segmentsByParticipantKey.set(key, list);
  }

  const totalSpeechMs = segments.reduce((sum, s) => sum + Math.max(0, s.endMs - s.startMs), 0);
  const unionSpeechMs = unionDurationMs(segments);
  const silenceMs = Math.max(0, input.totalDurationMs - unionSpeechMs);
  const silencePercent =
    input.totalDurationMs > 0 ? roundFloat((silenceMs / input.totalDurationMs) * 100) : 0;
  const crossTalkMs = computeCrossTalkMs(segments);

  const seenKeys = new Set<string>();
  const participantMetrics: BehaviorParticipantMetrics[] = [];

  for (const p of input.participants) {
    const key = p.identity.toLowerCase();
    seenKeys.add(key);
    const segs = segmentsByParticipantKey.get(key) ?? [];
    participantMetrics.push(
      computeParticipantMetrics({
        participantId: p.id,
        displayName: p.displayName,
        isGuest: p.isGuest,
        segments: segs,
        allSegments: segments,
        speakerKey: key,
        totalSpeechMsOfMeeting: unionSpeechMs,
      }),
    );
  }

  for (const [key, segs] of segmentsByParticipantKey.entries()) {
    if (seenKeys.has(key)) continue;
    const matched = speakerMap.get(key);
    const displayName = matched?.displayName ?? segs[0]?.speaker ?? 'Гость';
    participantMetrics.push(
      computeParticipantMetrics({
        participantId: null,
        displayName,
        isGuest: true,
        segments: segs,
        allSegments: segments,
        speakerKey: key,
        totalSpeechMsOfMeeting: unionSpeechMs,
      }),
    );
  }

  const speakingTimes = participantMetrics.map((m) => m.speakingTimeMs);
  const dominanceIndex = computeDominanceIndex(speakingTimes);

  return {
    meeting: {
      totalDurationMs: input.totalDurationMs,
      totalSpeechMs,
      silenceMs,
      silencePercent,
      crossTalkMs,
      dominanceIndex,
      diarizationConfidence: roundFloat(diarizationConfidence),
      lowConfidence: lowConfidenceFromDiar || input.wordTimingsAvailable === false,
    },
    participants: participantMetrics,
  };
}

function resolveDiarizationConfidence(input: BehaviorCalculatorInput): number {
  if (typeof input.diarizationConfidence === 'number') {
    return clamp01(input.diarizationConfidence);
  }
  const withConf = input.diarization.filter((s) => typeof s.confidence === 'number');
  if (withConf.length === 0) return 1.0;
  const sum = withConf.reduce((acc, s) => acc + (s.confidence ?? 0), 0);
  return clamp01(sum / withConf.length);
}

function normaliseSegments(diar: BehaviorDiarizationSegment[]): NormalisedSegment[] {
  const out: NormalisedSegment[] = [];
  for (const s of diar) {
    if (!s || s.endMs <= s.startMs) continue;
    out.push({ ...s, speakerKey: (s.speaker ?? '').toLowerCase() });
  }
  out.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  return out;
}

function buildSpeakerMap(
  participants: BehaviorParticipantInput[],
  segments: NormalisedSegment[],
): Map<string, BehaviorParticipantInput | undefined> {
  const byIdentity = new Map<string, BehaviorParticipantInput>();
  const byName = new Map<string, BehaviorParticipantInput>();
  for (const p of participants) {
    byIdentity.set(p.identity.toLowerCase(), p);
    byName.set(p.displayName.toLowerCase(), p);
  }
  const map = new Map<string, BehaviorParticipantInput | undefined>();
  for (const s of segments) {
    if (map.has(s.speakerKey)) continue;
    map.set(s.speakerKey, byIdentity.get(s.speakerKey) ?? byName.get(s.speakerKey));
  }
  return map;
}

function unionDurationMs(segments: NormalisedSegment[]): number {
  if (segments.length === 0) return 0;
  let total = 0;
  let curStart = segments[0]!.startMs;
  let curEnd = segments[0]!.endMs;
  for (let i = 1; i < segments.length; i++) {
    const s = segments[i]!;
    if (s.startMs > curEnd) {
      total += curEnd - curStart;
      curStart = s.startMs;
      curEnd = s.endMs;
    } else if (s.endMs > curEnd) {
      curEnd = s.endMs;
    }
  }
  total += curEnd - curStart;
  return total;
}

function computeCrossTalkMs(segments: NormalisedSegment[]): number {
  let total = 0;
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i]!;
    for (let j = i + 1; j < segments.length; j++) {
      const b = segments[j]!;
      if (b.startMs >= a.endMs) break;
      if (a.speakerKey === b.speakerKey) continue;
      const overlapStart = Math.max(a.startMs, b.startMs);
      const overlapEnd = Math.min(a.endMs, b.endMs);
      if (overlapEnd > overlapStart) total += overlapEnd - overlapStart;
    }
  }
  return total;
}

interface ParticipantCalcParams {
  participantId: string | null;
  displayName: string;
  isGuest: boolean;
  segments: NormalisedSegment[];
  allSegments: NormalisedSegment[];
  speakerKey: string;
  totalSpeechMsOfMeeting: number;
}

function computeParticipantMetrics(p: ParticipantCalcParams): BehaviorParticipantMetrics {
  const segs = [...p.segments].sort((a, b) => a.startMs - b.startMs);

  const speakingTimeMs = segs.reduce((sum, s) => sum + Math.max(0, s.endMs - s.startMs), 0);
  const speakingTimePercent =
    p.totalSpeechMsOfMeeting > 0
      ? roundFloat((speakingTimeMs / p.totalSpeechMsOfMeeting) * 100)
      : 0;

  const turns: { startMs: number; endMs: number }[] = [];
  for (const s of segs) {
    const last = turns[turns.length - 1];
    if (last && s.startMs - last.endMs < TURN_GAP_MS) {
      if (s.endMs > last.endMs) last.endMs = s.endMs;
    } else {
      turns.push({ startMs: s.startMs, endMs: s.endMs });
    }
  }
  const turnsCount = turns.length;
  const turnDurations = turns.map((t) => t.endMs - t.startMs);
  const avgTurnDurationMs =
    turnsCount > 0 ? roundFloat(turnDurations.reduce((a, b) => a + b, 0) / turnsCount) : 0;
  const monologueCount = turnDurations.filter((d) => d >= MONOLOGUE_THRESHOLD_MS).length;
  const longestMonologueMs = turnDurations.length > 0 ? Math.max(...turnDurations) : 0;

  let questionCount = 0;
  let fillerWordsCount = 0;
  for (const s of segs) {
    const text = s.text ?? '';
    if (!text) continue;
    questionCount += countQuestions(text);
    fillerWordsCount += countFillers(text);
  }

  let interruptionsMade = 0;
  let interruptionsReceived = 0;
  for (const s of segs) {
    for (const a of p.allSegments) {
      if (a.speakerKey === p.speakerKey) continue;
      if (s.startMs < a.startMs || s.startMs > a.endMs) continue;
      const overlap = Math.min(s.endMs, a.endMs) - s.startMs;
      if (overlap >= INTERRUPTION_MIN_OVERLAP_MS) {
        interruptionsMade += 1;
        break;
      }
    }
  }
  for (const a of segs) {
    let received = false;
    for (const b of p.allSegments) {
      if (b.speakerKey === p.speakerKey) continue;
      if (b.startMs < a.startMs || b.startMs > a.endMs) continue;
      const overlap = Math.min(b.endMs, a.endMs) - b.startMs;
      if (overlap >= INTERRUPTION_MIN_OVERLAP_MS) {
        received = true;
        break;
      }
    }
    if (received) interruptionsReceived += 1;
  }

  return {
    participantId: p.participantId,
    displayName: p.displayName,
    isGuest: p.isGuest,
    speakingTimeMs,
    speakingTimePercent,
    turnsCount,
    avgTurnDurationMs,
    monologueCount,
    longestMonologueMs,
    questionCount,
    fillerWordsCount,
    interruptionsMadeCount: interruptionsMade,
    interruptionsReceivedCount: interruptionsReceived,
  };
}

function countQuestions(text: string): number {
  let count = 0;
  for (const ch of text) if (ch === '?') count += 1;
  return count;
}

const FILLER_REGEX_CACHE = new Map<string, RegExp>();
function fillerRegex(word: string): RegExp {
  const cached = FILLER_REGEX_CACHE.get(word);
  if (cached) {
    cached.lastIndex = 0;
    return cached;
  }
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[^а-яёa-z])(${escaped})(?=[^а-яёa-z]|$)`, 'giu');
  FILLER_REGEX_CACHE.set(word, re);
  return re;
}

function countFillers(text: string): number {
  let total = 0;
  const lower = text.toLowerCase();
  for (const w of FILLER_WORDS_RU) {
    const re = fillerRegex(w);
    let _match: RegExpExecArray | null;
    while ((_match = re.exec(lower)) !== null) {
      total += 1;
    }
  }
  return total;
}

function computeDominanceIndex(speakingTimes: number[]): number {
  if (speakingTimes.length === 0) return 0;
  const max = Math.max(...speakingTimes);
  if (max === 0) return 0;
  const median = computeMedian(speakingTimes);
  if (median === 0) return 999;
  return roundFloat(max / median);
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid]!;
  }
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function roundFloat(v: number): number {
  return Math.round(v * 100) / 100;
}

function emptyMeetingMetrics(
  totalDurationMs: number,
  diarizationConfidence: number,
  lowConfidence: boolean,
): BehaviorMeetingMetrics {
  return {
    totalDurationMs: Math.max(0, totalDurationMs),
    totalSpeechMs: 0,
    silenceMs: Math.max(0, totalDurationMs),
    silencePercent: totalDurationMs > 0 ? 100 : 0,
    crossTalkMs: 0,
    dominanceIndex: 0,
    diarizationConfidence: roundFloat(diarizationConfidence),
    lowConfidence,
  };
}

function emptyParticipantMetrics(p: BehaviorParticipantInput): BehaviorParticipantMetrics {
  return {
    participantId: p.id,
    displayName: p.displayName,
    isGuest: p.isGuest,
    speakingTimeMs: 0,
    speakingTimePercent: 0,
    turnsCount: 0,
    avgTurnDurationMs: 0,
    monologueCount: 0,
    longestMonologueMs: 0,
    questionCount: 0,
    fillerWordsCount: 0,
    interruptionsMadeCount: 0,
    interruptionsReceivedCount: 0,
  };
}

import { Injectable } from '@nestjs/common';

@Injectable()
export class BehaviorMetricsCalculator {
  calculate(input: BehaviorCalculatorInput): BehaviorCalculatorResult {
    return calculateBehaviorMetrics(input);
  }
}
