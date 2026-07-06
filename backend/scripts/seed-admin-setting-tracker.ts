import { type Prisma } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

type Severity = 'low' | 'medium' | 'high' | 'destructive';

interface SettingSeed {
  key: string;
  value: unknown;
  category: string;
  section: string;
  severity: Severity;
  description: string;
}

const SEEDS: SettingSeed[] = [
  {
    key: 'tracker.assigneeMatchMaxEdits',
    value: 2,
    category: 'tracker',
    section: 'workers',
    severity: 'low',
    description:
      'Допуск опечаток/склонений при поиске исполнителя по имени (расстояние Левенштейна на общей основе). По умолчанию 2, диапазон 0–4. 0 — только точное совпадение.',
  },
  {
    key: 'tracker.taskDedupGrayBand',
    value: 0.07,
    category: 'tracker',
    section: 'workers',
    severity: 'low',
    description:
      'Ширина серой зоны семантического дедупа задач: при сходстве в диапазоне [порог − зона; порог) вердикт «дубль/не дубль» выносит LLM-арбитр, а не одна косинусная близость. По умолчанию 0.07, диапазон 0–1. Больше зона — чаще зовём арбитра.',
  },
  {
    key: 'tracker.progressAutoDraftEnabled',
    value: true,
    category: 'tracker',
    section: 'workers',
    severity: 'high',
    description:
      'Рубильник воркера авто-черновика прогресса задач из графа знаний. По умолчанию вкл (Ship-On).',
  },
  {
    key: 'tracker.progressAutoDraftMinSignals',
    value: 2,
    category: 'tracker',
    section: 'workers',
    severity: 'low',
    description:
      'Минимум дельта-сигналов по задаче для создания авто-черновика прогресса. По умолчанию 2 (минимум 1).',
  },
  {
    key: 'tracker.progressAutoDraftCron',
    value: '0 7 * * *',
    category: 'tracker',
    section: 'workers',
    severity: 'low',
    description:
      'Кадэнс (cron) воркера авто-черновика прогресса. По умолчанию ежедневно в 07:00 UTC.',
  },
  {
    key: 'tracker.progressAutoDraftMinConfidence',
    value: 0.35,
    category: 'tracker',
    section: 'workers',
    severity: 'low',
    description:
      'Порог уверенности авто-черновика прогресса: черновик с confidence ниже порога тихо гасится и не попадает в «Подтверждения» (анти-fatigue). По умолчанию 0.35, диапазон 0–1.',
  },
  {
    key: 'tracker.progressAutoDraftRequireSubstantiveSignal',
    value: true,
    category: 'tracker',
    section: 'workers',
    severity: 'medium',
    description:
      'Требовать хотя бы один содержательный сигнал (выполненный пункт чек-листа или упоминание задачи в графе) для создания авто-черновика прогресса. По умолчанию вкл: одни смены статуса черновик не создают. Выкл → старое поведение (черновик может родиться и только из смен статуса).',
  },
  {
    key: 'tracker.activityDigestEnabled',
    value: true,
    category: 'tracker',
    section: 'workers',
    severity: 'high',
    description:
      'Рубильник AI-сводки изменений по задаче (catch-up «что произошло»). По умолчанию вкл (Ship-On).',
  },
  {
    key: 'tracker.automationsEnabled',
    value: true,
    category: 'tracker',
    section: 'workers',
    severity: 'high',
    description:
      'Рубильник пользовательских автоматизаций трекера (правила if-this-then-that). По умолчанию вкл (Ship-On). Выкл — движок не применяет ни одно правило.',
  },
  {
    key: 'tracker.recurrenceEnabled',
    value: true,
    category: 'tracker',
    section: 'workers',
    severity: 'high',
    description:
      'Рубильник воркера материализации повторяющихся задач. По умолчанию вкл (Ship-On). Выкл — повторения не создают новые задачи.',
  },
  {
    key: 'tracker.recurrenceCronCadence',
    value: '0 6 * * *',
    category: 'tracker',
    section: 'workers',
    severity: 'low',
    description:
      'Кадэнс (cron) воркера материализации повторяющихся задач. По умолчанию ежедневно в 06:00 UTC.',
  },
  {
    key: 'tracker.overdueNotifyEnabled',
    value: true,
    category: 'ai',
    section: 'tracker',
    severity: 'high',
    description:
      'Слать исполнителю уведомление о просрочке задачи (in_app + Telegram). Рубильник, по умолчанию вкл (Ship-On).',
  },
  {
    key: 'tracker.assigneeClarifyEnabled',
    value: true,
    category: 'ai',
    section: 'tracker',
    severity: 'high',
    description:
      'Дозапрашивать исполнителя задачи через уточняющий вопрос (probe), если не определён. Рубильник, по умолчанию вкл (Ship-On).',
  },
  {
    key: 'tracker.dueDateClarifyEnabled',
    value: true,
    category: 'ai',
    section: 'tracker',
    severity: 'medium',
    description:
      'Дозапрашивать срок задачи через уточняющий вопрос (probe), если не указан. Рубильник, по умолчанию вкл (Ship-On).',
  },
  {
    key: 'tracker.assigneeProbePriorityHint',
    value: 0.7,
    category: 'ai',
    section: 'tracker',
    severity: 'low',
    description:
      'Приоритет уточняющего вопроса об исполнителе задачи (0–1). По умолчанию 0.7.',
  },
  {
    key: 'tracker.meetingTasksAlwaysPromote',
    value: true,
    category: 'ai',
    section: 'tracker',
    severity: 'medium',
    description:
      'Задача со встречи всегда становится Issue в трекере (неназначенной, проект «Из встреч»), даже если Кора не распознала исполнителя/срок. Рубильник, по умолчанию вкл (Ship-On). Выкл → встречные задачи без исполнителя остаются в /intake.',
  },
  {
    key: 'tracker.taskDedupLinkSemantics',
    value: 'link',
    category: 'tracker',
    section: 'workers',
    severity: 'high',
    description:
      'Семантика единого дедупа задач. `link` (по умолчанию, Ship-On) — дубль связывается через TaskSource (одна задача — N источников); `delete` — аварийный откат на удаление дубля внутри одной встречи. Рубильник.',
  },
  {
    key: 'tracker.taskExtractMinConfidence',
    value: 0.45,
    category: 'tracker',
    section: 'workers',
    severity: 'low',
    description:
      'Порог уверенности спайн-специалиста 3-15-tasks: блок с confidence извлечённой задачи ниже порога считается «не задачей» и не материализуется в IntakeIssue. По умолчанию 0.45, диапазон 0–1.',
  },
  {
    key: 'tracker.selfAssignAuthorFallbackEnabled',
    value: true,
    category: 'ai',
    section: 'tracker',
    severity: 'medium',
    description:
      'Само-назначение «мне» на встречах: если агент выразил само-назначение, но имя автора не зарезолвилось (техметка спикера), подставить автора цитаты исполнителем задачи. Рубильник, по умолчанию вкл (Ship-On). Выкл → неразрешённое само-назначение уходит в probe-дозапрос исполнителя.',
  },
  {
    key: 'tracker.taskDismissUndoWindowHours',
    value: 24,
    category: 'ai',
    section: 'tracker',
    severity: 'low',
    description:
      'Окно отмены удаления задачи (в часах): сколько времени после ответа «удалить» задачу можно вернуть, прежде чем удаление станет окончательным. По умолчанию 24 часа, минимум 1.',
  },
  {
    key: 'tracker.completionDetailGateEnabled',
    value: true,
    category: 'ai',
    section: 'tracker',
    severity: 'high',
    description:
      'Строгий гейт конкретики при закрытии задачи через помощника: если в подтверждении нет деталей выполнения, кандидат на закрытие не создаётся, а исполнителю поднимается уточняющий вопрос «что конкретно сделано». Рубильник, по умолчанию вкл (Ship-On). Выкл → кандидат создаётся всегда (старое поведение).',
  },
  {
    key: 'tracker.closureNotifyCreatorEnabled',
    value: true,
    category: 'ai',
    section: 'tracker',
    severity: 'high',
    description:
      'Уведомлять постановщика (создателя) задачи о её закрытии исполнителем («Исполнитель закрыл задачу — проверьте»), кроме само-закрытия. Доставка in_app + Telegram. Рубильник, по умолчанию вкл (Ship-On). Выкл → постановщик не получает уведомление о закрытии.',
  },
  {
    key: 'tracker.livingCardEnabled',
    value: true,
    category: 'ai',
    section: 'tracker',
    severity: 'high',
    description:
      'Живая карточка задачи: когда в разговоре всплывает уже существующая открытая задача, но это прогресс, а не закрытие (LLM-вердикт «не выполнено»), ход выполнения дописывается в карточку отдельной записью прогресса (IssueProgressUpdate, authorType ai_agent, draftState pending), не перезатирая описание. Идемпотентно по блоку-источнику. Рубильник, по умолчанию вкл (Ship-On). Выкл → ход прогресса из разговора теряется (старое поведение).',
  },
  {
    key: 'tracker.progressFromConversationMinConfidence',
    value: 0.6,
    category: 'ai',
    section: 'tracker',
    severity: 'medium',
    description:
      'Порог уверенности для записи хода выполнения задачи из разговорного блока (живая карточка). Если уверенность LLM-вердикта (или близость матча) ниже порога, запись прогресса не создаётся — анти-fatigue. По умолчанию 0.6, диапазон 0–1.',
  },
  {
    key: 'tracker.taskClarifySweep.enabled',
    value: true,
    category: 'tracker',
    section: 'workers',
    severity: 'high',
    description:
      'Рубильник ежедневного свода-добора: проходит по задачам без исполнителя/срока старше N часов и шлёт постановщику уточняющий вопрос (probe). По умолчанию вкл (Ship-On).',
  },
  {
    key: 'tracker.taskClarifySweep.hourMsk',
    value: 10,
    category: 'tracker',
    section: 'workers',
    severity: 'low',
    description:
      'Час по МСК, в который запускается ежедневный свод-добор уточнений по задачам без исполнителя/срока. По умолчанию 10, диапазон 0–23.',
  },
  {
    key: 'tracker.taskClarifySweep.minAgeHours',
    value: 20,
    category: 'tracker',
    section: 'workers',
    severity: 'low',
    description:
      'Минимальный возраст pending-задачи (в часах) для попадания в свод-добор уточнений: задачу дозапрашиваем, только если она «висит» дольше этого порога. По умолчанию 20, диапазон 1–168.',
  },
  {
    key: 'tracker.methodCaptureEnabled',
    value: true,
    category: 'tracker',
    section: 'workers',
    severity: 'high',
    description:
      'Рубильник агента «расскажи, как решал»: при первом переходе значимой задачи в «Готово» исполнителю поднимается уточняющий вопрос с просьбой описать пошагово, как он её решал (можно голосом). По умолчанию вкл (Ship-On).',
  },
  {
    key: 'tracker.methodCaptureMinComplexity',
    value: 0.5,
    category: 'tracker',
    section: 'workers',
    severity: 'low',
    description:
      'Минимальная сложность задачи (0–1) для подъёма вопроса «как решал» при закрытии. Сложность считается из длины описания, числа записей активности, времени жизни задачи и приоритета. По умолчанию 0.5: тривиальные задачи вопросом не беспокоят.',
  },
  {
    key: 'tracker.methodCapturePriorityHint',
    value: 0.7,
    category: 'tracker',
    section: 'workers',
    severity: 'low',
    description:
      'Приоритет (0–1) уточняющего вопроса «как решал» при закрытии значимой задачи. По умолчанию 0.7.',
  },
  {
    key: 'taskClosure.embedMaxAttempts',
    value: 3,
    category: 'operations',
    section: 'workers',
    severity: 'low',
    description:
      'Сколько раз пробовать посчитать embedding текста сигнала при единичном сбое LLM-эмбеддера (ретрай). По умолчанию 3, минимум 1. null возвращается только если все попытки провалились.',
  },
];

