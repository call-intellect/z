/**
 * Unit-тесты BehaviorMetricsCalculator (Фаза B).
 *
 * Источник: plans/tz/2026-05-21-phase-B-meeting-behavior-metrics.md §5 + §11.
 *
 * Покрываем минимум 10 кейсов из ТЗ B DoD:
 *   - speakingTimeMs / speakingTimePercent суммируются корректно;
 *   - turnsCount: соседние сегменты одного спикера склеиваются в turn;
 *   - monologueCount считает только turn ≥ 60_000ms;
 *   - longestMonologueMs возвращает максимум;
 *   - questionCount по «?»;
 *   - fillerWordsCount по словарю (учитывает кириллицу + границы слова);
 *   - interruptions: made / received симметричны и считаются только при
 *     перекрытии ≥ 500ms;
 *   - silenceMs = totalDuration - union сегментов;
 *   - crossTalkMs корректно считает одновременную речь;
 *   - dominanceIndex = max/median, при median=0 → 999;
 *   - edge: короткая встреча → нулевые метрики + lowConfidence=true;
 *   - edge: одинокий участник → interruptions = 0, crossTalkMs = 0;
 *   - edge: низкий confidence диаризации → lowConfidence=true (но метрики
 *     считаются как обычно).
 */

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

function buildInput(
  overrides: Partial<BehaviorCalculatorInput>,
): BehaviorCalculatorInput {
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
  // 1. speakingTimeMs + speakingTimePercent.
  it('считает speakingTimeMs и speakingTimePercent по участникам', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        diarization: [
          seg('alice', 0, 30_000),
          seg('bob', 30_000, 90_000),
        ],
      }),
    );
    expect(r.participants).toHaveLength(2);
    const alice = r.participants.find((m) => m.participantId === 'p_alice')!;
    const bob = r.participants.find((m) => m.participantId === 'p_bob')!;
    expect(alice.speakingTimeMs).toBe(30_000);
    expect(bob.speakingTimeMs).toBe(60_000);
    // % считается от union (90_000), значит Алиса = 33.33, Боб = 66.67.
    expect(alice.speakingTimePercent).toBeCloseTo(33.33, 1);
    expect(bob.speakingTimePercent).toBeCloseTo(66.67, 1);
    expect(r.meeting.totalSpeechMs).toBe(90_000);
    expect(r.meeting.silenceMs).toBe(210_000);
    expect(r.meeting.silencePercent).toBeCloseTo(70, 1);
  });

  // 2. turnsCount: близкие сегменты одного спикера → 1 turn.
  it('склеивает соседние сегменты одного спикера с gap < 2s в один turn', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        diarization: [
          seg('alice', 0, 5_000),
          seg('alice', 5_500, 10_000), // gap=500ms <2s — один turn
          seg('alice', 30_000, 35_000), // gap=20_000ms >>2s — новый turn
        ],
      }),
    );
    const alice = r.participants.find((m) => m.participantId === 'p_alice')!;
    expect(alice.turnsCount).toBe(2);
    // Первый turn: 0..10000 = 10000, второй: 30000..35000 = 5000. Средний = 7500.
    expect(alice.avgTurnDurationMs).toBe(7500);
  });

  // 3. monologueCount: turn ≥ 60s.
  it('считает monologueCount по порогу 60s и longestMonologueMs', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        diarization: [
          seg('alice', 0, 70_000), // монолог
          seg('alice', 100_000, 120_000), // не монолог
          seg('alice', 200_000, 290_000), // монолог, длиннее первого
        ],
      }),
    );
    const alice = r.participants.find((m) => m.participantId === 'p_alice')!;
    expect(alice.monologueCount).toBe(2);
    expect(alice.longestMonologueMs).toBe(90_000);
  });

  // 4. questionCount по «?».
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

  // 5. fillerWordsCount по словарю.
  it('считает слова-паразиты, учитывая кириллицу и multi-word фразы', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        diarization: [
          // 1: 'ну', 2: 'как бы', 3: 'типа', 4: 'в общем' = 4 хита.
          seg('alice', 0, 10_000, 'Ну вообще как бы это типа в общем понятно.'),
          // ловушка: «понятно» не должно матчиться, а «вот» — да.
          seg('alice', 10_000, 20_000, 'Вот и всё.'),
        ],
      }),
    );
    const alice = r.participants.find((m) => m.participantId === 'p_alice')!;
    // 'ну' + 'как бы' + 'типа' + 'в общем' + 'вот' = 5.
    expect(alice.fillerWordsCount).toBe(5);
  });

  // 6. interruptions: made/received симметричны.
  it('считает interruptionsMade у прерывающего и received у прерванного', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        diarization: [
          // Alice говорит 0..10s. Bob вклинивается на 5s..7s — overlap=2s > 500ms.
          seg('alice', 0, 10_000),
          seg('bob', 5_000, 7_000),
        ],
      }),
    );
    const alice = r.participants.find((m) => m.participantId === 'p_alice')!;
    const bob = r.participants.find((m) => m.participantId === 'p_bob')!;
    expect(bob.interruptionsMadeCount).toBe(1);
    expect(alice.interruptionsReceivedCount).toBe(1);
    // Alice сама не перебивала.
    expect(alice.interruptionsMadeCount).toBe(0);
    expect(bob.interruptionsReceivedCount).toBe(0);
  });

  // 7. interruptions: ниже порога 500ms не считается.
  it('не считает прерывание при перекрытии < 500ms', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        diarization: [
          seg('alice', 0, 10_000),
          seg('bob', 9_800, 11_000), // overlap = 200ms <500ms
        ],
      }),
    );
    const alice = r.participants.find((m) => m.participantId === 'p_alice')!;
    const bob = r.participants.find((m) => m.participantId === 'p_bob')!;
    expect(bob.interruptionsMadeCount).toBe(0);
    expect(alice.interruptionsReceivedCount).toBe(0);
  });

  // 8. crossTalkMs: суммируем пересечения разных спикеров.
  it('считает crossTalkMs как сумму пересечений разных спикеров', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        diarization: [
          seg('alice', 0, 10_000),
          seg('bob', 5_000, 7_000), // overlap 2s с Alice
          seg('alice', 20_000, 25_000),
          seg('bob', 24_000, 28_000), // overlap 1s с Alice
        ],
      }),
    );
    expect(r.meeting.crossTalkMs).toBe(3_000);
  });

  // 9. silence + dominanceIndex.
  it('dominanceIndex = max/median, корректно работает при median > 0', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        participants: [ALICE, BOB, CHARLIE],
        diarization: [
          seg('alice', 0, 100_000), // 100s
          seg('bob', 100_000, 150_000), // 50s
          seg('charlie', 150_000, 175_000), // 25s
        ],
      }),
    );
    // speakingTimes = [100000, 50000, 25000]; median = 50000; max = 100000;
    // dominance = 100000 / 50000 = 2.
    expect(r.meeting.dominanceIndex).toBe(2);
  });

  // 10. dominanceIndex: median=0 → 999 (когда большинство молчит).
  it('dominanceIndex = 999, когда median speakingTimes равен 0', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        participants: [ALICE, BOB, CHARLIE],
        diarization: [
          // Только Alice говорит; Bob и Charlie молчат → speakingTimes=[X,0,0],
          // median=0 → dominanceIndex=999 (ТЗ §5.2).
          seg('alice', 0, 90_000),
        ],
      }),
    );
    expect(r.meeting.dominanceIndex).toBe(999);
  });

  // 11. edge: короткая встреча — нулевые метрики + lowConfidence.
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

  // 12. edge: одинокий участник — interruptions = 0, crossTalkMs = 0.
  it('одинокий участник: interruptions = 0, crossTalkMs = 0', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        participants: [ALICE],
        diarization: [
          seg('alice', 0, 60_000),
          seg('alice', 120_000, 200_000),
        ],
      }),
    );
    expect(r.meeting.crossTalkMs).toBe(0);
    const alice = r.participants.find((m) => m.participantId === 'p_alice')!;
    expect(alice.interruptionsMadeCount).toBe(0);
    expect(alice.interruptionsReceivedCount).toBe(0);
  });

  // 13. edge: confidence < 0.85 → lowConfidence=true, но метрики считаются.
  it('низкий diarizationConfidence: lowConfidence=true, метрики посчитаны', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        diarizationConfidence: 0.7,
        diarization: [
          seg('alice', 0, 30_000),
          seg('bob', 30_000, 90_000),
        ],
      }),
    );
    expect(r.meeting.lowConfidence).toBe(true);
    // Метрики тем не менее посчитаны:
    expect(r.meeting.totalSpeechMs).toBe(90_000);
    const alice = r.participants.find((m) => m.participantId === 'p_alice')!;
    expect(alice.speakingTimeMs).toBe(30_000);
  });

  // 14. синтезированный гость (speaker без Participant) → participantId=null, isGuest=true.
  it('сегменты от неизвестного speaker → синтезированная запись гостя', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        participants: [ALICE],
        diarization: [
          seg('alice', 0, 30_000),
          seg('guest_x', 30_000, 60_000, 'Кто это говорит?'),
        ],
      }),
    );
    const guest = r.participants.find((m) => m.participantId === null);
    expect(guest).toBeDefined();
    expect(guest!.isGuest).toBe(true);
    expect(guest!.questionCount).toBe(1);
    expect(guest!.speakingTimeMs).toBe(30_000);
  });

  // 15. фикс псевдо-turn: один сегмент на всю длительность дорожки → метрики
  //     НЕ нулевые. Раньше Vox без таймингов давал endMs=0 → сегмент
  //     отбрасывался (endMs<=startMs) и всё поведение обнулялось.
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

  // 16. wordTimingsAvailable=false → lowConfidence=true даже при высоком confidence.
  it('wordTimingsAvailable=false → lowConfidence=true при высоком diarizationConfidence', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        diarizationConfidence: 0.99,
        wordTimingsAvailable: false,
        diarization: [
          seg('alice', 0, 30_000),
          seg('bob', 30_000, 90_000),
        ],
      }),
    );
    expect(r.meeting).toEqual(expect.objectContaining({ lowConfidence: true }));
    // Метрики при этом всё равно посчитаны.
    expect(r.meeting.totalSpeechMs).toBe(90_000);
  });

  // 17. wordTimingsAvailable=true + высокий confidence + норм. длительность → lowConfidence=false.
  it('wordTimingsAvailable=true + высокий confidence → lowConfidence=false', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        diarizationConfidence: 0.99,
        wordTimingsAvailable: true,
        diarization: [
          seg('alice', 0, 30_000),
          seg('bob', 30_000, 90_000),
        ],
      }),
    );
    expect(r.meeting).toEqual(expect.objectContaining({ lowConfidence: false }));
  });

  // 18. wordTimingsAvailable=undefined (старый путь) + высокий confidence → lowConfidence=false.
  it('wordTimingsAvailable=undefined + высокий confidence → lowConfidence=false', () => {
    const r = calculateBehaviorMetrics(
      buildInput({
        diarizationConfidence: 0.99,
        diarization: [
          seg('alice', 0, 30_000),
          seg('bob', 30_000, 90_000),
        ],
      }),
    );
    expect(r.meeting).toEqual(expect.objectContaining({ lowConfidence: false }));
  });
});
