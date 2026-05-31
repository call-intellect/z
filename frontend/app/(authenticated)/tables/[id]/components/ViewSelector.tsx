'use client';

import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Loader2,
  LayoutGrid,
  Plus,
  Save,
  SlidersHorizontal,
  Users,
  X as XIcon,
} from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

import { tableViewsApi } from '@/api/tables.api';
import { useAuth } from '@/contexts/auth-context';
import {
  tableViewFromApi,
  VIEW_VISIBILITY_LABEL_RU,
  type TableViewDomain,
} from '@/domain/table';
import { Button } from '@/ui/shadcn/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/shadcn/dropdown-menu';

import { useTableStore } from '../store/tableStore';
import { SaveViewDialog } from './SaveViewDialog';

/**
 * Селектор сохраняемых видов (Saved Views) — Фаза 3 smart-tables.
 *
 *   1. Загружает список доступных view'ов через SWR (`tableViewsApi.list`)
 *      и пробрасывает в store через `setViews`.
 *   2. Активный view определяется по `?view=<id>` в URL.
 *   3. При выборе из дропдауна обновляет URL через `router.push`.
 *   4. Кнопка «+ Новый вид» открывает `SaveViewDialog` (создаёт view из
 *      текущего draftConfig'а).
 *   5. Кнопка «Сохранить вид» появляется, если есть unsaved changes
 *      относительно applied view. «×» — удалить вид (доступно для своих).
 *
 * UI-копи: только русский (см. memory `feedback_admin_ui_russian_only`).
 */
