import type { MeetingType } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { meetingTypeLabelRu } from './common';
import {
  buildMeetingReportFastPrompt,
  buildMeetingReportFastSystemPrompt,
  buildMeetingReportFastUserPrompt,
  MEETING_REPORT_FAST_INPUT_SCHEMA,
  MEETING_REPORT_FAST_TASK_TYPE,
  MEETING_REPORT_FAST_TOOL,
  MEETING_REPORT_FAST_TOOL_NAME,
  MeetingReportFastSchema,
  getSummaryTemplateForType,
} from './meeting-report-fast.prompt';

const ALL_MEETING_TYPES: MeetingType[] = [
  'team',
  'standup',
  'plan_fact',
  'project',
  'sales',
  'custdev',
  'partner',
  'interview',
  'customer_success',
  'review',
  'retrospective',
  'task_discussion',
];

describe('meeting-report-fast — constants', () => {
  it('taskType совпадает с ALL_LLM_TASK_TYPES (registered в llm-router)', () => {
    expect(MEETING_REPORT_FAST_TASK_TYPE).toBe('meeting-report-fast');
  });

  it('tool.name совпадает с TOOL_NAME', () => {
    expect(MEETING_REPORT_FAST_TOOL.name).toBe(MEETING_REPORT_FAST_TOOL_NAME);
    expect(MEETING_REPORT_FAST_TOOL_NAME).toBe('submit_meeting_analysis');
  });

  it('input_schema требует 5 секций', () => {
    expect(MEETING_REPORT_FAST_INPUT_SCHEMA.required).toEqual([
      'chapters',
      'tasks',
      'summary_markdown',
      'quality_score',
      'data_quality',
    ]);
  });

  it('input_schema запрещает additionalProperties на верхнем уровне', () => {
    expect(MEETING_REPORT_FAST_INPUT_SCHEMA.additionalProperties).toBe(false);
  });
});

describe('meeting-report-fast — builder по типу встречи', () => {
  it.each(ALL_MEETING_TYPES)('строит system для типа %s', (type) => {
    const system = buildMeetingReportFastSystemPrompt({ meetingType: type });
    expect(system.length).toBeGreaterThan(0);
    expect(system).toContain(`(тип: ${meetingTypeLabelRu(type)})`);
    expect(system).toContain('Секция 1: chapters');
    expect(system).toContain('Секция 2: tasks');
    expect(system).toContain('Секция 3: summary_markdown');
    expect(system).toContain('Секция 4: quality_score');
    expect(system).toContain('Секция 5: data_quality');
    expect(system).toContain(MEETING_REPORT_FAST_TOOL_NAME);
    const template = getSummaryTemplateForType(type);
    const firstLineOfTemplate = template.split('\n')[0] ?? '';
    expect(system).toContain(firstLineOfTemplate);
    expect(system).toContain('автоматического распознавания речи');
    expect(system).toContain('Шкала confidence (0..1)');
    expect(system).toContain(
      'Имена участников бери ТОЛЬКО из переданного в конце сообщения списка',
    );
  });

  it('у каждого типа свой шаблон summary_markdown (нет коллизий)', () => {
    const templates = new Set<string>();
    for (const type of ALL_MEETING_TYPES) {
      templates.add(getSummaryTemplateForType(type));
    }
    expect(templates.size).toBe(ALL_MEETING_TYPES.length);
  });

  it('buildMeetingReportFastUserPrompt включает заголовок и транскрипт', () => {
    const user = buildMeetingReportFastUserPrompt({
      meetingTitle: 'Sync 2026-05-25',
      transcript: '[00:00-00:05] Alice: Привет.',
      participants: ['Alice', 'Боб'],
      meetingDateIso: '2026-05-25',
    });
    expect(user).toContain('Sync 2026-05-25');
    expect(user).toContain('[00:00-00:05] Alice: Привет.');
    expect(user).toContain(MEETING_REPORT_FAST_TOOL_NAME);
    expect(user).toContain('Участники встречи (используй ТОЛЬКО эти имена): Alice, Боб');
    expect(user).toContain('Дата встречи (ISO): 2026-05-25');
  });

  it('buildMeetingReportFastUserPrompt: пустой список участников и нет даты', () => {
    const user = buildMeetingReportFastUserPrompt({
      meetingTitle: 'Sync',
      transcript: '[00:00-00:05] Alice: Привет.',
      participants: [],
      meetingDateIso: null,
    });
    expect(user).toContain('список участников недоступен');
    expect(user).toContain('Дата встречи (ISO): неизвестна');
  });

  it('buildMeetingReportFastPrompt возвращает system + user', () => {
    const { system, user } = buildMeetingReportFastPrompt({
      meetingType: 'sales',
      meetingTitle: 'Demo CRM',
      transcript: '[00:00-00:10] Иван: Покажите цены.',
      participants: ['Иван'],
      meetingDateIso: '2026-05-25',
    });
    expect(system).toContain('(тип: продажную встречу)');
    expect(user).toContain('Demo CRM');
    expect(user).toContain('Участники встречи (используй ТОЛЬКО эти имена): Иван');
  });
});

