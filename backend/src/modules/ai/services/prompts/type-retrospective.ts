import { z } from 'zod';

import {
  buildExtractTool,
  fieldEnum,
  fieldNullableString,
  fieldStringArray,
  type PromptInput,
  type PromptOutput,
  TaskItemSchema,
  turnsToText,
  withRoomChatNote,
  withToolInstructions,
} from './common';

export const TOOL_NAME = 'extract_retrospective';

const MOOD_VALUES = ['positive', 'mixed', 'negative', 'unknown'] as const;

export const SCHEMA = z
  .object({
    what_worked: z.array(z.string()),
    what_did_not_work: z.array(z.string()),
    action_items: z.array(TaskItemSchema),
    experiments: z.array(z.string()),
    kudos: z.array(z.string()),
    team_mood: z.enum(MOOD_VALUES),
    mood_notes: z.string().nullable(),
    recurring_problems: z.array(z.string()).optional(),
    data_quality: z.string().nullable().optional(),
  })
  .strict();

export type RetrospectiveReport = z.infer<typeof SCHEMA>;

const SYSTEM = `Ты — деловой ассистент. Это ретроспектива команды (retrospective) — обсуждение по итогам спринта, проекта или инцидента в формате «что работало / что не работало / action items».
Извлеки структурированный отчёт. Все поля — на русском, без оценочных суждений и без выдумывания.
- "what_worked": что работало хорошо — практики, процессы и решения, которые стоит сохранить.
- "what_did_not_work": что не работало — болевые точки, неэффективные процессы, повторяющиеся проблемы.
- "action_items": конкретные действия для исправления. Каждое — title + assignee + dueDate. assignee/dueDate = null, если не названы явно.
- "experiments": эксперименты, которые команда решила попробовать в следующем цикле.
- "kudos": благодарности участникам, признание заслуг.
- "team_mood": одно из значений ${MOOD_VALUES.join(' | ')}. "unknown" — если по диалогу нельзя надёжно определить.
- "mood_notes": 1-2 предложения о настроении команды (откуда вывод) или null.
Если массив пустой — возвращай []. Не дублируй пункты между what_worked и what_did_not_work.

Само-проверка и различения:
kudos атрибутируй («кто похвалил кого»), не обобщай. mood_notes — только наблюдаемое поведение (тон, реакции), НЕ психологизируй и не ставь диагнозы. Пусто — «не выявлено».

Дополнительно:
- "recurring_problems": проблемы, которые на ретро отмечены как повторяющиеся — «снова», «как всегда», «опять то же самое», «в прошлый раз тоже». Извлекай ТОЛЬКО при явном признаке повторяемости, единичную проблему сюда не клади. Пустой массив, если таких не было.
- "data_quality": 1-2 фразы о полноте и надёжности входных данных — обрывы транскрипта, неразборчивые места, неопределённые спикеры, реплики без атрибуции. null, если данные полные и претензий нет.

ПРИМЕРЫ.

Положительный пример (что извлечь):
Транскрипт-фрагмент: «Аня: релиз опять выкатили в пятницу вечером, как в прошлый раз — пришлось чинить ночью. Это уже третий спринт подряд. Олег: предлагаю ввести правило «никаких релизов после среды» — попробуем в следующем цикле. Аня: давайте. И спасибо Диме — он один разрулил инцидент с базой. Олег: решили: Дима к понедельнику опишет регламент дежурств».
Вывод: {"what_worked": [], "what_did_not_work": ["релизы в пятницу вечером ведут к ночным фиксам"], "action_items": [{"title": "описать регламент дежурств", "assignee": "Дима", "dueDate": "понедельник"}], "experiments": ["правило «никаких релизов после среды»"], "kudos": ["Аня поблагодарила Диму за то, что он один разрулил инцидент с базой"], "team_mood": "mixed", "mood_notes": "Усталость от повторяющихся проблем, но конструктивный настрой искать решения.", "recurring_problems": ["пятничные релизы повторяются третий спринт подряд («опять», «как в прошлый раз»)"], "data_quality": null}.

Что НЕ делать (edge case — разовая жалоба и оговорки распознавания):
Транскрипт-фрагмент: «Иван: сегодня был тормоз в сети, ничего не грузилось часа два. Думаю, надо бы… [неразборчиво] … попробовать новый формат демо. Петя: ну это разовое, у провайдера авария была».
Вывод: {"what_worked": [], "what_did_not_work": ["двухчасовой сбой сети из-за аварии провайдера"], "action_items": [], "experiments": [], "kudos": [], "team_mood": "unknown", "mood_notes": null, "recurring_problems": [], "data_quality": "Фрагмент короткий, есть неразборчивый участок; формулировка про «новый формат демо» оборвана — атрибуция и детали ненадёжны."}.
Пояснение: разовый сбой сети («сегодня», «разовое», авария провайдера) НЕ системная проблема → не в recurring_problems. Идея «попробовать новый формат демо» прозвучала, но обрывается на «надо бы…» — это незавершённое предложение без решения, не кладём в experiments и не превращаем в action_item; оговорку фиксируем в data_quality.`;

export function buildPrompt(input: PromptInput): PromptOutput {
  return {
    system: withRoomChatNote(withToolInstructions(SYSTEM, TOOL_NAME), input.roomChat),
    user: `Тип встречи: retrospective\nЗаголовок: ${input.meeting.title}\n\nДиалог:\n${turnsToText(input.dialog, input.roomChat)}`,
  };
}

export const TOOL = buildExtractTool(
  TOOL_NAME,
  'Извлечь структурированный отчёт ретроспективы команды',
  {
    what_worked: fieldStringArray,
    what_did_not_work: fieldStringArray,
    action_items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          assignee: { type: ['string', 'null'] },
          dueDate: { type: ['string', 'null'] },
        },
        required: ['title', 'assignee', 'dueDate'],
        additionalProperties: false,
      },
    },
    experiments: fieldStringArray,
    kudos: fieldStringArray,
    team_mood: fieldEnum(MOOD_VALUES),
    mood_notes: fieldNullableString,
    recurring_problems: fieldStringArray,
    data_quality: fieldNullableString,
  },
  [
    'what_worked',
    'what_did_not_work',
    'action_items',
    'experiments',
    'kudos',
    'team_mood',
    'mood_notes',
    'recurring_problems',
    'data_quality',
  ],
);
