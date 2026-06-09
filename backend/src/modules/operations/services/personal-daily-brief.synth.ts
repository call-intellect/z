/**
 * TZ-1 Фаза 2 (daily-value-engine) — чистая логика синтеза персонального
 * дневного брифа «Твой день».
 *
 * Выделено отдельным модулем без зависимостей от Prisma/NestJS, чтобы покрыть
 * unit-тестами без БД/времени. Сервис `PersonalDailyBriefService` собирает
 * сырьё из БД, прогоняет через `dedupBriefItems` и кладёт в payload.
 *
 * Дедуп нужен потому, что один и тот же факт может прийти из разных источников:
 * обещание (`IdeaBlock commitment`), которое стало задачей (`Issue`/`Task`),
 * или задача, закрытая через чек-ин. Ключ дедупа — стабильная пара
 * `(kind, dedupKey)`, где dedupKey — sourceBlockId / taskId / commitmentId /
 * issueId. Приоритет источника при коллизии — по `priority` (меньше = важнее).
 */

/** Вид пункта брифа. */
export type BriefItemKind =
  | 'task' // задача (Issue/Task), назначенная на меня
  | 'my_promise' // обещание, которое Я дал (commitmentAuthor)
  | 'blocker' // открытый блокер, автором которого являюсь я
  | 'promised_to_me'; // обещание, данное МНЕ (commitmentRecipient)

/** Один пункт брифа (унифицированный для дедупа). */
export interface BriefItem {
  kind: BriefItemKind;
  /**
   * Стабильный ключ дедупа в рамках kind. Для задач — taskId/issueId; для
   * обещаний/блокеров — IdeaBlock.id (или связанный sourceBlockId, если задача
   * порождена блоком — тогда задача и обещание схлопываются в один пункт).
   */
  dedupKey: string;
  /** Человекочитаемый заголовок. */
  title: string;
  /** ISO-срок (due) или null. */
  dueDateIso: string | null;
  /** true, если просрочено (due < сегодня). */
  overdue: boolean;
  /**
   * Приоритет источника при коллизии dedupKey (меньше = важнее, остаётся он).
   * Задача из трекера (явная) важнее «сырого» обещания-блока, поэтому у task
   * приоритет ниже числом. По умолчанию 100.
   */
  priority?: number;
  /** Опц. имя контрагента (кто обещал / кому обещал). */
  counterpartyName?: string | null;
}

/** Структура подсказки «кто знает X» (skill-помощь по блокеру). */
export interface BriefKnowsWhoHint {
  /** id блокера, по которому ищем носителя. */
  blockId: string;
  /** Краткий текст блокера. */
  blockerText: string;
  /** Носитель знания (имя), которого предлагаем спросить. */
  expertPersonId: string;
  expertName: string;
  /** Уверенность матча [0..1]. */
  confidence: number;
}

/**
 * TZ-1 Ф4.B (daily-value-engine) — «ты не один»: сколько коллег сегодня
 * уперлись в ту же тему (инсайт), и эскалирована ли она. Опционально —
 * добавляется в бриф рядового только если найдено сов-падение, без отдельного
 * пуша (избегаем спама — встраиваем в утренний бриф).
 */
export interface BriefInsightCoOccurrence {
  /** id инсайта (общая тема). */
  insightId: string;
  /** Краткая суть инсайта. */
  statement: string;
  /** Сколько коллег (Person) сегодня тоже про это (включая меня). */
  colleaguesCount: number;
  /** Эскалирована ли тема (severity high/critical ИЛИ dynamicLabel=spike). */
  escalated: boolean;
}

/** Полный payload персонального брифа (хранится в PersonalDailyBrief.payloadJson). */
export interface PersonalDailyBriefPayload {
  /** YYYY-MM-DD — день брифа (локальная TZ Person'а). */
  dateLocal: string;
  /** Задачи, назначенные на меня (due today/overdue). */
  myTasks: BriefItem[];
  /** Обещания, которые Я дал, со сроком сегодня/просроченные. */
  myPromises: BriefItem[];
  /** Открытые блокеры, автором которых являюсь я. */
  myBlockers: BriefItem[];
  /** Обещания, данные МНЕ. */
  promisedToMe: BriefItem[];
  /** 1 подсказка дня (LLM или детерминированный fallback), может быть пустой. */
  hint: string;
  /** Skill-помощь по открытому блокеру (если найден носитель). */
  knowsWho: BriefKnowsWhoHint | null;
  /**
   * TZ-1 Ф4.B — «ты не один»: коллеги уперлись в ту же тему (инсайт).
   * `null`/отсутствует — совпадений нет (опциональное, чтобы не ломать legacy).
   */
  insightCoOccurrence?: BriefInsightCoOccurrence | null;
  /** Сводные счётчики (для коротких push/баджей). */
  counts: {
    tasks: number;
    promises: number;
    blockers: number;
    promisedToMe: number;
  };
}

const DEFAULT_PRIORITY = 100;

/**
 * Дедуп пунктов одного вида по `dedupKey`. При коллизии остаётся пункт с
 * меньшим `priority` (важнее); порядок исходного массива сохраняется для
 * стабильности (первый встреченный с данным ключом задаёт позицию).
 *
 * Чистая функция — для unit-тестов (обещание-ставшее-задачей считается один раз).
 */
export function dedupBriefItems(items: readonly BriefItem[]): BriefItem[] {
  const byKey = new Map<string, { item: BriefItem; index: number }>();
  let order = 0;
  for (const it of items) {
    if (!it || typeof it.dedupKey !== 'string' || it.dedupKey.length === 0) {
      // Без ключа — не дедупаем, добавляем как есть (уникальный синтетический ключ).
      byKey.set(`__nokey__${order}`, { item: it, index: order });
      order++;
      continue;
    }
    const key = `${it.kind}::${it.dedupKey}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { item: it, index: order });
      order++;
      continue;
    }
    const curPrio = existing.item.priority ?? DEFAULT_PRIORITY;
    const newPrio = it.priority ?? DEFAULT_PRIORITY;
    if (newPrio < curPrio) {
      // Новый важнее — заменяем, но сохраняем исходную позицию.
      byKey.set(key, { item: it, index: existing.index });
    }
  }
  return [...byKey.values()]
    .sort((a, b) => a.index - b.index)
    .map((v) => v.item);
}

/**
 * Кросс-вид дедуп: если обещание (my_promise) ПРЕВРАТИЛОСЬ в задачу (task) —
 * один и тот же sourceBlockId присутствует и там, и там. В этом случае задача
 * (явная, из трекера) вытесняет обещание-блок, чтобы не показывать дважды.
 *
 * Принимает уже дедуплицированные внутри-вида массивы, возвращает очищенные
 * promises (без тех, чей dedupKey совпадает с dedupKey какой-либо задачи).
 * Чистая функция.
 */
export function dropPromisesThatBecameTasks(args: {
  tasks: readonly BriefItem[];
  promises: readonly BriefItem[];
}): BriefItem[] {
  const taskKeys = new Set(args.tasks.map((t) => t.dedupKey));
  return args.promises.filter((p) => !taskKeys.has(p.dedupKey));
}
