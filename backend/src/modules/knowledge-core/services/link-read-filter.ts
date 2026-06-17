import { LinkStatus } from '@prisma/client';

/** Единый фильтр «живого» ребра графа: активно И не удалено (soft-delete). Класс K2 / Б2. */
export const ACTIVE_LINK_FILTER = {
  status: LinkStatus.active,
  deletedAt: null,
} as const;
