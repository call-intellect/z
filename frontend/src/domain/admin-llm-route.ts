/**
 * Domain-слой для admin/llm-routes — группировка сырых записей `LlmTaskRoute`
 * (по одной на tier) в одну UI-строку для таблицы.
 *
 * Бэкенд может вернуть для одного `taskType`:
 *   - до 3 нормализованных записей (по `tier=primary|secondary|tertiary`,
 *     полями `providerName` + `model` + `isActive` + `editedByAdmin`); либо
 *   - одну legacy-запись с массивом `providers: [{provider, model?}]` — там
 *     primary = providers[0], secondary = providers[1] и т.д.
 *
 * Здесь оба формата сводятся к одному `LlmRouteUi` с тремя слотами и общим
 * флагом `editedByAdmin` (true, если хотя бы одна составляющая запись
 * помечена админом).
 */

import type {
  LlmRouteRawApi,
  LlmRoutesListApiResponse,
} from '@/api/admin-llm-routes.api';

export type LlmRouteTierEntryUi = {
  providerName: string;
  model: string;
  isActive: boolean;
};

export type LlmRouteUi = {
  taskType: string;
  /** null = глобальный дефолт; в этой странице обрабатываем только null. */
  tenantId: string | null;
  primary?: LlmRouteTierEntryUi;
  secondary?: LlmRouteTierEntryUi;
  tertiary?: LlmRouteTierEntryUi;
  editedByAdmin: boolean;
  requiredDataClass: string;
  /**
   * ТЗ 2026-05-25 clone-reliability-hardening, Фаза 6.5 — заморозка версии модели.
   * null = не закреплено (для критичных агентов UI показывает предупреждение).
   */
  pinnedVersionNote: string | null;
};

const EMPTY_MODEL_PLACEHOLDER = '—';

function entryFromRaw(raw: LlmRouteRawApi): LlmRouteTierEntryUi {
  return {
    providerName: raw.providerName ?? '',
    model: raw.model ?? EMPTY_MODEL_PLACEHOLDER,
    isActive: raw.isActive,
  };
}

function entryFromLegacy(
  p: { provider: string; model?: string },
  isActive: boolean,
): LlmRouteTierEntryUi {
  return {
    providerName: p.provider,
    model: p.model ?? EMPTY_MODEL_PLACEHOLDER,
    isActive,
  };
}

/**
 * Группировка списка по `taskType`. Глобальные дефолты (`tenantId === null`)
 * + раздельные `tier`-ы сливаются в один `LlmRouteUi`. Если для taskType
 * есть и tier-записи, и legacy — приоритет у tier-записей (как и в бэкенде,
 * см. `LlmRouterService.refreshCache`).
 */
export function llmRoutesUiListFromApi(
  res: LlmRoutesListApiResponse,
): LlmRouteUi[] {
  const items = res.items.filter((r) => (r.tenantId ?? null) === null);

  const grouped = new Map<string, LlmRouteRawApi[]>();
  for (const r of items) {
    const arr = grouped.get(r.taskType) ?? [];
    arr.push(r);
    grouped.set(r.taskType, arr);
  }

  const out: LlmRouteUi[] = [];
  for (const [taskType, rows] of grouped) {
    const tieredRows = rows.filter(
      (r) => r.tier === 'primary' || r.tier === 'secondary' || r.tier === 'tertiary',
    );
    const legacyRows = rows.filter((r) => r.tier == null);

    let primary: LlmRouteTierEntryUi | undefined;
    let secondary: LlmRouteTierEntryUi | undefined;
    let tertiary: LlmRouteTierEntryUi | undefined;
    let editedByAdmin = false;
    let requiredDataClass = 'public';
    // ТЗ 2026-05-25 clone-reliability-hardening, Фаза 6.5 — берём первое
    // непустое значение из любой записи по этому taskType (заметка
    // синхронизируется backend'ом на все строки одного taskType).
    let pinnedVersionNote: string | null = null;
    for (const r of rows) {
      const v = r.pinnedVersionNote;
      if (typeof v === 'string' && v.length > 0) {
        pinnedVersionNote = v;
        break;
      }
    }

    if (tieredRows.length > 0) {
      // Внутри tier'а может быть несколько записей — берём с минимальным priority.
      const byTier = (tier: 'primary' | 'secondary' | 'tertiary') => {
        const rs = tieredRows
          .filter((r) => r.tier === tier)
          .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
        return rs[0];
      };
      const p = byTier('primary');
      const s = byTier('secondary');
      const t = byTier('tertiary');
      if (p) primary = entryFromRaw(p);
      if (s) secondary = entryFromRaw(s);
      if (t) tertiary = entryFromRaw(t);
      editedByAdmin = tieredRows.some((r) => r.editedByAdmin === true);
      requiredDataClass =
        tieredRows.find((r) => r.requiredDataClass)?.requiredDataClass ?? 'public';
    } else if (legacyRows.length > 0) {
      const r = legacyRows[0]!;
      const list = r.providers ?? [];
      if (list[0]) primary = entryFromLegacy(list[0], r.isActive);
      if (list[1]) secondary = entryFromLegacy(list[1], r.isActive);
      if (list[2]) tertiary = entryFromLegacy(list[2], r.isActive);
      editedByAdmin = r.editedByAdmin === true;
      requiredDataClass = r.requiredDataClass ?? 'public';
    }

    out.push({
      taskType,
      tenantId: null,
      ...(primary ? { primary } : {}),
      ...(secondary ? { secondary } : {}),
      ...(tertiary ? { tertiary } : {}),
      editedByAdmin,
      requiredDataClass,
      pinnedVersionNote,
    });
  }

  out.sort((a, b) => a.taskType.localeCompare(b.taskType));
  return out;
}

/* ─────────────────────────── KNOWN_MODELS для UI ─────────────────────────── */

export const KNOWN_MODELS: Record<string, string[]> = {
  deepseek: ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat'],
  'openai-via-proxy': ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano'],
  ollama: ['qwen3.5:9b', 'qwen3:30b'],
  anthropic: ['claude-opus-4-7', 'claude-sonnet-4-6'],
  minimax: ['MiniMax-M2.7'],
};

export function providerLabel(provider: string): string {
  switch (provider) {
    case 'deepseek':
      return 'DeepSeek';
    case 'openai-via-proxy':
      return 'OpenAI (через прокси)';
    case 'ollama':
      return 'Ollama (локально)';
    case 'anthropic':
      return 'Anthropic';
    case 'minimax':
      return 'MiniMax';
    default:
      return provider;
  }
}
