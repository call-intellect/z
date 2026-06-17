import { SECTION_LABELS } from '@/lib/section-labels';

/**
 * Метка статического сегмента URL в контексте крошек. Ключ — имя сегмента
 * пути (НЕ полный href). Детерминированно (не зависит от роли), в отличие
 * от nav-config. Источник правды о текстовках крошек.
 */
export const SEGMENT_LABELS: Record<string, string> = {
  // верхний уровень разделов
  projects: 'Проекты',
  issues: 'Задачи',
  goals: 'Цели',
  themes: 'Темы',
  ideas: 'Идеи',
  decisions: 'Решения',
  roles: 'Должности',
  clones: 'Клоны',
  teams: 'Группы',
  persons: 'Люди',
  documents: 'Документы',
  tables: 'Таблицы',
  sprints: 'Спринты',
  curation: 'Курация',
  regulations: SECTION_LABELS.regulations, // «Правила и стандарты»
  structure: SECTION_LABELS.structure, // «Команда»
  referrals: SECTION_LABELS.referrals, // «Партнёрская программа»
  meetings: 'Встречи',
  memory: 'Память',
  settings: 'Настройки',
  support: 'Поддержка',
  me: 'Я',
  experiments: 'Эксперименты',
  insights: 'Сигналы',
  entities: 'Сущности',
  vendors: 'Поставщики',
  processes: 'Процессы',
  policies: 'Политики',
  tasks: 'Задачи',
  // вложенные сегменты проекта
  overview: 'Обзор',
  board: 'Доска',
  list: 'Список',
  calendar: 'Календарь',
  cycles: 'Спринты',
  gantt: 'Гант',
  intake: 'Входящие',
  integrations: 'Приложения',
  workload: 'Загруженность',
  review: 'Ревью',
  boards: 'Доски',
  // подмаршруты
  map: 'Карта',
  clone: 'Клон',
  history: 'История',
  desk: 'Поддержка',
  'my-tickets': 'Мои обращения',
};

/**
 * Динамические сегменты ([slug]/[id]/...) → метка ТИПА сущности (fallback,
 * когда имя ещё не зарегистрировано страницей). Ключ — имя РОДИТЕЛЬСКОГО
 * статического сегмента, в котором лежит динамический.
 * Никогда не показываем сырой id/slug — только это.
 */
export const DYNAMIC_FALLBACK_BY_PARENT: Record<string, string> = {
  projects: 'Проект',
  issues: 'Задача',
  goals: 'Цель',
  themes: 'Тема',
  ideas: 'Идея',
  decisions: 'Решение',
  roles: 'Должность',
  clones: 'Клон',
  teams: 'Группа',
  persons: 'Человек',
  documents: 'Документ',
  tables: 'Таблица',
  sprints: 'Спринт',
  cycles: 'Спринт',
  boards: 'Доска',
  curation: 'Запись',
  entities: 'Сущность',
  vendors: 'Поставщик',
  experiments: 'Эксперимент',
  desk: 'Обращение',
  'my-tickets': 'Обращение',
};

/**
 * Сегменты, по которым нельзя кликнуть (нет реальной страницы-списка) —
 * ведут на 404. Рендерятся как текст-звено без href.
 * `issues` — нет страницы `/issues` (задачи логически живут в проекте).
 */
export const NON_NAVIGABLE_SEGMENTS: ReadonlySet<string> = new Set<string>(['issues']);
