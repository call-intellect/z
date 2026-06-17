"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Inbox,
  Lightbulb,
  ListTodo,
  Plus,
  Search,
  Trash2,
  Video,
} from "lucide-react";

import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { Progress } from "@/ui/shadcn/progress";
import { Sheet, SheetContent, SheetTitle } from "@/ui/shadcn/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select";
import { Tabs, TabsList, TabsTrigger } from "@/ui/shadcn/tabs";
import { cn } from "@/ui/shadcn/lib/utils";

import { useAuth } from "@/contexts/auth-context";
import { useSprints } from "@/hooks/useSprints";
import { useTrackerWebSocket } from "@/hooks/tracker/useTrackerWebSocket";
import { SprintCreateWizard } from "@/ui/tracker/SprintCreateWizard";
import { SprintPreviewCard } from "@/ui/tracker/SprintPreviewCard";
import {
  formatSprintDateRange,
  getScopeKindLabel,
  getStatusLabel,
  type DomainSprintListItem,
} from "@/domain/sprint";
import type {
  SprintSortByApi,
  SprintSortDirApi,
  SprintStatusFilterApi,
} from "@/api/sprints.api";
import type { SprintScopeKindApi } from "@/domain/sprint";

interface FiltersState {
  status: SprintStatusFilterApi;
  scope: SprintScopeKindApi | null;
  q: string;
  sortBy: SprintSortByApi;
  sortDir: SprintSortDirApi;
  page: number;
  selected: string | null;
}

const DEFAULT_FILTERS: FiltersState = {
  status: "active",
  scope: null,
  q: "",
  sortBy: "startDate",
  sortDir: "desc",
  page: 1,
  selected: null,
};

function parseFilters(sp: URLSearchParams): FiltersState {
  const status = (sp.get("status") ?? DEFAULT_FILTERS.status) as
    | SprintStatusFilterApi
    | string;
  const scope = sp.get("scope") as SprintScopeKindApi | null;
  const sortBy = (sp.get("sort") ?? DEFAULT_FILTERS.sortBy) as SprintSortByApi;
  const sortDir = (sp.get("sortDir") ?? DEFAULT_FILTERS.sortDir) as
    | SprintSortDirApi
    | string;
  const pageNum = Number(sp.get("page") ?? "1");
  return {
    status: (["active", "completed", "upcoming", "all"] as const).includes(
      status as SprintStatusFilterApi,
    )
      ? (status as SprintStatusFilterApi)
      : DEFAULT_FILTERS.status,
    scope:
      scope &&
      (
        [
          "org",
          "customer",
          "vendor",
          "person",
          "department",
          "project",
        ] as const
      ).includes(scope)
        ? scope
        : null,
    q: sp.get("q") ?? "",
    sortBy: (["startDate", "progress", "hints"] as const).includes(sortBy)
      ? sortBy
      : DEFAULT_FILTERS.sortBy,
    sortDir: (["asc", "desc"] as const).includes(sortDir as SprintSortDirApi)
      ? (sortDir as SprintSortDirApi)
      : DEFAULT_FILTERS.sortDir,
    page: Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1,
    selected: sp.get("selected"),
  };
}

