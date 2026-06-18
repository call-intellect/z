import { describe, expect, it } from 'vitest';

import {
  ASR_NOTE,
  DATA_MARKER_CLOSE,
  DATA_MARKER_OPEN,
  DECISION_DISCRIMINATOR,
  DOCUMENT_COMPILER_MODE_NOTE,
  EDGE_CASE_POLICY,
  EXTRACTED_NOT_CONFIRMED_NOTE,
  EXTRACTION_STATUS_RU_TO_API,
  FORECAST_CONFIDENCE_CALIBRATION,
  INJECTION_GUARD_NOTE,
  PEOPLE_HYPOTHESIS_NOTE,
  TONE_CONFIDENCE_CALIBRATION,
  Z_GLOBAL_PREAMBLE,
  applyInputGuards,
  formatOrgContextForPrompt,
  withAsrNote,
  withDecisionDiscriminator,
  withDocumentCompilerMode,
  withEdgeCasePolicy,
  withExtractedNotConfirmedNote,
  withForecastConfidenceCalibration,
  withOrgContextNote,
  withPeopleHypothesisGuard,
  withToneConfidenceCalibration,
  withZPreamble,
} from './common';

describe('withZPreamble', () => {
  const SYSTEM = 'Ты — knowledge-инженер. Извлеки сущности.';

  it('добавляет preamble в начало system-промпта', () => {
    const out = withZPreamble(SYSTEM);
    expect(out.startsWith(Z_GLOBAL_PREAMBLE)).toBe(true);
    expect(out).toContain(SYSTEM);
    expect(out.indexOf(Z_GLOBAL_PREAMBLE)).toBeLessThan(out.indexOf(SYSTEM));
  });

  it('preamble упоминает Кора / русский / injection-guard', () => {
    expect(Z_GLOBAL_PREAMBLE).toContain('Кора');
    expect(Z_GLOBAL_PREAMBLE).toContain('русском');
    expect(Z_GLOBAL_PREAMBLE).toContain('USER_DATA_BEGIN');
    expect(Z_GLOBAL_PREAMBLE.toLowerCase()).toContain('игнорируй');
  });

  it('preamble и system разделены пустой строкой', () => {
    const out = withZPreamble('BODY');
    expect(out).toBe(`${Z_GLOBAL_PREAMBLE}\n\nBODY`);
  });
});

describe('withEdgeCasePolicy', () => {
  const SYSTEM = 'Ты — knowledge-инженер. Извлеки решение из блока.';

  it('добавляет политику в конец system-промпта', () => {
    const out = withEdgeCasePolicy(SYSTEM);
    expect(out.startsWith(SYSTEM)).toBe(true);
    expect(out).toContain(EDGE_CASE_POLICY);
    expect(out.indexOf(EDGE_CASE_POLICY)).toBeGreaterThan(0);
  });

  it('политика покрывает три ключевых кейса (пустой/противоречие/относительные сроки)', () => {
    expect(EDGE_CASE_POLICY).toContain('Пустой');
    expect(EDGE_CASE_POLICY).toContain('недостаточно сигнала');
    expect(EDGE_CASE_POLICY).toContain('Противоречие');
    expect(EDGE_CASE_POLICY).toContain('confidence');
    expect(EDGE_CASE_POLICY).toContain('Относительные сроки');
    expect(EDGE_CASE_POLICY).toContain('ISO-8601');
    expect(EDGE_CASE_POLICY).toContain('meetingDateIso');
  });

  it('двойной вызов не теряет тело system (хоть и не идемпотентен по содержанию)', () => {
    const once = withEdgeCasePolicy(SYSTEM);
    const twice = withEdgeCasePolicy(once);
    expect(twice).toContain(SYSTEM);
    const count = twice.split(EDGE_CASE_POLICY).length - 1;
    expect(count).toBe(2);
  });
});

