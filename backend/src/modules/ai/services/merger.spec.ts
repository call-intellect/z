import { describe, expect, it } from 'vitest';

import { countWords, maxEndSec, mergeWordTimestamps, type PerTrackWords } from './merger';

describe('mergeWordTimestamps', () => {
  it('пустой вход → пустой массив', () => {
    expect(mergeWordTimestamps([])).toEqual([]);
  });

  it('один трек, два turn-а через большой gap', () => {
    const base = new Date('2026-05-08T10:00:00.000Z');
    const tracks: PerTrackWords[] = [
      {
        speakerName: 'Алиса',
        trackStartedAt: base,
        baseStartedAt: base,
        words: [
          { word: 'Привет', startMs: 0, endMs: 500 },
          { word: 'команда', startMs: 600, endMs: 1100 },
          // gap 3 секунды → новый turn
          { word: 'Работаем', startMs: 4500, endMs: 5000 },
        ],
      },
    ];
    const turns = mergeWordTimestamps(tracks);
    expect(turns).toHaveLength(2);
    expect(turns[0]?.speaker).toBe('Алиса');
    expect(turns[0]?.text).toBe('Привет команда');
    expect(turns[1]?.text).toBe('Работаем');
  });

  it('два трека: чередование speaker', () => {
    const base = new Date('2026-05-08T10:00:00.000Z');
    const tracks: PerTrackWords[] = [
      {
        speakerName: 'Алиса',
        trackStartedAt: base,
        baseStartedAt: base,
        words: [
          { word: 'Как', startMs: 0, endMs: 300 },
          { word: 'дела', startMs: 350, endMs: 700 },
        ],
      },
      {
        speakerName: 'Боб',
        trackStartedAt: base,
        baseStartedAt: base,
        words: [
          { word: 'Хорошо', startMs: 800, endMs: 1200 },
          { word: 'спасибо', startMs: 1250, endMs: 1700 },
        ],
      },
    ];
    const turns = mergeWordTimestamps(tracks);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ speaker: 'Алиса', text: 'Как дела' });
    expect(turns[1]).toMatchObject({ speaker: 'Боб', text: 'Хорошо спасибо' });
  });

  it('одновременная речь — words разнесены по speaker, порядок по startSec', () => {
    const base = new Date('2026-05-08T10:00:00.000Z');
    const tracks: PerTrackWords[] = [
      {
        speakerName: 'Алиса',
        trackStartedAt: base,
        baseStartedAt: base,
        words: [
          { word: 'А', startMs: 0, endMs: 200 },
          { word: 'я', startMs: 300, endMs: 500 },
        ],
      },
      {
        speakerName: 'Боб',
        trackStartedAt: base,
        baseStartedAt: base,
        words: [
          // вклинивается между «А» и «я»
          { word: 'Б', startMs: 100, endMs: 250 },
        ],
      },
    ];
    const turns = mergeWordTimestamps(tracks);
    // Должно быть 3 turn'а: Алиса("А"), Боб("Б"), Алиса("я"),
    // потому что speaker меняется → flush.
    expect(turns).toHaveLength(3);
    expect(turns.map((t) => t.speaker)).toEqual(['Алиса', 'Боб', 'Алиса']);
    expect(turns.map((t) => t.text)).toEqual(['А', 'Б', 'я']);
  });

  it('абсолютное время учитывает offset trackStartedAt', () => {
    const base = new Date('2026-05-08T10:00:00.000Z');
    const trackLater = new Date('2026-05-08T10:00:10.000Z'); // +10s
    const tracks: PerTrackWords[] = [
      {
        speakerName: 'Алиса',
        trackStartedAt: base,
        baseStartedAt: base,
        words: [{ word: 'Раз', startMs: 0, endMs: 500 }],
      },
      {
        speakerName: 'Боб',
        trackStartedAt: trackLater,
        baseStartedAt: base,
        words: [{ word: 'Два', startMs: 0, endMs: 500 }],
      },
    ];
    const turns = mergeWordTimestamps(tracks);
    expect(turns).toHaveLength(2);
    expect(turns[0]?.startSec).toBe(0);
    expect(turns[1]?.startSec).toBe(10); // 10 секунд offset
  });

  it('countWords и maxEndSec корректны', () => {
    const turns = [
      { speaker: 'A', text: 'один два три', startSec: 0, endSec: 5 },
      { speaker: 'B', text: 'четыре пять', startSec: 6, endSec: 9.7 },
    ];
    expect(countWords(turns)).toBe(5);
    expect(maxEndSec(turns)).toBe(10);
  });
});
