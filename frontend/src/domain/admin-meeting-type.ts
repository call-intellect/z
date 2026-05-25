/**
 * Доменная модель MeetingTypeConfig для Z-Admin (Фаза 5 редизайна).
 *
 * Контракт сервера: `backend/src/modules/admin/content/meeting-types/`
 * (префикс `/api/v1/admin/content/meeting-types`).
 *
 * id — это значение `enum MeetingType` из Prisma. В MVP 9 значений:
 *   interview, discovery, plan_fact, sales, custdev, partner, customer_success,
 *   review, retrospective. Также допускаются: standup, team, project,
 *   task_discussion (расширения за пределами MVP).
 *
 * Бэкенд при пустой БД делает bootstrap-sync из enum, поэтому фронт спокойно
 * рендерит список «из коробки».
 */

/** Список допустимых id типов встреч (синхронизировано с enum MeetingType). */
export const MEETING_TYPE_IDS = [
  'interview',
  'discovery',
  'plan_fact',
  'sales',
  'custdev',
  'partner',
  'customer_success',
  'review',
  'retrospective',
  // расширения за пределами MVP — оставлены для типизации
  'standup',
  'team',
  'project',
  'task_discussion',
] as const;

export type MeetingTypeId = (typeof MEETING_TYPE_IDS)[number];

/** Подсказки для super_admin при выборе id (не локализация, а быстрый якорь). */
export const MEETING_TYPE_DEFAULT_LABELS: Record<MeetingTypeId, string> = {
  interview: 'Интервью кандидата',
  discovery: 'Discovery встреча',
  plan_fact: 'План-факт',
  sales: 'Продажи',
  custdev: 'Custdev / клиентское интервью',
  partner: 'Партнёрская встреча',
  customer_success: 'Customer Success',
  review: 'Обзорная встреча',
  retrospective: 'Ретроспектива',
  standup: 'Стендап',
  team: 'Командная встреча',
  project: 'Проектная встреча',
  task_discussion: 'Обсуждение задачи',
};

export type MeetingTypeItemApi = {
  id: string;
  displayName: string;
  description: string | null;
  icon: string | null;
  reportPromptKey: string | null;
  isActive: boolean;
  sortOrder: number;
  updatedBy: string | null;
  updatedAt: string;
};

export type MeetingTypeListApi = {
  items: MeetingTypeItemApi[];
};

export type MeetingTypeItemDomain = Omit<MeetingTypeItemApi, 'updatedAt'> & {
  updatedAt: Date;
};

export type MeetingTypeListDomain = {
  items: MeetingTypeItemDomain[];
};

export function meetingTypeItemFromApi(
  api: MeetingTypeItemApi,
): MeetingTypeItemDomain {
  return {
    ...api,
    updatedAt: new Date(api.updatedAt),
  };
}

export function meetingTypeListFromApi(
  api: MeetingTypeListApi,
): MeetingTypeListDomain {
  return { items: api.items.map(meetingTypeItemFromApi) };
}

export type CreateMeetingTypeRequest = {
  id: string;
  displayName: string;
  description?: string;
  icon?: string;
  reportPromptKey?: string;
  sortOrder?: number;
};

export type UpdateMeetingTypeRequest = {
  displayName?: string;
  description?: string | null;
  icon?: string | null;
  reportPromptKey?: string | null;
  sortOrder?: number;
  isActive?: boolean;
};
