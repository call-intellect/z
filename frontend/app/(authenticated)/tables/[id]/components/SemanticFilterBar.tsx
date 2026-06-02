'use client';

import { Loader2, Save, Search, X as XIcon } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { tableViewsApi } from '@/api/tables.api';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';

import { useTableStore } from '../store/tableStore';
import { SaveViewDialog } from './SaveViewDialog';

/**
 * Строка «Найти срез» — NL Saved Views (Smart-tables Фаза 5).
 *
 * Пользователь пишет запрос на естественном языке («клиенты, кому месяц никто
 * не писал»), фронт зовёт `tableViewsApi.semanticFilter`, получает JSON-фильтр
 * (уже валидированный backend'ом против схемы) и применяет его к строкам
 * клиент-сайд через `setDraftFilters`. Грид перерисуется через
 * `selectVisibleRows`.
 *
 * Дальше пользователь может сохранить срез как новый вид (переиспользуем
 * `SaveViewDialog` — конфиг с фильтрами уже лежит в `draftConfig`).
 *
 * Копи — только русский (см. memory `feedback_admin_ui_russian_only`).
 */
export function SemanticFilterBar({ tableId }: { tableId: string }) {
  const { currentOrgId } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setDraftFilters = useTableStore((s) => s.setDraftFilters);
  const clearDraftFilters = useTableStore((s) => s.clearDraftFilters);
  const draftFilters = useTableStore((s) => s.draftConfig.filters);
  const activeCount = draftFilters?.length ?? 0;

  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);

  async function onApply() {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      toast.error('Введите запрос подлиннее — минимум 2 символа');
      return;
    }
    if (!currentOrgId) return;
    setBusy(true);
    try {
      const res = await tableViewsApi.semanticFilter(
        currentOrgId,
        tableId,
        trimmed,
      );
      if (res.filters.length === 0) {
        toast.error('Не удалось распознать фильтр, переформулируйте запрос');
        return;
      }
      setDraftFilters(res.filters);
      toast.success(
        res.cached
          ? `Фильтр применён (из кэша): условий — ${res.filters.length}`
          : `Фильтр применён: условий — ${res.filters.length}`,
      );
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'Не удалось применить фильтр',
      );
    } finally {
      setBusy(false);
    }
  }

  function onReset() {
    clearDraftFilters();
    setQuery('');
  }

  function navigateToView(viewId: string | null) {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (viewId) params.set('view', viewId);
    else params.delete('view');
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1 sm:max-w-md">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-tertiary"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) {
              e.preventDefault();
              void onApply();
            }
          }}
          placeholder="Найти срез: например, клиенты без активности месяц"
          aria-label="Найти срез на естественном языке"
          disabled={busy}
          className="pl-8"
        />
      </div>

      <Button
        size="sm"
        variant="secondary"
        onClick={() => void onApply()}
        disabled={busy || query.trim().length < 2}
        className="gap-2"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Search className="h-4 w-4" aria-hidden />
        )}
        Применить
      </Button>

      {activeCount > 0 ? (
        <>
          <span
            className="inline-flex items-center gap-1.5 rounded-sm bg-accent-muted px-2 py-1 text-xs text-accent"
            aria-live="polite"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            Фильтр активен: условий — {activeCount}
          </span>

          <Button
            size="sm"
            variant="ghost"
            onClick={onReset}
            aria-label="Сбросить фильтр"
            className="gap-1.5"
          >
            <XIcon className="h-4 w-4" aria-hidden />
            Сбросить
          </Button>

          <Button
            size="sm"
            variant="secondary"
            onClick={() => setSaveDialogOpen(true)}
            aria-label="Сохранить как новый вид"
            className="gap-2"
          >
            <Save className="h-4 w-4" aria-hidden />
            Сохранить как новый вид
          </Button>
        </>
      ) : null}

      <SaveViewDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        onSaved={(view) => {
          // После создания вида — переходим на него по URL (ViewSelector
          // подхватит `?view=` и применит config с фильтрами).
          navigateToView(view.id);
        }}
      />
    </div>
  );
}