describe('meeting-report-fast — Zod validation', () => {
  const VALID_OUTPUT = {
    chapters: [
      {
        title: 'Введение',
        summary: 'Краткое приветствие и повестка встречи.',
        startMs: 0,
        endMs: 60000,
      },
    ],
    tasks: [
      {
        title: 'Подготовить договор',
        assigneeRaw: 'Иван',
        dueDateIso: '2026-06-01',
        sourceQuote: 'Иван: договор подготовлю к понедельнику.',
        confidence: 0.85,
      },
    ],
    summary_markdown: '## Итоги\n- Решили двигаться к договору.',
    quality_score: {
      overallScore: 72,
      categories: {
        preparation: 70,
        structure: 75,
        clarity: 70,
        outcomes: 80,
        engagement: 65,
      },
      recommendations: [
        {
          text: 'Озвучить повестку в первые 5 минут.',
          severity: 'info',
          category: 'preparation',
        },
      ],
      strengths: ['Конкретные итоги.'],
    },
  };

  it('валидирует корректный полный output', () => {
    const parsed = MeetingReportFastSchema.safeParse(VALID_OUTPUT);
    expect(parsed.success).toBe(true);
  });

  it('допускает пустой tasks[]', () => {
    const parsed = MeetingReportFastSchema.safeParse({
      ...VALID_OUTPUT,
      tasks: [],
    });
    expect(parsed.success).toBe(true);
  });

  it('допускает task без assigneeRaw/dueDateIso (опциональны)', () => {
    const parsed = MeetingReportFastSchema.safeParse({
      ...VALID_OUTPUT,
      tasks: [{ title: 'Уточнить требования', confidence: 0.6 }],
    });
    expect(parsed.success).toBe(true);
  });

  it('отбраковывает chapter без startMs', () => {
    const parsed = MeetingReportFastSchema.safeParse({
      ...VALID_OUTPUT,
      chapters: [
        {
          title: 'Введение',
          summary: 'Текст.',
          endMs: 60000,
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('clamp overallScore > 100 в 100 (толерантность к дрейфу)', () => {
    const parsed = MeetingReportFastSchema.safeParse({
      ...VALID_OUTPUT,
      quality_score: {
        ...VALID_OUTPUT.quality_score,
        overallScore: 101,
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.quality_score.overallScore).toBe(100);
    }
  });

  it('отбраковывает recommendation с неизвестной severity', () => {
    const parsed = MeetingReportFastSchema.safeParse({
      ...VALID_OUTPUT,
      quality_score: {
        ...VALID_OUTPUT.quality_score,
        recommendations: [
          {
            text: 'Что-то.',
            severity: 'panic',
            category: 'preparation',
          },
        ],
      },
    });
    expect(parsed.success).toBe(false);
  });

  it('отбраковывает quality_score без хотя бы одной recommendation', () => {
    const parsed = MeetingReportFastSchema.safeParse({
      ...VALID_OUTPUT,
      quality_score: {
        ...VALID_OUTPUT.quality_score,
        recommendations: [],
      },
    });
    expect(parsed.success).toBe(false);
  });
});

describe('meeting-report-fast — quality_score толерантность к дрейфу (F8)', () => {
  const BASE_QS = {
    overallScore: 72,
    categories: {
      preparation: 70,
      structure: 75,
      clarity: 70,
      outcomes: 80,
      engagement: 65,
    },
    recommendations: [
      {
        text: 'Озвучить повестку в первые 5 минут.',
        severity: 'info',
        category: 'preparation',
      },
    ],
    strengths: ['Конкретные итоги.'],
  };

  const wrap = (qualityScore: unknown) => ({
    chapters: [{ title: 'Введение', summary: 'Текст.', startMs: 0, endMs: 60000 }],
    tasks: [],
    summary_markdown: '## Итоги',
    quality_score: qualityScore,
  });

  it('valid вложенный ответ проходит, значения сохранены', () => {
    const parsed = MeetingReportFastSchema.safeParse(wrap(BASE_QS));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.quality_score.overallScore).toBe(72);
      expect(parsed.data.quality_score.categories).toEqual({
        preparation: 70,
        structure: 75,
        clarity: 70,
        outcomes: 80,
        engagement: 65,
      });
    }
  });

  it('плоский ответ (категории на верхнем уровне) собирается в categories', () => {
    const flat = {
      overallScore: 68,
      preparation: 60,
      structure: 70,
      clarity: 65,
      outcomes: 72,
      engagement: 73,
      recommendations: BASE_QS.recommendations,
      strengths: BASE_QS.strengths,
    };
    const parsed = MeetingReportFastSchema.safeParse(wrap(flat));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.quality_score.overallScore).toBe(68);
      expect(parsed.data.quality_score.categories).toEqual({
        preparation: 60,
        structure: 70,
        clarity: 65,
        outcomes: 72,
        engagement: 73,
      });
    }
  });

  it('плоский ответ без overallScore — overallScore выводится как среднее категорий', () => {
    const flat = {
      preparation: 60,
      structure: 60,
      clarity: 60,
      outcomes: 60,
      engagement: 60,
      recommendations: BASE_QS.recommendations,
      strengths: BASE_QS.strengths,
    };
    const parsed = MeetingReportFastSchema.safeParse(wrap(flat));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.quality_score.overallScore).toBe(60);
      expect(parsed.data.quality_score.categories.preparation).toBe(60);
    }
  });

  it('значения вне диапазона (150, -3) клампятся в 0..100', () => {
    const drifted = {
      ...BASE_QS,
      overallScore: 150,
      categories: {
        preparation: 150,
        structure: -3,
        clarity: 99.6,
        outcomes: 80,
        engagement: 65,
      },
    };
    const parsed = MeetingReportFastSchema.safeParse(wrap(drifted));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.quality_score.overallScore).toBe(100);
      expect(parsed.data.quality_score.categories).toEqual({
        preparation: 100,
        structure: 0,
        clarity: 100,
        outcomes: 80,
        engagement: 65,
      });
    }
  });

  it('лишний неизвестный ключ в quality_score не валит парс', () => {
    const withExtra = {
      ...BASE_QS,
      sentiment: 'positive',
      _debug: { tokens: 1234 },
    };
    const parsed = MeetingReportFastSchema.safeParse(wrap(withExtra));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.quality_score.overallScore).toBe(72);
      expect(parsed.data.quality_score).not.toHaveProperty('sentiment');
    }
  });

  it('нечисловой/отсутствующий score дефолтится в 0, парс не падает', () => {
    const messy = {
      overallScore: 70,
      categories: {
        preparation: 'high',
        structure: null,
        clarity: 65,
        outcomes: 80,
        engagement: 65,
      },
      recommendations: BASE_QS.recommendations,
      strengths: BASE_QS.strengths,
    };
    const parsed = MeetingReportFastSchema.safeParse(wrap(messy));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.quality_score.categories.preparation).toBe(0);
      expect(parsed.data.quality_score.categories.structure).toBe(0);
      expect(parsed.data.quality_score.categories.clarity).toBe(65);
    }
  });
});

