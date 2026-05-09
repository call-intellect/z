import type { DialogTurn } from './prompts/common';

export type { DialogTurn };

/**
 * Per-track word с привязкой к speaker и абсолютному времени trackStartedAt.
 */
export interface PerTrackWords {
  speakerName: string;
  /** ms от начала аудио-дорожки (0 = первая миллисекунда). */
  words: Array<{ word: string; startMs: number; endMs: number }>;
  /** Абсолютное время старта дорожки. Используется как offset. */
  trackStartedAt: Date;
  /** Базовая точка относительно которой считаем секунды. */
  baseStartedAt: Date;
}

/**
 * Промежуточная структура: один word с уже посчитанным абсолютным временем
 * (в секундах от начала встречи).
 */
interface AbsoluteWord {
  speaker: string;
  word: string;
  absStartSec: number;
  absEndSec: number;
}

const DEFAULT_TURN_GAP_SEC = 1.5;

/**
 * Склеивает word-timestamps из разных дорожек в единый диалог.
 *
 * Алгоритм:
 *   1. Все words → absolute time (sec от `baseStartedAt`).
 *   2. Сортируем по `absStartSec`.
 *   3. Группируем подряд идущие words одного speaker в turn'ы.
 *      Если между соседними words одного speaker gap > `gapSec` —
 *      считаем это новым turn'ом.
 *   4. Если speaker сменился — закрываем предыдущий turn и открываем новый.
 *
 * При одновременной речи двух участников — words взаимно проникают по времени;
 * сортировка по startSec даёт однозначный порядок (а speaker — однозначен).
 */
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
      });
    }
  }

  if (allWords.length === 0) return [];

  // Стабильная сортировка по startSec; при равенстве — по endSec.
  allWords.sort((a, b) => a.absStartSec - b.absStartSec || a.absEndSec - b.absEndSec);

  const turns: DialogTurn[] = [];
  let currentSpeaker: string | null = null;
  let currentText: string[] = [];
  let currentStart = 0;
  let currentEnd = 0;

  const flush = (): void => {
    if (currentSpeaker !== null && currentText.length > 0) {
      turns.push({
        speaker: currentSpeaker,
        text: currentText.join(' ').trim(),
        startSec: currentStart,
        endSec: currentEnd,
      });
    }
    currentSpeaker = null;
    currentText = [];
    currentStart = 0;
    currentEnd = 0;
  };

  for (const w of allWords) {
    const speakerChanged = currentSpeaker !== null && currentSpeaker !== w.speaker;
    // Gap считаем по `currentEnd → w.absStartSec` для текущего turn'а.
    const gap = currentSpeaker !== null ? w.absStartSec - currentEnd : 0;
    const gapTooLarge = currentSpeaker !== null && gap > gapSec;

    if (speakerChanged || gapTooLarge) {
      flush();
    }

    if (currentSpeaker === null) {
      currentSpeaker = w.speaker;
      currentStart = w.absStartSec;
    }
    currentText.push(w.word);
    currentEnd = w.absEndSec;
  }
  flush();

  return turns;
}

/**
 * Считает суммарное количество слов в массиве turn'ов.
 */
export function countWords(turns: DialogTurn[]): number {
  return turns.reduce(
    (sum, t) => sum + (t.text === '' ? 0 : t.text.split(/\s+/).length),
    0,
  );
}

/**
 * Возвращает максимальный endSec из всех turn'ов — используется как
 * `totalDurationSeconds` Transcript'а.
 */
export function maxEndSec(turns: DialogTurn[]): number {
  let max = 0;
  for (const t of turns) {
    if (t.endSec > max) max = t.endSec;
  }
  return Math.round(max);
}
