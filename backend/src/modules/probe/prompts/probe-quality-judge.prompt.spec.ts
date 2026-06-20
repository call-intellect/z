import { describe, expect, it } from 'vitest';

import {
  PROBE_QUALITY_JUDGE_SCHEMA_NAME,
  PROBE_QUALITY_JUDGE_SYSTEM_PROMPT,
  PROBE_QUALITY_JUDGE_USER,
} from './probe-quality-judge.prompt';

describe('probe-quality-judge prompt — Probe Фаза 6 (объект в USER)', () => {
  it('SCHEMA_NAME = probe_quality_judge_v1', () => {
    expect(PROBE_QUALITY_JUDGE_SCHEMA_NAME).toBe('probe_quality_judge_v1');
  });

  it('SYSTEM стабилен (без интерполяции) и требует называть объект', () => {
    expect(typeof PROBE_QUALITY_JUDGE_SYSTEM_PROMPT).toBe('string');
    expect(PROBE_QUALITY_JUDGE_SYSTEM_PROMPT).not.toContain('${');
    expect(PROBE_QUALITY_JUDGE_SYSTEM_PROMPT).toContain('конкретный объект');
  });

  it('SYSTEM не содержит имени конкретного объекта (только в USER)', () => {
    expect(PROBE_QUALITY_JUDGE_SYSTEM_PROMPT).not.toContain('Приёмка товара');
  });

  it('USER c objectName включает имя объекта в текст для судьи', () => {
    const user = PROBE_QUALITY_JUDGE_USER({
      question: 'Кто отвечает за этот регламент?',
      objectName: 'Приёмка товара',
    });
    expect(user).toContain('Приёмка товара');
    expect(user).toContain('Объект, который должен быть назван: «Приёмка товара»');
    expect(user).toContain('Кто отвечает за этот регламент?');
    expect(user).toContain('probe_quality_judge_v1');
  });

  it('USER без objectName не содержит строки объекта', () => {
    const user = PROBE_QUALITY_JUDGE_USER({ question: 'Кто владелец задачи?' });
    expect(user).toContain('Кто владелец задачи?');
    expect(user).not.toContain('Объект, который должен быть назван');
  });
});
