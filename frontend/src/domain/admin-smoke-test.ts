import type { SmokeTestRunApi } from "@/api/admin-smoke-test.api";

export type SmokeTestRunUi = {
  id: string;
  provider: string;
  providerLabel: string;
  status: "ok" | "fail";
  statusLabel: string;
  statusTone: "success" | "danger";
  latencyMs: number | null;
  latencyLabel: string;
  ranAt: string;
  ranAtLabel: string;
  message: string | null;
};

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI (через прокси)",
  deepseek: "DeepSeek (через прокси)",
  anthropic: "Anthropic",
  ollama: "Ollama (локально)",
  vox: "Vox ASR",
  minimax: "MiniMax",
  grsai: "GRS AI",
  kie: "KIE",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

export function mapSmokeTestRun(
  api: SmokeTestRunApi,
  resolveLabel: (provider: string) => string = providerLabel,
): SmokeTestRunUi {
  const status: "ok" | "fail" = api.status === "ok" ? "ok" : "fail";
  return {
    id: api.id ?? `${api.provider}-${api.startedAt}`,
    provider: api.provider,
    providerLabel: resolveLabel(api.provider),
    status,
    statusLabel: status === "ok" ? "Успех" : "Ошибка",
    statusTone: status === "ok" ? "success" : "danger",
    latencyMs: api.latencyMs,
    latencyLabel:
      typeof api.latencyMs === "number" ? `${api.latencyMs} мс` : "—",
    ranAt: api.startedAt,
    ranAtLabel: formatDateTime(api.startedAt),
    message: api.error ?? null,
  };
}

function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
