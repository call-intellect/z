import type { DirectorDashboardDto } from '../dto/director-dashboard.dto';

/**
 * Sample story — синтетический датасет, который backend отдаёт пустому tenant'у.
 * Frontend рисует watermark «образец» поверх. ТЗ §1.2 принцип 4.
 *
 * Сюжет: воображаемая SaaS-команда «Поток», 6 человек, прошла одна неделя:
 *   - 3 новых темы (онбординг, биллинг, ретеншен)
 *   - Несколько сигналов разных типов
 *   - Открытый вопрос про метрики ретеншена
 *
 * Числа подобраны так, чтобы выглядело live, но не подавляло.
 */
export const SAMPLE_STORY_DATASET = {
  newThemes: [
    {
      id: 'sample-theme-1',
      name: 'Онбординг новых клиентов',
      branch: 'product' as string | null,
      weight: 18,
      dynamic: 'growing' as const,
      blocksCount: 6,
      lastSignalAt: null,
    },
    {
      id: 'sample-theme-2',
      name: 'Биллинг и оплата',
      branch: 'ops' as string | null,
      weight: 12,
      dynamic: 'stable' as const,
      blocksCount: 4,
      lastSignalAt: null,
    },
    {
      id: 'sample-theme-3',
      name: 'Ретеншн второй недели',
      branch: 'product' as string | null,
      weight: 9,
      dynamic: 'growing' as const,
      blocksCount: 3,
      lastSignalAt: null,
    },
  ],
  newSignals: [
    {
      id: 'sample-signal-1',
      name: 'Клиент Acme застрял на шаге импорта',
      signalType: 'pain',
      confidence: 0.82,
      criticalQuestion: 'Сколько клиентов отваливаются на этом шаге?',
      trustedAnswer:
        'Acme не смог импортировать таблицу > 5MB, контакт ушёл к конкуренту через 2 дня. Нужен progress-bar и retry.',
      evidenceMeetingId: null,
      reasonSourceRef: null,
    },
    {
      id: 'sample-signal-2',
      name: 'Запрос: ежемесячный счёт с разбивкой',
      signalType: 'feature_request',
      confidence: 0.74,
      criticalQuestion: 'Это блокер для оплаты или nice-to-have?',
      trustedAnswer:
        'Три клиента подряд просят детализацию по seats в инвойсе. Бухгалтерии нужна разбивка для проводки.',
      evidenceMeetingId: null,
      reasonSourceRef: null,
    },
    {
      id: 'sample-signal-3',
      name: 'Решение: переносим запуск API на 15 июня',
      signalType: 'decision',
      confidence: 0.91,
      criticalQuestion: '',
      trustedAnswer:
        'Команда решила сдвинуть запуск публичного API из-за нагрузочных тестов. Ответственный — Артём.',
      evidenceMeetingId: null,
      reasonSourceRef: null,
    },
  ],
  signalCounters: {
    pain: 3,
    feature_request: 5,
    churn_risk: 1,
    objection: 2,
    risk: 2,
    decision: 4,
    commitment: 8,
    other: 3,
  },
  activeThemes: [
    {
      id: 'sample-active-1',
      name: 'Производительность поиска',
      branch: 'engineering' as string | null,
      weight: 22,
      dynamic: 'growing' as const,
      blocksCount: 11,
      lastSignalAt: null,
    },
    {
      id: 'sample-active-2',
      name: 'Конверсия лендинга',
      branch: 'growth' as string | null,
      weight: 17,
      dynamic: 'stable' as const,
      blocksCount: 8,
      lastSignalAt: null,
    },
  ],
  hotEntities: [
    {
      id: 'sample-ent-1',
      canonicalName: 'Acme Corp',
      type: 'client',
      recentMentions: 7,
    },
    {
      id: 'sample-ent-2',
      canonicalName: 'Тариф Pro',
      type: 'product',
      recentMentions: 5,
    },
    {
      id: 'sample-ent-3',
      canonicalName: 'Артём Соколов',
      type: 'person',
      recentMentions: 4,
    },
  ],
  openQuestions: [
    {
      id: 'sample-q-1',
      name: 'Ретеншен второй недели',
      criticalQuestion:
        'Какая доля клиентов возвращается на 8-14 день? Нет ни одной метрики.',
      createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ],
} as const satisfies Omit<
  DirectorDashboardDto,
  | 'period'
  | 'generatedAt'
  | 'narrativeSummary'
  | 'strategicAlignment'
  | 'isEmpty'
  // KPI-hero выставляются отдельным набором в DirectorDashboardService
  // (синтетические оптимистичные значения для пустого tenant'а).
  | 'kpiSentimentIndex'
  | 'kpiCommitmentReliability'
  | 'kpiHangingDecisions'
  // ТЗ-2 Ф1 — «Полоса пользы» и флаг новой компоновки тоже выставляются в
  // DirectorDashboardService (valueStrip — реальный fetchValueStrip,
  // mainReworkEnabled — из AdminSetting), не входят в статичный датасет.
  | 'valueStrip'
  | 'mainReworkEnabled'
>;

/**
 * narrativeSummary для sample story — статичный текст с тонкой подсказкой,
 * что это пример.
 */
export const SAMPLE_STORY_NARRATIVE =
  'Это пример того, как выглядит ваш дашборд после недели работы. Команда «Поток» обсудила онбординг трёх клиентов: один (Acme) застрял на импорте — нужен progress-bar. Три клиента просят детализацию счёта — потенциальный churn-риск. Решено перенести запуск API на 15 июня из-за нагрузочных тестов. После вашей первой встречи здесь появятся реальные темы и сигналы.';