interface Counters {
  created: number;
  updated: number;
  skippedAdminEdited: number;
}

async function upsertSetting(seed: SettingSeed, counters: Counters): Promise<void> {
  const existing = await prisma.adminSetting.findUnique({
    where: { key: seed.key },
    select: { updatedBy: true },
  });
  const valueInput = seed.value as Prisma.InputJsonValue;

  if (!existing) {
    await prisma.adminSetting.create({
      data: {
        key: seed.key,
        value: valueInput,
        category: seed.category,
        section: seed.section,
        severity: seed.severity,
        description: seed.description,
      },
    });
    counters.created++;
    console.log(`[create] ${seed.key}`);
    return;
  }

  if (existing.updatedBy && existing.updatedBy !== 'system') {
    await prisma.adminSetting.update({
      where: { key: seed.key },
      data: {
        category: seed.category,
        section: seed.section,
        severity: seed.severity,
        description: seed.description,
      },
    });
    counters.skippedAdminEdited++;
    console.log(`[skip:admin-edited] ${seed.key}`);
    return;
  }

  await prisma.adminSetting.update({
    where: { key: seed.key },
    data: {
      value: valueInput,
      category: seed.category,
      section: seed.section,
      severity: seed.severity,
      description: seed.description,
    },
  });
  counters.updated++;
  console.log(`[update] ${seed.key}`);
}

async function main(): Promise<void> {
  console.log('=== seed-admin-setting-tracker START ===');

  const counters: Counters = {
    created: 0,
    updated: 0,
    skippedAdminEdited: 0,
  };

  for (const seed of SEEDS) {
    await upsertSetting(seed, counters);
  }

  console.log(
    `created=${counters.created}, updated=${counters.updated}, skipped_admin_edited=${counters.skippedAdminEdited}`,
  );
  console.log('=== seed-admin-setting-tracker DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-tracker FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
