import { describe, expect, it } from 'vitest';

import {
  type BehaviorCalculatorInput,
  type BehaviorDiarizationSegment,
  type BehaviorParticipantInput,
  calculateBehaviorMetrics,
} from './behavior-metrics-calculator';

function p(
  id: string,
  identity: string,
  displayName = identity,
  isGuest = false,
): BehaviorParticipantInput {
  return { id, identity, displayName, isGuest };
}

function seg(
  speaker: string,
  startMs: number,
  endMs: number,
  text = '',
  confidence?: number,
): BehaviorDiarizationSegment {
  return { speaker, startMs, endMs, text, confidence };
}

const ALICE = p('p_alice', 'alice', 'Алиса');
const BOB = p('p_bob', 'bob', 'Боб');
const CHARLIE = p('p_charlie', 'charlie', 'Чарли');

function buildInput(overrides: Partial<BehaviorCalculatorInput>): BehaviorCalculatorInput {
  return {
    meetingId: 'mtg_test',
    tenantId: 'tenant_test',
    totalDurationMs: 300_000,
    diarization: [],
    participants: [ALICE, BOB],
    diarizationConfidence: 0.95,
    ...overrides,
  };
}

describe('BehaviorMetricsCalculator', () => {
  it('считает speakingTimeMs и speakingTimePercent по участникам', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        diarization: [seg('alice', 0, 30_000), seg('bob', 30_000, 90_000)],
      }),
    );
    expect(r.participants).toHaveLength(2);
    const alice = r.participants.find((m) => m.participantId === 'p_alice')!;
    const bob = r.participants.find((m) => m.participantId === 'p_bob')!;
    expect(alice.speakingTimeMs).toBe(30_000);
    expect(bob.speakingTimeMs).toBe(60_000);
    expect(alice.speakingTimePercent).toBeCloseTo(33.33, 1);
    expect(bob.speakingTimePercent).toBeCloseTo(66.67, 1);
    expect(r.meeting.totalSpeechMs).toBe(90_000);
    expect(r.meeting.silenceMs).toBe(210_000);
    expect(r.meeting.silencePercent).toBeCloseTo(70, 1);
  });

  it('склеивает соседние сегменты одного спикера с gap < 2s в один turn', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        diarization: [
          seg('alice', 0, 5_000),
          seg('alice', 5_500, 10_000),
          seg('alice', 30_000, 35_000),
        ],
      }),
    );
    const alice = r.participants.find((m) => m.participantId === 'p_alice')!;
    expect(alice.turnsCount).toBe(2);
    expect(alice.avgTurnDurationMs).toBe(7500);
  });

  it('считает monologueCount по порогу 60s и longestMonologueMs', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        diarization: [
          seg('alice', 0, 70_000),
          seg('alice', 100_000, 120_000),
          seg('alice', 200_000, 290_000),
        ],
      }),
    );
    const alice = r.participants.find((m) => m.participantId === 'p_alice')!;
    expect(alice.monologueCount).toBe(2);
    expect(alice.longestMonologueMs).toBe(90_000);
  });

  it('считает количество вопросов по знаку «?»', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        diarization: [
          seg('alice', 0, 10_000, 'Ты что думаешь? А может, ещё раз обсудим?'),
          seg('alice', 10_000, 20_000, 'Хорошо.'),
        ],
      }),
    );
    const alice = r.participants.find((m) => m.participantId === 'p_alice')!;
    expect(alice.questionCount).toBe(2);
  });

  it('считает слова-паразиты, учитывая кириллицу и multi-word фразы', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        diarization: [
          seg('alice', 0, 10_000, 'Ну вообще как бы это типа в общем понятно.'),
          seg('alice', 10_000, 20_000, 'Вот и всё.'),
        ],
      }),
    );
    const alice = r.participants.find((m) => m.participantId === 'p_alice')!;
    expect(alice.fillerWordsCount).toBe(5);
  });

  it('считает interruptionsMade у прерывающего и received у прерванного', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        diarization: [seg('alice', 0, 10_000), seg('bob', 5_000, 7_000)],
      }),
    );
    const alice = r.participants.find((m) => m.participantId === 'p_alice')!;
    const bob = r.participants.find((m) => m.participantId === 'p_bob')!;
    expect(bob.interruptionsMadeCount).toBe(1);
    expect(alice.interruptionsReceivedCount).toBe(1);
    expect(alice.interruptionsMadeCount).toBe(0);
    expect(bob.interruptionsReceivedCount).toBe(0);
  });

  it('не считает прерывание при перекрытии < 500ms', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        diarization: [seg('alice', 0, 10_000), seg('bob', 9_800, 11_000)],
      }),
    );
    const alice = r.participants.find((m) => m.participantId === 'p_alice')!;
    const bob = r.participants.find((m) => m.participantId === 'p_bob')!;
    expect(bob.interruptionsMadeCount).toBe(0);
    expect(alice.interruptionsReceivedCount).toBe(0);
  });

  it('считает crossTalkMs как сумму пересечений разных спикеров', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        diarization: [
          seg('alice', 0, 10_000),
          seg('bob', 5_000, 7_000),
          seg('alice', 20_000, 25_000),
          seg('bob', 24_000, 28_000),
        ],
      }),
    );
    expect(r.meeting.crossTalkMs).toBe(3_000);
  });

  it('dominanceIndex = max/median, корректно работает при median > 0', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        participants: [ALICE, BOB, CHARLIE],
        diarization: [
          seg('alice', 0, 100_000),
          seg('bob', 100_000, 150_000),
          seg('charlie', 150_000, 175_000),
        ],
      }),
    );
    expect(r.meeting.dominanceIndex).toBe(2);
  });

  it('dominanceIndex = 999, когда median speakingTimes равен 0', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        participants: [ALICE, BOB, CHARLIE],
        diarization: [seg('alice', 0, 90_000)],
      }),
    );
    expect(r.meeting.dominanceIndex).toBe(999);
  });

  it('короткая встреча (<60s): метрики нулевые, lowConfidence=true', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        totalDurationMs: 30_000,
        diarization: [seg('alice', 0, 30_000, 'Привет всем.')],
      }),
    );
    expect(r.meeting.lowConfidence).toBe(true);
    expect(r.meeting.totalSpeechMs).toBe(0);
    expect(r.meeting.crossTalkMs).toBe(0);
    for (const m of r.participants) {
      expect(m.speakingTimeMs).toBe(0);
      expect(m.turnsCount).toBe(0);
    }
  });

  it('одинокий участник: interruptions = 0, crossTalkMs = 0', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        participants: [ALICE],
        diarization: [seg('alice', 0, 60_000), seg('alice', 120_000, 200_000)],
      }),
    );
    expect(r.meeting.crossTalkMs).toBe(0);
    const alice = r.participants.find((m) => m.participantId === 'p_alice')!;
    expect(alice.interruptionsMadeCount).toBe(0);
    expect(alice.interruptionsReceivedCount).toBe(0);
  });

  it('низкий diarizationConfidence: lowConfidence=true, метрики посчитаны', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        diarizationConfidence: 0.7,
        diarization: [seg('alice', 0, 30_000), seg('bob', 30_000, 90_000)],
      }),
    );
    expect(r.meeting.lowConfidence).toBe(true);
    expect(r.meeting.totalSpeechMs).toBe(90_000);
    const alice = r.participants.find((m) => m.participantId === 'p_alice')!;
    expect(alice.speakingTimeMs).toBe(30_000);
  });

  it('сегменты от неизвестного speaker → синтезированная запись гостя', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        participants: [ALICE],
        diarization: [seg('alice', 0, 30_000), seg('guest_x', 30_000, 60_000, 'Кто это говорит?')],
      }),
    );
    const guest = r.participants.find((m) => m.participantId === null);
    expect(guest).toBeDefined();
    expect(guest!.isGuest).toBe(true);
    expect(guest!.questionCount).toBe(1);
    expect(guest!.speakingTimeMs).toBe(30_000);
  });

  it('один сегмент на всю длительность дорожки → метрики оживают (speakingTime>0)', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        participants: [ALICE],
        totalDurationMs: 60_000,
        diarization: [seg('alice', 0, 60_000, 'Полный текст дорожки.')],
      }),
    );
    const alice = r.participants.find((m) => m.participantId === 'p_alice')!;
    expect(alice.speakingTimeMs).toBeGreaterThan(0);
    expect(alice.speakingTimeMs).toBe(60_000);
    expect(alice.turnsCount).toBe(1);
    expect(r.meeting.totalSpeechMs).toBeGreaterThan(0);
  });

  it('wordTimingsAvailable=false → lowConfidence=true при высоком diarizationConfidence', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        diarizationConfidence: 0.99,
        wordTimingsAvailable: false,
        diarization: [seg('alice', 0, 30_000), seg('bob', 30_000, 90_000)],
      }),
    );
    expect(r.meeting).toEqual(expect.objectContaining({ lowConfidence: true }));
    expect(r.meeting.totalSpeechMs).toBe(90_000);
  });

  it('wordTimingsAvailable=true + высокий confidence → lowConfidence=false', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        diarizationConfidence: 0.99,
        wordTimingsAvailable: true,
        diarization: [seg('alice', 0, 30_000), seg('bob', 30_000, 90_000)],
      }),
    );
    expect(r.meeting).toEqual(expect.objectContaining({ lowConfidence: false }));
  });

  it('wordTimingsAvailable=undefined + высокий confidence → lowConfidence=false', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        diarizationConfidence: 0.99,
        diarization: [seg('alice', 0, 30_000), seg('bob', 30_000, 90_000)],
      }),
    );
    expect(r.meeting).toEqual(expect.objectContaining({ lowConfidence: false }));
  });
});
