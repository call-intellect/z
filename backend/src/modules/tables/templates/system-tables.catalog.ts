import type { TablePropType } from '@prisma/client';

export type SystemTableOptionColor = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface SystemTablePropertyTemplate {
  name: string;
  type: TablePropType;
  isPrimary?: boolean;
  config?: Record<string, unknown>;
}

export interface SystemTableEntitySync {
  type: 'org' | 'person' | 'meeting' | 'document';
  autoCreate: boolean;
  entityTypes?: string[];
}

export interface SystemTableTemplate {
  systemKey: string;
  name: string;
  icon: string;
  entitySync: SystemTableEntitySync | null;
  properties: SystemTablePropertyTemplate[];
}

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
    entitySync: { type: 'org', autoCreate: true, entityTypes: ['customer'] },
    properties: [
      {
        name: 'Название',
        type: 'text',
        isPrimary: true,
        config: { readonly: true, source: 'entity', entityAttribute: 'canonicalName' },
      },
      { name: 'Контакт', type: 'person' },
      {
        name: 'Телефон',
        type: 'phone',
        config: { readonly: true, source: 'entity', entityAttribute: 'phone' },
      },
      {
        name: 'Email',
        type: 'email',
        config: { readonly: true, source: 'entity', entityAttribute: 'email' },
      },
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
    entitySync: { type: 'person', autoCreate: true, entityTypes: ['person'] },
    properties: [
      {
        name: 'Имя',
        type: 'text',
        isPrimary: true,
        config: { readonly: true, source: 'entity', entityAttribute: 'canonicalName' },
      },
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
    entitySync: { type: 'org', autoCreate: true, entityTypes: ['vendor'] },
    properties: [
      {
        name: 'Название',
        type: 'text',
        isPrimary: true,
        config: { readonly: true, source: 'entity', entityAttribute: 'canonicalName' },
      },
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
    entitySync: { type: 'document', autoCreate: true, entityTypes: ['document'] },
    properties: [
      {
        name: 'Название',
        type: 'text',
        isPrimary: true,
        config: { readonly: true, source: 'entity', entityAttribute: 'canonicalName' },
      },
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