describe('withAsrNote', () => {
  const SYSTEM = 'Ты — деловой ассистент. Составь summary встречи.';

  it('дописывает ASR_NOTE в КОНЕЦ system-промпта', () => {
    const out = withAsrNote(SYSTEM);
    expect(out.endsWith(ASR_NOTE)).toBe(true);
    expect(out).toContain(ASR_NOTE);
    expect(out.indexOf(ASR_NOTE)).toBeGreaterThan(0);
  });

  it('исходный system-префикс не изменён (cache-friendly)', () => {
    const out = withAsrNote(SYSTEM);
    expect(out.startsWith(SYSTEM)).toBe(true);
    expect(out).toBe(`${SYSTEM}\n\n${ASR_NOTE}`);
  });

  it('нота покрывает ключевые правила (ASR / числа-имена / контекст / не выдумывать)', () => {
    expect(ASR_NOTE).toContain('ASR');
    expect(ASR_NOTE).toContain('распознавания речи');
    expect(ASR_NOTE.toLowerCase()).toContain('числ');
    expect(ASR_NOTE).toContain('контекст');
    expect(ASR_NOTE).toContain('Не выдумывай');
  });
});

describe('formatOrgContextForPrompt', () => {
  it('пустой ctx → пустая строка', () => {
    expect(formatOrgContextForPrompt({})).toBe('');
    expect(formatOrgContextForPrompt({ projects: [], goals: [], people: [] })).toBe('');
  });

  it('проект с identifier → "name (identifier)", без identifier → name', () => {
    const out = formatOrgContextForPrompt({
      projects: [
        { identifier: 'DEV', name: 'Команда разработки' },
        { identifier: null, name: 'Маркетинг' },
      ],
    });
    expect(out).toBe('Проекты компании: Команда разработки (DEV), Маркетинг.');
  });

  it('цели и сотрудники — отдельными строками', () => {
    const out = formatOrgContextForPrompt({
      goals: [{ name: 'Запуск v2' }, { name: 'Рост MRR' }],
      people: [{ name: 'Иванов Сергей' }, { name: 'Петров Олег' }],
    });
    expect(out).toContain('Активные цели: Запуск v2, Рост MRR.');
    expect(out).toContain('Сотрудники: Иванов Сергей, Петров Олег.');
  });
});

describe('withOrgContextNote', () => {
  const SYSTEM = 'Ты — деловой ассистент. Составь summary встречи.';

  it('пустой ctx → возвращает system без изменений (no-op)', () => {
    expect(withOrgContextNote(SYSTEM, {})).toBe(SYSTEM);
    expect(withOrgContextNote(SYSTEM, { projects: [], goals: [], people: [] })).toBe(SYSTEM);
  });

  it('непустой ctx → дописывает блок в КОНЕЦ, system-префикс не изменён', () => {
    const out = withOrgContextNote(SYSTEM, {
      projects: [{ identifier: 'DEV', name: 'Команда разработки' }],
      people: [{ name: 'Иванов Сергей' }],
    });
    expect(out.startsWith(SYSTEM)).toBe(true);
    expect(out).toContain('Контекст компании');
    expect(out).toContain('Проекты компании: Команда разработки (DEV).');
    expect(out).toContain('Сотрудники: Иванов Сергей.');
    expect(out.length).toBeGreaterThan(SYSTEM.length);
  });
});

