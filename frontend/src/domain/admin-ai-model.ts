import type {
  AiModelGroup,
  AiModelTier,
  ProviderInTierApi,
  RouteChangeApi,
  TaskTypeMetricsApi,
  TaskTypeRouteApi,
} from "@/api/admin-ai-models.api";

export type ProviderInTierUi = ProviderInTierApi & {
  providerLabel: string;
  tierColor: "green" | "orange" | "gray";
};

export type TaskTypeRouteUi = Omit<
  TaskTypeRouteApi,
  "chain" | "primary" | "secondary" | "tertiary"
> & {
  primary: ProviderInTierUi | null;
  secondary: ProviderInTierUi | null;
  tertiary: ProviderInTierUi | null;
  chain: ProviderInTierUi[];
  groupLabel: string;
};

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic Claude",
  minimax: "MiniMax",
  "openai-via-proxy": "OpenAI (через прокси)",
  deepseek: "DeepSeek",
  ollama: "Ollama (локальный)",
};

const TIER_COLOR: Record<AiModelTier, ProviderInTierUi["tierColor"]> = {
  primary: "green",
  secondary: "orange",
  tertiary: "gray",
};

const GROUP_LABEL: Record<AiModelGroup | "unknown", string> = {
  "ai-pipeline": "AI-конвейер встреч",
  "knowledge-core": "База знаний",
  "competitor-parity": "Паритет с конкурентами",
  unknown: "Прочее",
};

const TIER_LABEL: Record<AiModelTier, string> = {
  primary: "Основная",
  secondary: "Запасная",
  tertiary: "Локальная",
};

const CHANGE_TYPE_LABEL: Record<string, string> = {
  switched_primary: "Переключение основной модели",
  added_provider: "Добавлен провайдер",
  removed_provider: "Удалён провайдер",
  started_ab: "Запущен A/B-тест",
  stopped_ab: "Остановлен A/B-тест",
  reset_to_default: "Сброс к дефолту",
  chain_replaced: "Изменена цепочка маршрута",
};

export function tierLabel(tier: AiModelTier): string {
  return TIER_LABEL[tier];
}

export function providerLabel(name: string): string {
  return PROVIDER_LABELS[name] ?? name;
}

export function changeTypeLabel(t: string): string {
  return CHANGE_TYPE_LABEL[t] ?? t;
}

export function mapProviderInTier(api: ProviderInTierApi): ProviderInTierUi {
  return {
    ...api,
    providerLabel: providerLabel(api.providerName),
    tierColor: TIER_COLOR[api.tier],
  };
}

export function mapTaskTypeRoute(api: TaskTypeRouteApi): TaskTypeRouteUi {
  return {
    ...api,
    groupLabel: GROUP_LABEL[api.group],
    primary: api.primary ? mapProviderInTier(api.primary) : null,
    secondary: api.secondary ? mapProviderInTier(api.secondary) : null,
    tertiary: api.tertiary ? mapProviderInTier(api.tertiary) : null,
    chain: api.chain.map(mapProviderInTier),
  };
}

export function formatPercent(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

export function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms} мс`;
  return `${(ms / 1000).toFixed(1)} с`;
}

export function formatCostRub(usd: number, rubRate: number | null): string {
  if (rubRate === null) {
    return `$${usd.toFixed(4)}`;
  }
  const rub = usd * rubRate;
  if (rub < 1) return `${(rub * 100).toFixed(2)} коп`;
  return `${rub.toFixed(2)} ₽`;
}
