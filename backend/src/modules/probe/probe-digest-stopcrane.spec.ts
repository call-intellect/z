import { describe, expect, it } from 'vitest';

import {
  PROBE_REASON_FALLBACK,
  PROBE_REASON_FALLBACK_DEFAULT,
  PROBE_REASON_LABEL,
} from './probe-reason-labels';
import { deriveDigestQuestion } from './probe-text.util';
import { buildProbeDigestSummary } from './prompts/probe-digest.prompt';

describe('Probe Ф1 — гард паритета заглушек (Д4)', () => {
  it('каждый ключ PROBE_REASON_LABEL имеет запись в PROBE_REASON_FALLBACK', () => {
    const missing = Object.keys(PROBE_REASON_LABEL).filter(
      (key) => !(key in PROBE_REASON_FALLBACK),
    );
    expect(missing).toEqual([]);
  });
});

describe('Probe Ф1 — deriveDigestQuestion (стоп-кран)', () => {
  it('message → человеческая строка с объектом, НЕ дефолтная заглушка', () => {
    const q = deriveDigestQuestion(
      'process_template.missing_input_artifact',
      { message: 'У шага «Приёмка» не указан вход' },
      PROBE_REASON_FALLBACK,
      PROBE_REASON_FALLBACK_DEFAULT,
    );
    expect(q).toContain('Приёмка');
    expect(q).not.toBe('Можете уточнить, пожалуйста?');
  });

  it('formulatedQuestion имеет приоритет над message', () => {
    const q = deriveDigestQuestion(
      'regulation.missing_owner',
      { formulatedQuestion: 'Кто отвечает за регламент приёмки?', message: 'сырьё' },
      PROBE_REASON_FALLBACK,
      PROBE_REASON_FALLBACK_DEFAULT,
    );
    expect(q).toBe('Кто отвечает за регламент приёмки?');
  });

  it('нет message/formulated → fallback по reason (не дефолт), reason известен', () => {
    const q = deriveDigestQuestion(
      'regulation.missing_owner',
      {},
      PROBE_REASON_FALLBACK,
      PROBE_REASON_FALLBACK_DEFAULT,
    );
    expect(q).toBe(PROBE_REASON_FALLBACK['regulation.missing_owner']);
  });

  it('message-заглушка с длинным id вычищается до человеческого текста', () => {
    const q = deriveDigestQuestion(
      'card.missing_owner',
      { message: 'Карточка cmpzl0mf3k2x9abcd1234 без ответственного' },
      PROBE_REASON_FALLBACK,
      PROBE_REASON_FALLBACK_DEFAULT,
    );
    expect(q).not.toContain('cmpzl0mf3k2x9abcd1234');
    expect(q).toContain('Карточка');
  });
});

describe('Probe Ф1 — buildProbeDigestSummary (без дубля объекта)', () => {
  it('не добавляет скобку, если объект уже в вопросе', () => {
    const out = buildProbeDigestSummary([
      {
        question: 'Кто отвечает за регламент «Приёмка товара»?',
        objectTitle: 'Приёмка товара',
        probeEventId: 'p1',
      },
    ]);
    expect(out).not.toContain('(Приёмка товара)');
  });

  it('не добавляет скобку, если objectTitle длиннее 60 символов', () => {
    const longTitle = 'А'.repeat(61);
    const out = buildProbeDigestSummary([
      { question: 'Что с этим?', objectTitle: longTitle, probeEventId: 'p1' },
    ]);
    expect(out).not.toContain(`(${longTitle})`);
  });

  it('добавляет скобку, если объект короткий и не в вопросе', () => {
    const out = buildProbeDigestSummary([
      { question: 'Кто за это отвечает?', objectTitle: 'Приёмка товара', probeEventId: 'p1' },
    ]);
    expect(out).toContain('(Приёмка товара)');
  });
});
