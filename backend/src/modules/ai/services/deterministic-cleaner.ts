import type { DialogTurn } from './prompts/common';

const FILLER_DICTIONARY: readonly string[] = [
  'эээ',
  'эээээ',
  'эээээээ',
  'эээ-эээ',
  'ээ',
  'ммм',
  'мммм',
  'ммммм',
  'эмм',
  'эмммм',
  'эээм',
  'мм',
  'ам',
  'кхм',
  'кхе',
  'кхэ',
  'эх',
  'охх',
  'ох',
  'кх',
  'хм',
  'хмм',
  'хмммм',
  'мхм',
  'типа',
  'как-бы',
  'как бы',
  'это-самое',
  'это самое',
  'так-сказать',
  'так сказать',
  'в-общем',
  'в-принципе',
  'в общем',
  'в принципе',
];

const STANDALONE_INTERJECTIONS: readonly string[] = [
  'ага',
  'угу',
  'м-м',
  'м-м-м',
  'мм-м',
  'хм',
  'хмм',
  'мхм',
  'ну-у',
  'нуу',
  'нууу',
  'эээ',
  'ээ',
  'ммм',
  'мм',
];

export interface CleanerRemovedItem {
  type: 'filler' | 'repeat' | 'false_start';
  text: string;
}

export interface CleanedSegment {
  originalIndex: number;
  participantIdentity: string;
  startMs: number;
  endMs: number;
  originalText: string;
  cleanedText: string;
  removed: CleanerRemovedItem[];
}

export interface CleanerInputSegment {
  participantIdentity: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface CleanerStats {
  fillerWordsRemoved: number;
  repeatsRemoved: number;
  falseStartsRemoved: number;
  charsBefore: number;
  charsAfter: number;
}

export interface CleanerResult {
  segments: CleanedSegment[];
  stats: CleanerStats;
}

export function deterministicClean(segments: readonly CleanerInputSegment[]): CleanerResult {
  let fillerWordsRemoved = 0;
  let repeatsRemoved = 0;
  const falseStartsRemoved = 0;
  let charsBefore = 0;
  let charsAfter = 0;

  const cleaned: CleanedSegment[] = segments.map((seg, idx) => {
    const original = seg.text;
    charsBefore += original.length;
    const removed: CleanerRemovedItem[] = [];

    if (isStandaloneInterjection(original)) {
      removed.push({ type: 'filler', text: original.trim() });
      fillerWordsRemoved += 1;
      return {
        originalIndex: idx,
        participantIdentity: seg.participantIdentity,
        startMs: seg.startMs,
        endMs: seg.endMs,
        originalText: original,
        cleanedText: '',
        removed,
      };
    }

    let working = original;
    const fillerHits = removeFillerWords(working);
    working = fillerHits.text;
    fillerWordsRemoved += fillerHits.count;
    for (const w of fillerHits.removedWords) {
      removed.push({ type: 'filler', text: w });
    }

    const repeatHits = collapseRepeats(working);
    working = repeatHits.text;
    repeatsRemoved += repeatHits.count;
    for (const w of repeatHits.removedWords) {
      removed.push({ type: 'repeat', text: w });
    }

    working = normalizeWhitespace(working);

    charsAfter += working.length;

    return {
      originalIndex: idx,
      participantIdentity: seg.participantIdentity,
      startMs: seg.startMs,
      endMs: seg.endMs,
      originalText: original,
      cleanedText: working,
      removed,
    };
  });

  return {
    segments: cleaned,
    stats: {
      fillerWordsRemoved,
      repeatsRemoved,
      falseStartsRemoved,
      charsBefore,
      charsAfter,
    },
  };
}

export function turnsToCleanerInput(turns: readonly DialogTurn[]): CleanerInputSegment[] {
  return turns.map((t) => ({
    participantIdentity: t.speaker,
    startMs: Math.round(t.startSec * 1000),
    endMs: Math.round(t.endSec * 1000),
    text: t.text,
  }));
}

function isStandaloneInterjection(text: string): boolean {
  const stripped = text
    .toLowerCase()
    .replace(/[.,!?;:()«»"'\-—–]/g, ' ')
    .trim();
  if (stripped.length === 0) return false;
  const tokens = stripped.split(/\s+/);
  if (tokens.length > 3) return false;
  return tokens.every((tok) => STANDALONE_INTERJECTIONS.includes(tok));
}

function removeFillerWords(text: string): { text: string; count: number; removedWords: string[] } {
  let result = text;
  let count = 0;
  const removed: string[] = [];

  const startBoundary = '(?<![\\p{L}\\p{N}])';
  const endBoundary = '(?![\\p{L}\\p{N}])';

  const multiWord = FILLER_DICTIONARY.filter((w) => /\s|-/.test(w));
  for (const phrase of multiWord) {
    const re = new RegExp(`${startBoundary}${escapeRegex(phrase)}${endBoundary}`, 'giu');
    const matches = result.match(re);
    if (matches && matches.length > 0) {
      count += matches.length;
      removed.push(...matches);
      result = result.replace(re, ' ');
    }
  }

  const singleWord = FILLER_DICTIONARY.filter((w) => !/\s|-/.test(w));
  for (const word of singleWord) {
    const re = new RegExp(`${startBoundary}${escapeRegex(word)}${endBoundary}`, 'giu');
    const matches = result.match(re);
    if (matches && matches.length > 0) {
      count += matches.length;
      removed.push(...matches);
      result = result.replace(re, ' ');
    }
  }

  return { text: result, count, removedWords: removed };
}

function collapseRepeats(text: string): {
  text: string;
  count: number;
  removedWords: string[];
} {
  const re = /(\p{L}[\p{L}-]*)(?:\s+\1)+(?![\p{L}\p{N}])/giu;
  let count = 0;
  const removed: string[] = [];
  const out = text.replace(re, (full, word: string) => {
    const tokens = full.trim().split(/\s+/).length;
    const dropped = tokens - 1;
    count += dropped;
    for (let i = 0; i < dropped; i++) removed.push(word);
    return word;
  });
  return { text: out, count, removedWords: removed };
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/^[,;:\s]+/, '')
    .replace(/([,;:])\s*([,;:])/g, '$1')
    .trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