function buildSearch(filters: FiltersState): string {
  const p = new URLSearchParams();
  if (filters.status !== DEFAULT_FILTERS.status)
    p.set("status", filters.status);
  if (filters.scope) p.set("scope", filters.scope);
  if (filters.q) p.set("q", filters.q);
  if (filters.sortBy !== DEFAULT_FILTERS.sortBy) p.set("sort", filters.sortBy);
  if (filters.sortDir !== DEFAULT_FILTERS.sortDir)
    p.set("sortDir", filters.sortDir);
  if (filters.page !== 1) p.set("page", String(filters.page));
  if (filters.selected) p.set("selected", filters.selected);
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

const SCOPE_FILTER_CHIPS: Array<{
  value: SprintScopeKindApi;
  label: string;
}> = [
  { value: "org", label: "Компания" },
  { value: "department", label: "Отдел" },
  { value: "customer", label: "Клиент" },
  { value: "vendor", label: "Поставщик" },
  { value: "person", label: "Сотрудник" },
  { value: "project", label: "Проект" },
];

export function SprintsListClient() {
  const { currentOrgId, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [wizardOpen, setWizardOpen] = useState(false);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const filters = useMemo(
    () => parseFilters(new URLSearchParams(searchParams?.toString() ?? "")),
    [searchParams],
  );

  const [searchInput, setSearchInput] = useState(filters.q);
  useEffect(() => {
    setSearchInput(filters.q);
  }, [filters.q]);
  const debouncedSearch = useDebouncedValue(searchInput, 300);

  useEffect(() => {
    if (debouncedSearch === filters.q) return;
    const next: FiltersState = {
      ...filters,
      q: debouncedSearch,
      page: 1,
    };
    router.replace(`${pathname}${buildSearch(next)}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const updateFilters = useCallback(
    (patch: Partial<FiltersState>) => {
      const next: FiltersState = { ...filters, ...patch };
      router.replace(`${pathname}${buildSearch(next)}`, { scroll: false });
    },
    [filters, pathname, router],
  );

  const { sprints, total, totalPages, isLoading, mutate } = useSprints(
    currentOrgId,
    {
      status: filters.status,
      scopeKind: filters.scope ?? undefined,
      q: filters.q || undefined,
      sortBy: filters.sortBy,
      sortDir: filters.sortDir,
      page: filters.page,
      limit: 20,
    },
  );

  const { client: wsClient } = useTrackerWebSocket(currentOrgId, true);
  useEffect(() => {
    if (!wsClient) return;
    const unsubs: Array<() => void> = [];
    const refresh = () => {
      void mutate();
    };
    unsubs.push(wsClient.on("cycle.created", refresh));
    unsubs.push(wsClient.on("cycle.updated", refresh));
    unsubs.push(wsClient.on("cycle.progress_updated", refresh));
    unsubs.push(wsClient.on("cycle.completed", refresh));
    unsubs.push(wsClient.on("sprint_hint.created", refresh));
    unsubs.push(wsClient.on("sprint_hint.updated", refresh));
    unsubs.push(wsClient.on("sprint_hint.dismissed", refresh));
    unsubs.push(wsClient.on("sprint_hint.resolved", refresh));
    return () => {
      for (const u of unsubs) u();
    };
  }, [wsClient, mutate]);

  const selectedSprint = useMemo(() => {
    if (!filters.selected) return null;
    return sprints.find((s) => s.id === filters.selected) ?? null;
  }, [sprints, filters.selected]);

  useEffect(() => {
    if (filters.selected) return;
    if (sprints.length === 0) return;
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(min-width: 768px)").matches) return;
    updateFilters({ selected: sprints[0]?.id ?? null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprints]);

  const isEmpty = !isLoading && sprints.length === 0;

  return (
    <div className="flex h-full w-full flex-col">
      <SprintCreateWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
      />

      {}
      <div className="grid h-full w-full grid-cols-1 md:grid-cols-[420px,1fr]">
        {}
        <div className="flex h-full flex-col border-b border-border-subtle md:border-b-0 md:border-r">
          <ListHeader
            filters={filters}
            searchInput={searchInput}
            onSearchChange={setSearchInput}
            onFiltersChange={updateFilters}
            onCreateClick={() => setWizardOpen(true)}
            total={total}
          />

          {authLoading || !currentOrgId ? (
            <ListEmptyOrLoading
              loading={authLoading}
              noOrg={!authLoading && !currentOrgId}
            />
          ) : isEmpty ? (
            <EmptyState onCreateClick={() => setWizardOpen(true)} />
          ) : (
            <ListBody
              sprints={sprints}
              isLoading={isLoading}
              selectedId={filters.selected}
              onSelect={(id) => updateFilters({ selected: id })}
            />
          )}

          <ListFooter
            page={filters.page}
            totalPages={totalPages}
            total={total}
            onPageChange={(p) => updateFilters({ page: p })}
          />
        </div>

        {}
        <div className="hidden h-full md:block">
          {selectedSprint && currentOrgId ? (
            <SprintPreviewCard orgId={currentOrgId} sprint={selectedSprint} />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-fg-tertiary">
              Выберите спринт слева, чтобы открыть превью.
            </div>
          )}
        </div>
      </div>

      {}
      <Sheet
        open={isMobile && Boolean(selectedSprint)}
        onOpenChange={(o) => {
          if (!o) updateFilters({ selected: null });
        }}
      >
        <SheetContent side="right" className="w-full max-w-md p-0 md:hidden">
          <SheetTitle className="sr-only">Превью спринта</SheetTitle>
          {selectedSprint && currentOrgId ? (
            <SprintPreviewCard
              orgId={currentOrgId}
              sprint={selectedSprint}
              onClose={() => updateFilters({ selected: null })}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

interface ListHeaderProps {
  filters: FiltersState;
  searchInput: string;
  onSearchChange: (v: string) => void;
  onFiltersChange: (patch: Partial<FiltersState>) => void;
  onCreateClick: () => void;
  total: number;
}

function ListHeader({
  filters,
  searchInput,
  onSearchChange,
  onFiltersChange,
  onCreateClick,
  total,
}: ListHeaderProps) {
  return (
    <div className="flex flex-col gap-3 border-b border-border-subtle bg-bg-base p-4">
      {}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-fg-primary">Спринты</h1>
          <p className="text-xs text-fg-tertiary">
            Спринты команды — всего {total}
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={onCreateClick}>
          <Plus size={14} />
          Создать
        </Button>
      </div>

      {}
      <Tabs
        value={filters.status}
        onValueChange={(v) =>
          onFiltersChange({
            status: v as SprintStatusFilterApi,
            page: 1,
          })
        }
      >
        <TabsList className="w-full justify-start overflow-x-auto scrollbar-none">
          <TabsTrigger value="active">Активные</TabsTrigger>
          <TabsTrigger value="completed">Завершённые</TabsTrigger>
          <TabsTrigger value="upcoming">Предстоящие</TabsTrigger>
          <TabsTrigger value="all">Все</TabsTrigger>
        </TabsList>
      </Tabs>

      {}
      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-tertiary"
        />
        <Input
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Поиск по названию"
          className="pl-9"
          aria-label="Поиск по названию спринта"
        />
      </div>

      {}
      <div className="flex flex-wrap gap-1.5">
        {SCOPE_FILTER_CHIPS.map((chip) => {
          const isActive = filters.scope === chip.value;
          return (
            <button
              key={chip.value}
              type="button"
              aria-pressed={isActive}
              onClick={() =>
                onFiltersChange({
                  scope: isActive ? null : chip.value,
                  page: 1,
                })
              }
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                isActive
                  ? "border-accent bg-accent text-accent-fg"
                  : "border-border-subtle bg-bg-elevated text-fg-secondary hover:bg-bg-overlay",
              )}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {}
      <div className="flex items-center gap-2">
        <span className="text-xs text-fg-tertiary">Сортировка:</span>
        <Select
          value={filters.sortBy}
          onValueChange={(v) =>
            onFiltersChange({ sortBy: v as SprintSortByApi })
          }
        >
          <SelectTrigger className="h-8 w-auto px-2 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="startDate">По дате старта</SelectItem>
            <SelectItem value="progress">По прогрессу</SelectItem>
            <SelectItem value="hints">По подсказкам</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.sortDir}
          onValueChange={(v) =>
            onFiltersChange({ sortDir: v as SprintSortDirApi })
          }
        >
          <SelectTrigger className="h-8 w-auto px-2 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="desc">По убыванию</SelectItem>
            <SelectItem value="asc">По возрастанию</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function ListBody({
  sprints,
  isLoading,
  selectedId,
  onSelect,
}: {
  sprints: DomainSprintListItem[];
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <ul className="flex flex-col gap-1.5 p-2">
        {isLoading && sprints.length === 0
          ? Array.from({ length: 4 }, (_, i) => (
              <li
                key={`skeleton-${i}`}
                className="h-[88px] animate-pulse rounded-md border border-border-subtle bg-bg-elevated"
              />
            ))
          : sprints.map((s) => (
              <SprintCard
                key={s.id}
                sprint={s}
                isActive={s.id === selectedId}
                onClick={() => onSelect(s.id)}
              />
            ))}
      </ul>
    </div>
  );
}

function SprintCard({
  sprint,
  isActive,
  onClick,
}: {
  sprint: DomainSprintListItem;
  isActive: boolean;
  onClick: () => void;
}) {
  const percent = Math.round((sprint.progress.ratio || 0) * 100);

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={isActive}
        className={cn(
          "flex w-full flex-col gap-2 rounded-md border px-3 py-2.5 text-left transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          isActive
            ? "border-accent bg-bg-elevated"
            : "border-border-subtle bg-bg-base hover:bg-bg-elevated",
        )}
      >
        {}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-fg-tertiary">
              {sprint.projectIdentifier}
            </div>
            <div className="truncate text-sm font-medium text-fg-primary">
              {sprint.name}
            </div>
          </div>
          {sprint.status === "active" ? (
            <span
              aria-label="Активный спринт"
              className="mt-1 inline-block h-2 w-2 shrink-0 animate-pulse-mint rounded-full bg-accent"
            />
          ) : null}
        </div>

        {}
        <div className="flex flex-wrap items-center gap-1.5">
          <ScopeBadge sprint={sprint} />
          {sprint.scope.isDeleted ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-chip-danger-bg px-1.5 py-0.5 text-[10px] font-medium text-chip-danger-fg">
              <Trash2 size={10} /> удалён
            </span>
          ) : null}
          <span className="text-[11px] text-fg-tertiary">
            {formatSprintDateRange(sprint.startDate, sprint.endDate)}
          </span>
        </div>

        {}
        <div className="flex items-center gap-2">
          <Progress value={percent} className="h-1" />
          <span className="shrink-0 text-[11px] font-medium text-fg-tertiary">
            {sprint.progress.completed}/{sprint.progress.total}
          </span>
        </div>

        {}
        <div className="flex items-center gap-3 text-[11px] text-fg-tertiary">
          <span className="inline-flex items-center gap-1">
            <ListTodo size={11} />
            {sprint.progress.total}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1",
              sprint.criticalHintsCount > 0 && "text-chip-danger-fg",
            )}
          >
            <Lightbulb size={11} />
            {sprint.activeHintsCount}
          </span>
          <span className="inline-flex items-center gap-1">
            <Video size={11} />
            {sprint.linkedMeetingsCount}
          </span>
          <span className="ml-auto text-fg-tertiary">
            {getStatusLabel(sprint.status)}
          </span>
        </div>
      </button>
    </li>
  );
}

function ScopeBadge({ sprint }: { sprint: DomainSprintListItem }) {
  const kind = sprint.scope.kind;
  const label =
    sprint.scope.label ||
    (kind === "org" ? "Компания" : getScopeKindLabel(kind));
  const classes = (() => {
    switch (kind) {
      case "org":
        return "bg-chip-sand-bg text-chip-sand-fg";
      case "customer":
        return "bg-chip-success-bg text-chip-success-fg";
      case "vendor":
        return "bg-chip-lavender-bg text-chip-lavender-fg";
      case "person":
        return "bg-chip-warning-bg text-chip-warning-fg";
      case "department":
        return "bg-chip-info-bg text-chip-info-fg";
      case "project":
      default:
        return "bg-accent text-accent-fg";
    }
  })();
  return (
    <span
      className={cn(
        "inline-flex max-w-[180px] truncate rounded-md px-1.5 py-0.5 text-[10px] font-medium",
        classes,
      )}
      title={label}
    >
      {label}
    </span>
  );
}

function ListFooter({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (p: number) => void;
}) {
  if (total === 0) return null;
  const safeTotal = Math.max(totalPages, 1);
  return (
    <div className="flex items-center justify-between border-t border-border-subtle bg-bg-base px-3 py-2 text-xs text-fg-tertiary">
      <Button
        variant="ghost"
        size="sm"
        className="gap-1"
        disabled={page <= 1}
        onClick={() => onPageChange(Math.max(1, page - 1))}
        aria-label="Предыдущая страница"
      >
        <ChevronLeft size={12} /> Назад
      </Button>
      <span>
        Стр. {page} из {safeTotal} · всего {total}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1"
        disabled={page >= safeTotal}
        onClick={() => onPageChange(Math.min(safeTotal, page + 1))}
        aria-label="Следующая страница"
      >
        Вперёд <ChevronRight size={12} />
      </Button>
    </div>
  );
}

function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <Inbox size={28} className="text-fg-tertiary" />
      <div className="text-sm font-medium text-fg-primary">
        Спринтов пока нет
      </div>
      <p className="max-w-xs text-xs text-fg-tertiary">
        Создайте первый спринт — общий или с привязкой к клиенту, поставщику,
        отделу, сотруднику или проекту.
      </p>
      <Button size="sm" className="gap-1.5" onClick={onCreateClick}>
        <Plus size={14} />
        Создать спринт
      </Button>
      <Button asChild variant="ghost" size="sm">
        <Link href="/projects">К проектам</Link>
      </Button>
    </div>
  );
}

function ListEmptyOrLoading({
  loading,
  noOrg,
}: {
  loading: boolean;
  noOrg: boolean;
}) {
  if (loading) {
    return (
      <div className="flex-1 p-4">
        <div className="h-24 animate-pulse rounded-md border border-border-subtle bg-bg-elevated" />
      </div>
    );
  }
  if (noOrg) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-fg-tertiary">
        Сначала выберите организацию.
      </div>
    );
  }
  return null;
}
