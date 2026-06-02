import type { TablePropType } from '@prisma/client';

/**
 * Каталог системных Smart-таблиц (Smart-tables Фаза 0).
 *
 * При создании любой новой Org автоматически создаются ПУСТЫЕ (без строк)
 * системные таблицы по этим 10 шаблонам — см.
 * `TablesAutoProvisionService.provisionDefaults`. Наполнение строками — Фаза 2.
 *
 * Каждый шаблон:
 *   - `systemKey`   — стабильный ключ, уникальный в пределах Org
 *                     (`@@unique([tenantId, systemKey])` в schema.prisma).
 *                     Гарантирует идемпотентность авто-провижининга.
 *   - `entitySync`  — привязка строк к Entity графа (`org`/`person`/`document`)
 *                     либо `null`, если для этой таблицы entity-тип ещё не заведён.
 *   - `properties`  — колонки. Ровно одна с `isPrimary: true` — именующая.
 *
 * Форма `config` колонок (по schema.prisma §Smart Tables):
 *   - status / selectSingle / selectMulti → `{ options: [{ id, name, color }] }`,
 *     где `color` — тон из палитры Grid (success/warning/danger/info/neutral).
 *   - остальные типы (text/longtext/number/currency/date/person/...) → `{}`.
 *
 * NB: все пользовательские строки (названия таблиц, колонок, опций) — на русском.
 */

/** Тон чипа статуса/выбора. Совпадает с палитрой Grid (`pickToneByLabel`). */
export type SystemTableOptionColor =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral';

export interface SystemTableOption {
  id: string;
  name: string;
  color: SystemTableOptionColor;
}

export interface SystemTablePropertyTemplate {
  name: string;
  type: TablePropType;
  isPrimary?: boolean;
  /** Тип-специфичный конфиг. Для status/select — `{ options: [...] }`, иначе `{}`. */
  config?: Record<string, unknown>;
}

export interface SystemTableEntitySync {
  type: 'org' | 'person' | 'meeting' | 'document';
  autoCreate: boolean;
}

export interface SystemTableTemplate {
  systemKey: string;
  name: string;
  icon: string;
  /** `null`, если для таблицы ещё нет подходящего entity-типа (см. TODO Фаза 2). */
  entitySync: SystemTableEntitySync | null;
  properties: SystemTablePropertyTemplate[];
}

/** Хелпер: собрать `{ options: [...] }` из списка `[name, color]`. */
function statusConfig(
  options: ReadonlyArray<[name: string, color: SystemTableOptionColor]>,
): Record<string, unknown> {
  return {
    options: options.map(([name, color], i) => ({
      id: `opt-${i + 1}`,
      name,
      color,
    })),
  };
}