describe('applyInputGuards (A0.1)', () => {
  const SYSTEM = 'Ты — knowledge-инженер. Извлеки сущности.';
  const USER = 'Диалог: Иван сказал, что запустим v2 к пятнице.';

  it('enabled=false → возвращает system/user без изменений', () => {
    const out = applyInputGuards(SYSTEM, USER, { enabled: false });
    expect(out.system).toBe(SYSTEM);
    expect(out.user).toBe(USER);
  });

  it('injection=true → оборачивает user в маркеры и добавляет INJECTION_GUARD_NOTE в system', () => {
    const out = applyInputGuards(SYSTEM, USER, { injection: true });
    expect(out.user).toContain(DATA_MARKER_OPEN);
    expect(out.user).toContain(DATA_MARKER_CLOSE);
    expect(out.user).toContain(USER);
    expect(out.system).toContain(INJECTION_GUARD_NOTE);
    expect(out.system.startsWith(SYSTEM)).toBe(true);
  });

  it('идемпотентность — уже обёрнутый user не оборачивается повторно', () => {
    const once = applyInputGuards(SYSTEM, USER, { injection: true });
    const twice = applyInputGuards(SYSTEM, once.user, { injection: true });
    const count = twice.user.split(DATA_MARKER_OPEN).length - 1;
    expect(count).toBe(1);
  });

  it('asr=true → ASR_NOTE дописана в КОНЕЦ system', () => {
    const out = applyInputGuards(SYSTEM, USER, { asr: true });
    expect(out.system.endsWith(ASR_NOTE)).toBe(true);
  });

  it('meetingDateIso → префиксует user ПЕРЕД маркером данных', () => {
    const out = applyInputGuards(SYSTEM, USER, {
      injection: true,
      meetingDateIso: '2026-06-10',
    });
    expect(out.user.startsWith('meetingDateIso: 2026-06-10')).toBe(true);
    expect(out.user.indexOf('meetingDateIso')).toBeLessThan(out.user.indexOf(DATA_MARKER_OPEN));
  });

  it('пустой user → не оборачивается в маркеры', () => {
    const out = applyInputGuards(SYSTEM, '', { injection: true });
    expect(out.user).not.toContain(DATA_MARKER_OPEN);
    expect(out.user).toBe('');
  });
});

describe('семейство калибровок и guard-ноты (A0.3–A0.7)', () => {
  const SYSTEM = 'Ты — аналитик. Сформулируй прогноз.';

  it('withForecastConfidenceCalibration дописывает константу в КОНЕЦ', () => {
    const out = withForecastConfidenceCalibration(SYSTEM);
    expect(out.startsWith(SYSTEM)).toBe(true);
    expect(out.endsWith(FORECAST_CONFIDENCE_CALIBRATION)).toBe(true);
  });

  it('withToneConfidenceCalibration дописывает константу в КОНЕЦ', () => {
    const out = withToneConfidenceCalibration(SYSTEM);
    expect(out.startsWith(SYSTEM)).toBe(true);
    expect(out.endsWith(TONE_CONFIDENCE_CALIBRATION)).toBe(true);
  });

  it('withDecisionDiscriminator дописывает константу в КОНЕЦ', () => {
    const out = withDecisionDiscriminator(SYSTEM);
    expect(out.startsWith(SYSTEM)).toBe(true);
    expect(out.endsWith(DECISION_DISCRIMINATOR)).toBe(true);
  });

  it('withPeopleHypothesisGuard дописывает константу в КОНЕЦ', () => {
    const out = withPeopleHypothesisGuard(SYSTEM);
    expect(out.startsWith(SYSTEM)).toBe(true);
    expect(out.endsWith(PEOPLE_HYPOTHESIS_NOTE)).toBe(true);
  });

  it('withExtractedNotConfirmedNote дописывает константу в КОНЕЦ', () => {
    const out = withExtractedNotConfirmedNote(SYSTEM);
    expect(out.startsWith(SYSTEM)).toBe(true);
    expect(out.endsWith(EXTRACTED_NOT_CONFIRMED_NOTE)).toBe(true);
  });

  it('withDocumentCompilerMode дописывает константу в КОНЕЦ', () => {
    const out = withDocumentCompilerMode(SYSTEM);
    expect(out.startsWith(SYSTEM)).toBe(true);
    expect(out.endsWith(DOCUMENT_COMPILER_MODE_NOTE)).toBe(true);
  });

  it('EXTRACTION_STATUS_RU_TO_API — маппинг существует→exists, нужен→needed, обсуждается→discussed', () => {
    expect(EXTRACTION_STATUS_RU_TO_API['существует']).toBe('exists');
    expect(EXTRACTION_STATUS_RU_TO_API['нужен']).toBe('needed');
    expect(EXTRACTION_STATUS_RU_TO_API['обсуждается']).toBe('discussed');
  });
});
