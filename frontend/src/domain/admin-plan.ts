/**
 * Доменная модель Plan (тариф продукта) для Z-Admin Фаза 4.
 *
 * Контракт: backend `AdminPlansService.PlanItem` + `PlanUsageItem`.
 * Префикс эндпоинтов: `/api/v1/admin/orgs/plans`.
 */

/** Произвольный JSON-словарь features (boolean / string / number). */
export type PlanFeaturesMap = Record<string, boolean | string | number>;
/** Произвольный JSON-словарь quotas (number / string / boolean). */
export type PlanQuotasMap = Record<string, number | string | boolean>;

export type PlanItemApi = {
  id: string;
  displayName: string;
  description: string | null;
  features: unknown;
  quotas: unknown;
  monthlyPriceRub: number | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  orgsCount: number;
};

export type PlanListApi = {
  items: PlanItemApi[];
};

export type PlanUsageItemApi = {
  tenantId: string;
  orgName: string;
  orgSlug: string;
  membersCount: number;
  meetingsCount: number;
  createdAt: string;
};

export type PlanUsageApi = {
  plan: { id: string; displayName: string; isActive: boolean };
  orgsCount: number;
  items: PlanUsageItemApi[];
};

export type PlanItemDomain = Omit<
  PlanItemApi,
  'features' | 'quotas' | 'createdAt' | 'updatedAt'
> & {
  features: PlanFeaturesMap;
  quotas: PlanQuotasMap;
  createdAt: Date;
  updatedAt: Date;
};

export type PlanListDomain = { items: PlanItemDomain[] };

export type PlanUsageItemDomain = Omit<PlanUsageItemApi, 'createdAt'> & {
  createdAt: Date;
};

export type PlanUsageDomain = {
  plan: { id: string; displayName: string; isActive: boolean };
  orgsCount: number;
  items: PlanUsageItemDomain[];
};

function asFeaturesMap(v: unknown): PlanFeaturesMap {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: PlanFeaturesMap = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'boolean' || typeof val === 'string' || typeof val === 'number') {
      out[k] = val;
    } else if (val === null) {
      // skip nulls — Backend хранит null, в UI значит «не задано»
      continue;
    } else {
      // объекты/массивы выводим как строку — пользователь увидит и сможет починить
      out[k] = JSON.stringify(val);
    }
  }
  return out;
}

function asQuotasMap(v: unknown): PlanQuotasMap {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: PlanQuotasMap = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'number' || typeof val === 'string' || typeof val === 'boolean') {
      out[k] = val;
    } else if (val === null) {
      continue;
    } else {
      out[k] = JSON.stringify(val);
    }
  }
  return out;
}

export function planItemFromApi(api: PlanItemApi): PlanItemDomain {
  return {
    id: api.id,
    displayName: api.displayName,
    description: api.description,
    monthlyPriceRub: api.monthlyPriceRub,
    isActive: api.isActive,
    sortOrder: api.sortOrder,
    orgsCount: api.orgsCount,
    features: asFeaturesMap(api.features),
    quotas: asQuotasMap(api.quotas),
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
  };
}

export function planListFromApi(api: PlanListApi): PlanListDomain {
  return { items: api.items.map(planItemFromApi) };
}

export function planUsageFromApi(api: PlanUsageApi): PlanUsageDomain {
  return {
    plan: api.plan,
    orgsCount: api.orgsCount,
    items: api.items.map((it) => ({
      ...it,
      createdAt: new Date(it.createdAt),
    })),
  };
}

export type CreatePlanRequest = {
  id: string;
  displayName: string;
  description?: string;
  features: PlanFeaturesMap;
  quotas: PlanQuotasMap;
  monthlyPriceRub?: number;
  sortOrder?: number;
};

export type UpdatePlanRequest = {
  displayName?: string;
  description?: string | null;
  features?: PlanFeaturesMap;
  quotas?: PlanQuotasMap;
  monthlyPriceRub?: number | null;
  sortOrder?: number;
  isActive?: boolean;
};

/** Форматируем цену как «1 200 ₽/мес» либо «бесплатно». */
export function formatPlanPrice(rub: number | null): string {
  if (rub === null || rub === undefined) return 'бесплатно';
  return `${rub.toLocaleString('ru-RU')} ₽/мес`;
}