export const SYSTEM_TABLES_CATALOG: readonly SystemTableTemplate[] = [
  {
    systemKey: 'clients_deals',
    name: 'Клиенты и сделки',
    icon: '💼',
    entitySync: { type: 'org', autoCreate: false },
    properties: [
      { name: 'Название', type: 'text', isPrimary: true },
      { name: 'Контакт', type: 'person' },
      { name: 'Телефон', type: 'phone' },
      { name: 'Email', type: 'email' },
      {
        name: 'Стадия',
        type: 'status',
        config: statusConfig([
          ['Лид', 'warning'],
          ['Квалификация', 'info'],
          ['Переговоры', 'info'],
          ['Счёт', 'info'],
          ['Оплачено', 'success'],
          ['Отказ', 'danger'],
        ]),
      },
      { name: 'Сумма', type: 'currency' },
      { name: 'Дата касания', type: 'date' },
      { name: 'Ответственный', type: 'person' },
    ],
  },
  {
    systemKey: 'team',
    name: 'Команда',
    icon: '👥',
    entitySync: { type: 'person', autoCreate: false },
    properties: [
      { name: 'Имя', type: 'text', isPrimary: true },
      { name: 'Должность', type: 'text' },
      {
        name: 'Отдел',
        type: 'selectSingle',
        config: statusConfig([
          ['Продажи', 'info'],
          ['Маркетинг', 'info'],
          ['Разработка', 'info'],
          ['Поддержка', 'neutral'],
          ['Администрация', 'neutral'],
        ]),
      },
      {
        name: 'Навыки',
        type: 'selectMulti',
        config: statusConfig([
          ['Аналитика', 'info'],
          ['Переговоры', 'info'],
          ['Дизайн', 'info'],
          ['Разработка', 'info'],
          ['Управление', 'neutral'],
        ]),
      },
      { name: 'Руководитель', type: 'person' },
      { name: 'Дата найма', type: 'date' },
    ],
  },
  {
    systemKey: 'hypotheses',
    name: 'Гипотезы и эксперименты',
    icon: '🧪',
    // TODO Фаза 2: завести entity-тип experiment + расширить entitySync enum.
    entitySync: null,
    properties: [
      { name: 'Формулировка', type: 'longtext', isPrimary: true },
      {
        name: 'Статус',
        type: 'status',
        config: statusConfig([
          ['Новая', 'warning'],
          ['В работе', 'info'],
          ['Подтверждена', 'success'],
          ['Опровергнута', 'danger'],
        ]),
      },
      { name: 'Метрика', type: 'text' },
      { name: 'Ответственный', type: 'person' },
      { name: 'Дата старта', type: 'date' },
      { name: 'Результат', type: 'longtext' },
    ],
  },
  {
    systemKey: 'vendors',
    name: 'Поставщики и подрядчики',
    icon: '🤝',
    entitySync: { type: 'org', autoCreate: false },
    properties: [
      { name: 'Название', type: 'text', isPrimary: true },
      {
        name: 'Услуга',
        type: 'selectSingle',
        config: statusConfig([
          ['Сырьё', 'neutral'],
          ['Логистика', 'info'],
          ['Маркетинг', 'info'],
          ['ИТ-услуги', 'info'],
          ['Прочее', 'neutral'],
        ]),
      },
      { name: 'Стоимость', type: 'currency' },
      { name: 'Договор', type: 'url' },
      { name: 'Активен', type: 'checkbox' },
      { name: 'Ответственный', type: 'person' },
    ],
  },
  {
    systemKey: 'risks',
    name: 'Реестр рисков',
    icon: '⚠️',
    entitySync: null,
    properties: [
      { name: 'Описание', type: 'longtext', isPrimary: true },
      {
        name: 'Вероятность',
        type: 'status',
        config: statusConfig([
          ['Низкая', 'success'],
          ['Средняя', 'warning'],
          ['Высокая', 'danger'],
        ]),
      },
      {
        name: 'Влияние',
        type: 'status',
        config: statusConfig([
          ['Низкое', 'success'],
          ['Среднее', 'warning'],
          ['Высокое', 'danger'],
        ]),
      },
      { name: 'Митигация', type: 'longtext' },
      {
        name: 'Статус',
        type: 'status',
        config: statusConfig([
          ['Новый', 'warning'],
          ['В работе', 'info'],
          ['Закрыт', 'success'],
        ]),
      },
      { name: 'Владелец', type: 'person' },
    ],
  },
  {
    systemKey: 'ideas',
    name: 'Идеи и бэклог',
    icon: '💡',
    // TODO Фаза 2: entity-тип idea.
    entitySync: null,
    properties: [
      { name: 'Формулировка', type: 'longtext', isPrimary: true },
      {
        name: 'Источник',
        type: 'selectSingle',
        config: statusConfig([
          ['Встреча', 'info'],
          ['Клиент', 'info'],
          ['Команда', 'neutral'],
          ['Рынок', 'neutral'],
        ]),
      },
      {
        name: 'Приоритет',
        type: 'status',
        config: statusConfig([
          ['Низкий', 'success'],
          ['Средний', 'warning'],
          ['Высокий', 'danger'],
        ]),
      },
      { name: 'Ответственный', type: 'person' },
      {
        name: 'Статус',
        type: 'status',
        config: statusConfig([
          ['Новая', 'warning'],
          ['В работе', 'info'],
          ['Реализована', 'success'],
          ['Отклонена', 'danger'],
        ]),
      },
    ],
  },
  {
    systemKey: 'promises',
    name: 'Обещания и обязательства',
    icon: '🤞',
    // TODO Фаза 2: entity-тип promise.
    entitySync: null,
    properties: [
      { name: 'Что', type: 'longtext', isPrimary: true },
      { name: 'Кому', type: 'person' },
      { name: 'Срок', type: 'date' },
      {
        name: 'Статус',
        type: 'status',
        config: statusConfig([
          ['Новое', 'warning'],
          ['В работе', 'info'],
          ['Выполнено', 'success'],
          ['Просрочено', 'danger'],
        ]),
      },
      { name: 'Источник', type: 'text' },
    ],
  },
  {
    systemKey: 'content_plan',
    name: 'Контент-план',
    icon: '📰',
    entitySync: null,
    properties: [
      { name: 'Заголовок', type: 'text', isPrimary: true },
      {
        name: 'Формат',
        type: 'selectSingle',
        config: statusConfig([
          ['Статья', 'info'],
          ['Видео', 'info'],
          ['Пост', 'info'],
          ['Рассылка', 'neutral'],
        ]),
      },
      {
        name: 'Канал',
        type: 'selectSingle',
        config: statusConfig([
          ['Сайт', 'neutral'],
          ['Телеграм', 'info'],
          ['ВКонтакте', 'info'],
          ['Дзен', 'info'],
          ['Почта', 'neutral'],
        ]),
      },
      { name: 'Дата публикации', type: 'date' },
      {
        name: 'Статус',
        type: 'status',
        config: statusConfig([
          ['Идея', 'warning'],
          ['В работе', 'info'],
          ['На проверке', 'info'],
          ['Опубликовано', 'success'],
        ]),
      },
      { name: 'Ответственный', type: 'person' },
    ],
  },
  {
    systemKey: 'regulations',
    name: 'Регламенты и документы',
    icon: '📋',
    entitySync: { type: 'document', autoCreate: false },
    properties: [
      { name: 'Название', type: 'text', isPrimary: true },
      {
        name: 'Область',
        type: 'selectSingle',
        config: statusConfig([
          ['Продажи', 'info'],
          ['Финансы', 'info'],
          ['HR', 'info'],
          ['Производство', 'neutral'],
          ['Безопасность', 'neutral'],
        ]),
      },
      { name: 'Владелец', type: 'person' },
      { name: 'Дата ревизии', type: 'date' },
      {
        name: 'Статус',
        type: 'status',
        config: statusConfig([
          ['Черновик', 'warning'],
          ['Действует', 'success'],
          ['Устарел', 'danger'],
        ]),
      },
    ],
  },
  {
    systemKey: 'okr',
    name: 'Цели и метрики',
    icon: '🎯',
    // TODO Фаза 2: entitySync enum поддерживает только org/person/meeting/document;
    // goal есть в EntityType, но требует расширения DTO-enum.
    entitySync: null,
    properties: [
      { name: 'Формулировка', type: 'longtext', isPrimary: true },
      { name: 'Метрика', type: 'text' },
      { name: 'Текущее', type: 'number' },
      { name: 'Целевое', type: 'number' },
      { name: 'Срок', type: 'date' },
      { name: 'Ответственный', type: 'person' },
    ],
  },
] as const;
