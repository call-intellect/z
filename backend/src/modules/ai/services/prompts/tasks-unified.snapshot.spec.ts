import { describe, expect, it } from 'vitest';

import type { PromptInput } from './common';
import { buildTasksPromptUnified } from './tasks-unified';

const SAMPLE_INPUT: PromptInput = {
  meeting: {
    id: 'm-tasks-1',
    title: 'Планёрка по релизу',
    type: 'team',
    customPrompt: null,
  },
  dialog: [
    {
      speaker: 'Алиса',
      text: 'Сергей, до пятницы сделай отчёт по нагрузке.',
      startSec: 0,
      endSec: 4,
    },
    {
      speaker: 'Сергей',
      text: 'Окей, до пятницы пришлю.',
      startSec: 4.5,
      endSec: 7,
    },
    {
      speaker: 'Алиса',
      text: 'Маша, согласуй договор с юристом к среде.',
      startSec: 7.5,
      endSec: 12,
    },
  ],
};

describe('tasks-unified — snapshot сборки промта', () => {
  it('legacy (без опций) — простой 3-поля промт без CONFIDENCE_CALIBRATION', () => {
    const out = buildTasksPromptUnified(SAMPLE_INPUT, {});
    expect(out.system).toMatchSnapshot('system-legacy');
    expect(out.user).toMatchSnapshot('user-legacy');
  });

  it('enriched + withConfidence + withSourceQuote + meetingDateIso + orgContext (Wave 3)', () => {
    const out = buildTasksPromptUnified(SAMPLE_INPUT, {
      enriched: true,
      withConfidence: true,
      withSourceQuote: true,
      meetingDateIso: '2026-05-24',
      orgContext: {
        projects: [{ identifier: 'BACKEND', name: 'Команда платформы' }],
        goals: [{ name: 'Выпустить v2 до конца квартала' }],
        people: [
          { name: 'Сергей Иванов', role: 'backend' },
          { name: 'Маша Петрова', role: 'юрист' },
        ],
      },
    });
    expect(out.system).toMatchSnapshot('system-enriched');
    expect(out.user).toMatchSnapshot('user-enriched');
  });
});
