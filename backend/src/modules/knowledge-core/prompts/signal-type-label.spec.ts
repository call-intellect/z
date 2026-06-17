/**
 * Машинный гард словаря `SIGNAL_TYPE_LABEL` (ТЗ ingest-prompts Ф4-pre).
 *
 * Проверяет ПОВЕДЕНИЕ:
 *   - полнота: каждый код enum `SignalType` имеет непустой русский ярлык
 *     (защита от рассинхрона при добавлении нового SignalType в схему);
 *   - ярлыки — без латиницы (человеческий вход, требование методологии №3);
 *   - `signalTypeLabel` отдаёт ярлык для известного кода и сам код для неизвестного.
 */
import { SignalType } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { SIGNAL_TYPE_LABEL, signalTypeLabel } from './signal-type-label';

describe('signal-type-label — словарь код→ярлык', () => {
  it('покрывает ВСЕ значения enum SignalType (нет пропусков)', () => {
    const enumValues = Object.values(SignalType) as string[];
    const missing = enumValues.filter((code) => !SIGNAL_TYPE_LABEL[code]);
    expect(missing).toEqual([]);
  });

  it('каждый ярлык — непустая строка без латиницы (чистый русский на входе)', () => {
    for (const [code, label] of Object.entries(SIGNAL_TYPE_LABEL)) {
      expect(label.trim().length, `пустой ярлык для ${code}`).toBeGreaterThan(0);
      expect(/[a-z]/i.test(label), `латиница в ярлыке ${code}: "${label}"`).toBe(
        false,
      );
    }
  });

  it('signalTypeLabel: известный код → ярлык', () => {
    expect(signalTypeLabel('pain')).toBe('боль, проблема в работе');
    expect(signalTypeLabel('decision')).toBe('принятое решение');
    expect(signalTypeLabel('task_overdue')).toBe('задача просрочена');
  });

  it('signalTypeLabel: неизвестный код → сам код (fallback)', () => {
    expect(signalTypeLabel('totally_unknown_code')).toBe('totally_unknown_code');
    expect(signalTypeLabel('')).toBe('');
  });
});