describe('meeting-report-fast — input_schema согласован с Zod', () => {
  it('top-level required списки совпадают', () => {
    expect(MEETING_REPORT_FAST_INPUT_SCHEMA.required?.sort()).toEqual(
      ['chapters', 'tasks', 'summary_markdown', 'quality_score', 'data_quality'].sort(),
    );
  });

  it('chapters items требуют title/summary/startMs/endMs', () => {
    const chapters = (MEETING_REPORT_FAST_INPUT_SCHEMA.properties as Record<string, unknown>)
      .chapters as {
      items: { required: string[] };
    };
    expect(chapters.items.required.sort()).toEqual(['title', 'summary', 'startMs', 'endMs'].sort());
  });

  it('tasks items требуют title и confidence', () => {
    const tasks = (MEETING_REPORT_FAST_INPUT_SCHEMA.properties as Record<string, unknown>)
      .tasks as {
      items: { required: string[] };
    };
    expect(tasks.items.required.sort()).toEqual(['title', 'confidence'].sort());
  });
});

describe('meeting-report-fast — snapshot (guard от случайных правок)', () => {
  it('system prompt для sales стабилен', () => {
    const system = buildMeetingReportFastSystemPrompt({ meetingType: 'sales' });
    expect(system).toMatchSnapshot('system-sales');
  });

  it('user prompt стабилен', () => {
    const user = buildMeetingReportFastUserPrompt({
      meetingTitle: 'Sync 2026-05-25',
      transcript: '[00:00-00:05] Alice: Привет.\n[00:05-00:10] Боб: Поехали.',
      participants: ['Alice', 'Боб'],
      meetingDateIso: '2026-05-25',
    });
    expect(user).toMatchSnapshot('user-basic');
  });
});