export function ViewSelector({ tableId }: { tableId: string }) {
  const { currentOrgId, user } = useAuth();
  const currentUserId = user?.id ?? null;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const viewIdFromUrl = searchParams?.get('view') ?? null;

  const setViews = useTableStore((s) => s.setViews);
  const applyView = useTableStore((s) => s.applyView);
  const currentView = useTableStore((s) => s.currentView);
  const hasUnsavedChanges = useTableStore((s) => s.hasUnsavedChanges);
  const isMutating = useTableStore((s) => s.isMutating);
  const saveChangesToCurrentView = useTableStore(
    (s) => s.saveChangesToCurrentView,
  );
  const deleteView = useTableStore((s) => s.deleteView);
  const viewsInStore = useTableStore((s) => s.views);
  const allProperties = useTableStore((s) => s.properties);
  const draftConfig = useTableStore((s) => s.draftConfig);
  const setHiddenProperty = useTableStore((s) => s.setHiddenProperty);
  const setRowHeight = useTableStore((s) => s.setRowHeight);
  const hiddenSet = new Set(draftConfig.hiddenProps ?? []);
  const currentRowHeight = draftConfig.rowHeight ?? 'default';

  const viewsSwr = useSWR(
    currentOrgId ? ['table-views', currentOrgId, tableId] : null,
    () =>
      currentOrgId
        ? tableViewsApi.list(currentOrgId, tableId)
        : Promise.resolve({ items: [] }),
    { revalidateOnFocus: false },
  );

  // Кладём views в store при изменении SWR-ответа.
  useEffect(() => {
    if (!viewsSwr.data) return;
    const list: TableViewDomain[] = viewsSwr.data.items.map(tableViewFromApi);
    setViews(list);
  }, [viewsSwr.data, setViews]);

  // Применяем view из URL, как только store узнал про список.
  useEffect(() => {
    applyView(viewIdFromUrl);
  }, [viewIdFromUrl, viewsInStore.length, applyView]);

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);

  const activeLabel = useMemo(() => {
    if (currentView) return currentView.name;
    return 'Все колонки';
  }, [currentView]);

  function navigateToView(viewId: string | null) {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (viewId) params.set('view', viewId);
    else params.delete('view');
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const isOwner =
    currentView && currentUserId && currentView.ownerId === currentUserId;

  async function onDeleteCurrent() {
    if (!currentView) return;
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`Удалить вид «${currentView.name}»?`)
    ) {
      return;
    }
    await deleteView(currentView.id);
    navigateToView(null);
    void viewsSwr.mutate();
  }

  async function onSaveChanges() {
    const out = await saveChangesToCurrentView();
    if (out) void viewsSwr.mutate();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Выбрать вид"
            className="gap-2"
          >
            <LayoutGrid className="h-4 w-4" aria-hidden />
            <span className="max-w-[12rem] truncate">{activeLabel}</span>
            <ChevronDown className="h-4 w-4 opacity-60" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[18rem]">
          <DropdownMenuLabel>Виды</DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={() => navigateToView(null)}
            className="flex items-center gap-2"
          >
            <span className="flex h-4 w-4 items-center justify-center">
              {currentView === null ? (
                <Check className="h-4 w-4" aria-hidden />
              ) : null}
            </span>
            <span className="flex-1">Все колонки</span>
            <span className="text-xs text-fg-tertiary">по умолчанию</span>
          </DropdownMenuItem>

          {viewsInStore.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              {viewsInStore.map((v) => (
                <DropdownMenuItem
                  key={v.id}
                  onSelect={() => navigateToView(v.id)}
                  className="flex items-center gap-2"
                >
                  <span className="flex h-4 w-4 items-center justify-center">
                    {currentView?.id === v.id ? (
                      <Check className="h-4 w-4" aria-hidden />
                    ) : null}
                  </span>
                  <span className="flex-1 truncate">{v.name}</span>
                  <span
                    className="inline-flex items-center gap-1 rounded-sm bg-bg-overlay px-1.5 py-0.5 text-xs text-fg-tertiary"
                    title={VIEW_VISIBILITY_LABEL_RU[v.visibility]}
                  >
                    {v.visibility === 'personal' ? (
                      <Eye className="h-3 w-3" aria-hidden />
                    ) : (
                      <Users className="h-3 w-3" aria-hidden />
                    )}
                    {VIEW_VISIBILITY_LABEL_RU[v.visibility]}
                  </span>
                </DropdownMenuItem>
              ))}
            </>
          ) : null}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setSaveDialogOpen(true)}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" aria-hidden />
            <span>Новый вид</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Настроить колонки и плотность"
            className="gap-2"
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
            Колонки
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[18rem]">
          <DropdownMenuLabel>Видимость колонок</DropdownMenuLabel>
          {allProperties.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-fg-tertiary">
              Колонок пока нет
            </div>
          ) : (
            allProperties.map((p) => {
              const isHidden = hiddenSet.has(p.id);
              return (
                <DropdownMenuItem
                  key={p.id}
                  onSelect={(e) => {
                    e.preventDefault();
                    setHiddenProperty(p.id, !isHidden);
                  }}
                  className="flex items-center gap-2"
                >
                  <span className="flex h-4 w-4 items-center justify-center">
                    {isHidden ? (
                      <EyeOff className="h-4 w-4 text-fg-tertiary" aria-hidden />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden />
                    )}
                  </span>
                  <span
                    className={
                      isHidden
                        ? 'flex-1 truncate text-fg-tertiary line-through'
                        : 'flex-1 truncate'
                    }
                  >
                    {p.name}
                  </span>
                </DropdownMenuItem>
              );
            })
          )}

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Плотность строк</DropdownMenuLabel>
          {(['compact', 'default', 'tall'] as const).map((rh) => (
            <DropdownMenuItem
              key={rh}
              onSelect={(e) => {
                e.preventDefault();
                setRowHeight(rh);
              }}
              className="flex items-center gap-2"
            >
              <span className="flex h-4 w-4 items-center justify-center">
                {currentRowHeight === rh ? (
                  <Check className="h-4 w-4" aria-hidden />
                ) : null}
              </span>
              <span className="flex-1">
                {rh === 'compact'
                  ? 'Компактная'
                  : rh === 'tall'
                    ? 'Просторная'
                    : 'Обычная'}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {hasUnsavedChanges ? (
        <span
          className="inline-flex items-center gap-1.5 rounded-sm bg-warning/15 px-2 py-1 text-xs text-warning"
          aria-live="polite"
        >
          <span
            className="h-1.5 w-1.5 rounded-full bg-warning"
            aria-hidden
          />
          Изменения не сохранены
        </span>
      ) : null}

      {currentView && hasUnsavedChanges && isOwner ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void onSaveChanges()}
          disabled={isMutating}
          aria-label="Сохранить вид"
          className="gap-2"
        >
          {isMutating ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Save className="h-4 w-4" aria-hidden />
          )}
          Сохранить вид
        </Button>
      ) : null}

      {hasUnsavedChanges && !currentView ? (
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
      ) : null}

      {currentView && isOwner ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void onDeleteCurrent()}
          disabled={isMutating}
          aria-label={`Удалить вид «${currentView.name}»`}
          title="Удалить вид"
        >
          <XIcon className="h-4 w-4" aria-hidden />
        </Button>
      ) : null}

      <SaveViewDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        onSaved={(view) => {
          // После создания — переходим на новый view и обновляем SWR.
          navigateToView(view.id);
          void viewsSwr.mutate();
        }}
      />
    </div>
  );
}
