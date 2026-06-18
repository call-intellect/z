"use client";

/**
 * TasksWorkspaceClient — единый рабочий стол «Задачи» (Фаза 5 ТЗ
 * tasks-unified-workspace). Заменяет старый список проектов: проект здесь —
 * это фильтр, а не отдельный экран.
 *
 * Виды: Доска / Список / Спринты / Входящие / Архив. Селектор проекта («Все
 * проекты» + список), фильтр команды и фильтр спринта, поиск, создание задачи,
 * «Открыть проект →». Вкладка «Входящие» видна только руководителю (RBAC
 * intake = owner/admin/coo); фильтр спринта (?cycle) сужает доску/список.
 *
 * Весь стейт живёт в URL (?view / ?project / ?assignee / ?q), чтобы экран
 * можно было расшарить ссылкой и не терять контекст при перезагрузке.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { ArrowRight, Plus, Search, X } from "lucide-react";

import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { useAuth } from "@/contexts/auth-context";
import { useProjects } from "@/hooks/tracker/useProjects";
import { useOrgIssues } from "@/hooks/tracker/useOrgIssues";
import { useIssues } from "@/hooks/tracker/useIssues";
import { useSprints } from "@/hooks/useSprints";
import { getStatusLabel, type DomainSprintListItem } from "@/domain/sprint";
import { issuesApi, type ListOrgIssuesRequest } from "@/api/tracker/issues.api";
import {
  orgMembersApi,
  type OrgMemberUserApi,
} from "@/api/org-members.api";
import { projectShortLabel } from "@/domain/tracker";
import { LEADERSHIP_ROLES } from "@/ui/components/app-shell/nav-config";
import { OrgBoard, orgBoardColumnFor } from "@/ui/tracker/OrgBoard";
import { Board } from "@/ui/tracker/Board";
import { IssueList } from "@/ui/tracker/IssueList";
import { IntakeBoard } from "@/ui/tracker/IntakeBoard";
import { ProjectPickerDialog } from "@/ui/tracker/ProjectPickerDialog";
import { QuickAdd } from "@/ui/tracker/QuickAdd";
import { cn } from "@/ui/shadcn/lib/utils";

type WorkspaceView = "board" | "list" | "archive" | "sprints" | "inbox";

function parseView(raw: string | null): WorkspaceView {
  return raw === "list" ||
    raw === "archive" ||
    raw === "sprints" ||
    raw === "inbox"
    ? raw
    : "board";
}

export function TasksWorkspaceClient() {
  const { currentOrgId, currentOrgRole, isSuperAdmin, isLoading: authLoading } =
    useAuth();
  const isLeadership =
    isSuperAdmin ||
    (!!currentOrgRole && LEADERSHIP_ROLES.includes(currentOrgRole));

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const rawView = parseView(searchParams.get("view"));
  // Гард: «Входящие» доступны только руководителю. Если рядовой вручную поставил
  // ?view=inbox — не падаем, показываем доску.
  const view: WorkspaceView =
    rawView === "inbox" && !isLeadership ? "board" : rawView;
  const selectedSlug = searchParams.get("project");
  const assigneeUserId = searchParams.get("assignee") ?? undefined;
  const cycleId = searchParams.get("cycle") ?? undefined;
  const qParam = searchParams.get("q") ?? "";

  // Вкладки: базовые всем, «Входящие» — только руководителю.
  const tabs = useMemo<ReadonlyArray<{ value: WorkspaceView; label: string }>>(
    () => [
      { value: "board", label: "Доска" },
      { value: "list", label: "Список" },
      { value: "sprints", label: "Спринты" },
      ...(isLeadership
        ? [{ value: "inbox" as const, label: "Входящие" }]
        : []),
      { value: "archive", label: "Архив" },
    ],
    [isLeadership],
  );

  /** Патч одного query-параметра без потери остальных. */
  const setParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  // ─── Поиск (debounce ~300мс перед записью в URL) ───────────────────────────
  const [qInput, setQInput] = useState(qParam);
  // Синхронизируем локальный инпут, если URL поменяли извне (назад/вперёд).
  useEffect(() => {
    setQInput(qParam);
  }, [qParam]);
  const debouncedQ = useDebounced(qInput, 300);
  useEffect(() => {
    if (debouncedQ !== qParam) setParam("q", debouncedQ || null);
    // setParam стабилен по зависимостям searchParams; qParam — текущее значение URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  // ─── Проекты / выбранный проект ────────────────────────────────────────────
  const { projects } = useProjects(currentOrgId);
  const selectedProject = useMemo(
    () =>
      selectedSlug && selectedSlug !== "all"
        ? (projects.find((p) => p.slug === selectedSlug) ?? null)
        : null,
    [projects, selectedSlug],
  );
  const selectedProjectId = selectedProject?.id;

  // ─── Фильтры сквозного списка ──────────────────────────────────────────────
  const orgReq: ListOrgIssuesRequest = useMemo(
    () => ({
      projectId: selectedProjectId,
      assigneeUserId: isLeadership ? assigneeUserId : undefined,
      cycleId,
      q: debouncedQ || undefined,
      includeArchived: view === "archive" ? true : undefined,
      limit: 200,
    }),
    [selectedProjectId, isLeadership, assigneeUserId, cycleId, debouncedQ, view],
  );

  // Хуки данных зовём всегда (правило хуков). Сквозной список используется в
  // режиме «Все проекты» (board/list) и всегда в archive. Список одного проекта
  // фетчится только когда проект выбран и вид не archive.
  const orgIssuesAll = useOrgIssues(currentOrgId, orgReq);

  // ─── Сводка в заголовке ────────────────────────────────────────────────────
  const headerTotal = orgIssuesAll.total || orgIssuesAll.issues.length;
  const headerOverdue = orgIssuesAll.issues.filter((i) => i.isOverdue).length;

  // ─── Диалог выбора проекта (для «+ Новая задача» в режиме «Все проекты») ───
  const [pickerOpen, setPickerOpen] = useState(false);
  const handlePickProject = useCallback(
    (projectId: string) => {
      const p = projects.find((pr) => pr.id === projectId);
      setPickerOpen(false);
      if (p) setParam("project", p.slug);
    },
    [projects, setParam],
  );

  const handleQuickAdd = useCallback(
    async (title: string) => {
      if (!currentOrgId || !selectedProjectId) return;
      await issuesApi.create(currentOrgId, selectedProjectId, { title });
      await orgIssuesAll.mutate();
    },
    [currentOrgId, selectedProjectId, orgIssuesAll],
  );

  // ─── Состояния загрузки/без организации ────────────────────────────────────
  if (authLoading || !currentOrgId) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        {authLoading ? (
          <div className="flex flex-col gap-2">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-md border border-border-subtle bg-bg-elevated"
              />
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border-subtle bg-bg-elevated px-4 py-10 text-center text-sm text-fg-tertiary">
            Сначала выберите организацию.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
      {/* ─── Заголовок + сводка ───────────────────────────────────────────── */}
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-fg-primary md:text-2xl">
          Задачи
        </h1>
        <p className="text-sm text-fg-tertiary">
          {headerTotal} {pluralTasks(headerTotal)}
          {headerOverdue > 0 && (
            <>
              {" · "}
              <span className="text-danger">{headerOverdue} просрочено</span>
            </>
          )}
        </p>
      </header>

      {/* ─── Вкладки видов ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-border-subtle">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setParam("view", tab.value === "board" ? null : tab.value)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              view === tab.value
                ? "border-accent text-fg-primary"
                : "border-transparent text-fg-tertiary hover:text-fg-secondary",
            )}
            aria-current={view === tab.value ? "page" : undefined}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─── Панель фильтров ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <ProjectSelect
          projects={projects}
          selectedSlug={selectedProject?.slug ?? null}
          onSelect={(slug) => setParam("project", slug)}
        />

        {isLeadership && (
          <AssigneeFilter
            assigneeUserId={assigneeUserId ?? null}
            onSelect={(userId) => setParam("assignee", userId)}
          />
        )}

        {isLeadership && (
          <Link
            href="/settings/organization"
            className="text-xs text-fg-tertiary underline-offset-2 hover:text-fg-secondary hover:underline"
            title="Видят ли рядовые сотрудники все задачи компании или только свои — настраивается в режиме видимости организации"
          >
            Кто видит задачи
          </Link>
        )}

        {(view === "board" || view === "list") && (
          <SprintFilter
            orgId={currentOrgId}
            selectedCycleId={cycleId ?? null}
            projectId={selectedProjectId}
            onSelect={(id) => setParam("cycle", id)}
          />
        )}

        <div className="relative min-w-[12rem] flex-1">
          <Search
            size={14}
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-tertiary"
          />
          <Input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Поиск задач…"
            className="pl-8"
          />
        </div>

        {selectedProject && (
          <Button asChild variant="ghost" size="sm" className="gap-1">
            <Link href={`/projects/${encodeURIComponent(selectedProject.slug)}/overview`}>
              Открыть проект
              <ArrowRight size={14} />
            </Link>
          </Button>
        )}

        {/* «+ Новая задача» */}
        {selectedProjectId ? (
          <div className="min-w-[14rem]">
            <QuickAdd
              onSubmit={handleQuickAdd}
              buttonLabel="Новая задача"
              placeholder="Что нужно сделать?"
            />
          </div>
        ) : (
          <Button
            size="sm"
            className="gap-2"
            onClick={() => setPickerOpen(true)}
          >
            <Plus size={14} />
            Новая задача
          </Button>
        )}
      </div>

      {/* ─── Контент вида ─────────────────────────────────────────────────── */}
      {view === "board" ? (
        selectedProjectId ? (
          <Board orgId={currentOrgId} projectId={selectedProjectId} />
        ) : (
          <OrgBoard orgId={currentOrgId} req={orgReq} />
        )
      ) : view === "list" ? (
        selectedProjectId ? (
          <ProjectListView orgId={currentOrgId} projectId={selectedProjectId} />
        ) : (
          <IssueList
            issues={orgIssuesAll.issues}
            group
            resolveCategory={orgBoardColumnFor}
            emptyText="Задач нет"
          />
        )
      ) : view === "sprints" ? (
        <SprintsView orgId={currentOrgId} projectId={selectedProjectId} />
      ) : view === "inbox" ? (
        <IntakeBoard orgId={currentOrgId} projectId={selectedProjectId} />
      ) : (
        // archive: includeArchived=true отдаёт активные+архивные → на клиенте
        // оставляем только архивные.
        <IssueList
          issues={orgIssuesAll.issues.filter((i) => i.isArchived)}
          group
          resolveCategory={orgBoardColumnFor}
          emptyText="Архив пуст"
        />
      )}

      {/* «Все проекты» + «+ Новая задача» → диалог выбора проекта. */}
      <ProjectPickerDialog
        orgId={currentOrgId}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={handlePickProject}
        title="В какой проект добавить задачу?"
        description="Выберите проект — после этого создайте задачу в нём."
      />
    </div>
  );
}

// ─── Список одного проекта (хук useIssues живёт внутри, чтобы не нарушать
//     правило хуков на верхнем уровне) ──────────────────────────────────────
function ProjectListView({
  orgId,
  projectId,
}: {
  orgId: string;
  projectId: string;
}) {
  const { issues, isLoading } = useIssues(orgId, projectId, { limit: 200 });
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-md border border-border-subtle bg-bg-elevated"
          />
        ))}
      </div>
    );
  }
  return (
    <IssueList issues={issues} group emptyText="В проекте пока нет задач" />
  );
}

// ─── Фильтр спринта (хук useSprints внутри, чтобы не фетчить и не нарушать
//     правило хуков на верхнем уровне родителя) ──────────────────────────────
function SprintFilter({
  orgId,
  selectedCycleId,
  projectId,
  onSelect,
}: {
  orgId: string;
  selectedCycleId: string | null;
  projectId?: string;
  onSelect: (cycleId: string | null) => void;
}) {
  const { sprints } = useSprints(orgId, { status: "active", limit: 50 });
  const options = useMemo(
    () =>
      projectId
        ? sprints.filter((s) => s.projectId === projectId)
        : sprints,
    [sprints, projectId],
  );

  // Активных спринтов нет — нечего фильтровать, не рендерим селект.
  if (options.length === 0) return null;

  return (
    <select
      value={selectedCycleId ?? "all"}
      onChange={(e) => {
        const v = e.target.value;
        onSelect(v === "all" ? null : v || null);
      }}
      className={cn(
        "h-9 min-w-[12rem] rounded-md border border-border bg-bg-card px-3 text-sm text-fg-primary",
        "focus:outline-none focus:ring-2 focus:ring-accent",
      )}
      aria-label="Спринт"
    >
      <option value="all">Все спринты</option>
      {options.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

// ─── Вид «Спринты» (хук useSprints внутри) ──────────────────────────────────
function SprintsView({
  orgId,
  projectId,
}: {
  orgId: string;
  projectId?: string;
}) {
  const { sprints, isLoading } = useSprints(orgId, { limit: 100 });
  const items = useMemo(
    () =>
      projectId
        ? sprints.filter((s) => s.projectId === projectId)
        : sprints,
    [sprints, projectId],
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-md border border-border-subtle bg-bg-elevated"
          />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border-subtle bg-bg-elevated px-4 py-10 text-center text-sm text-fg-tertiary">
        Спринтов нет
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((s) => (
        <SprintRow key={s.id} sprint={s} />
      ))}
    </div>
  );
}

function SprintRow({ sprint }: { sprint: DomainSprintListItem }) {
  const percent = Math.round((sprint.progress.ratio || 0) * 100);
  return (
    <Link
      href={`/sprints/${encodeURIComponent(sprint.id)}`}
      className="flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-elevated p-3 transition-colors hover:bg-bg-overlay md:flex-row md:items-center md:justify-between"
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-fg-primary">
          {sprint.name}
        </div>
        <div className="text-xs text-fg-tertiary">{sprint.projectName}</div>
      </div>
      <div className="flex items-center gap-3 text-xs text-fg-tertiary">
        <span className="rounded-md bg-bg-card px-2 py-0.5 font-medium text-fg-secondary">
          {getStatusLabel(sprint.status)}
        </span>
        <span className="shrink-0 font-medium">
          {sprint.progress.completed}/{sprint.progress.total} · {percent}%
        </span>
      </div>
    </Link>
  );
}

// ─── Селектор проекта ────────────────────────────────────────────────────────
function ProjectSelect({
  projects,
  selectedSlug,
  onSelect,
}: {
  projects: ReturnType<typeof useProjects>["projects"];
  selectedSlug: string | null;
  onSelect: (slug: string | null) => void;
}) {
  return (
    <select
      value={selectedSlug ?? "all"}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "all") onSelect(null);
        else if (v === "__new__") {
          // Навигация на /projects/new — обрабатываем через Link-эмуляцию:
          // нативный select не умеет ссылок, поэтому редиректим программно.
          window.location.assign("/projects/new");
        } else onSelect(v);
      }}
      className={cn(
        "h-9 min-w-[12rem] rounded-md border border-border bg-bg-card px-3 text-sm text-fg-primary",
        "focus:outline-none focus:ring-2 focus:ring-accent",
      )}
      aria-label="Проект"
    >
      <option value="all">Все проекты</option>
      {projects.map((p) => (
        <option key={p.id} value={p.slug}>
          {projectShortLabel(p)}
        </option>
      ))}
      <option value="__new__">+ Новый проект</option>
    </select>
  );
}

// ─── Фильтр команды (только руководителю) ────────────────────────────────────
function AssigneeFilter({
  assigneeUserId,
  onSelect,
}: {
  assigneeUserId: string | null;
  onSelect: (userId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query, 300);
  const [results, setResults] = useState<OrgMemberUserApi[]>([]);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Поиск людей (только type === "user").
  useEffect(() => {
    if (!open) return;
    const q = debouncedQuery.trim();
    if (q.length === 0) {
      setResults([]);
      return;
    }
    let cancelled = false;
    void orgMembersApi
      .search(q, 10)
      .then((res) => {
        if (cancelled) return;
        setResults(
          res.items.filter(
            (it): it is OrgMemberUserApi => it.type === "user",
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, open]);

  // Закрытие по клику вне.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const handlePick = (user: OrgMemberUserApi) => {
    setSelectedLabel(user.name);
    onSelect(user.userId);
    setOpen(false);
    setQuery("");
  };

  const handleReset = () => {
    setSelectedLabel(null);
    onSelect(null);
    setQuery("");
  };

  const buttonLabel =
    assigneeUserId && selectedLabel ? selectedLabel : "Вся команда";

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={() => setOpen((v) => !v)}
        >
          {buttonLabel}
        </Button>
        {assigneeUserId && (
          <button
            type="button"
            onClick={handleReset}
            className="grid h-7 w-7 place-items-center rounded-md text-fg-tertiary hover:bg-bg-overlay hover:text-fg-secondary"
            aria-label="Сбросить фильтр команды"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-md border border-border bg-bg-card p-2 shadow-modal">
          <div className="relative">
            <Search
              size={14}
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-tertiary"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Имя сотрудника…"
              className="pl-8"
              autoFocus
            />
          </div>
          <div className="mt-2 max-h-60 overflow-y-auto">
            <button
              type="button"
              onClick={handleReset}
              className="flex w-full items-center px-2 py-1.5 text-left text-sm text-fg-secondary hover:bg-bg-overlay"
            >
              Вся команда
            </button>
            {results.map((user) => (
              <button
                key={user.userId}
                type="button"
                onClick={() => handlePick(user)}
                className="flex w-full flex-col items-start px-2 py-1.5 text-left hover:bg-bg-overlay"
              >
                <span className="text-sm text-fg-primary">{user.name}</span>
                <span className="text-[11px] text-fg-tertiary">
                  {user.email}
                </span>
              </button>
            ))}
            {debouncedQuery.trim().length > 0 && results.length === 0 && (
              <div className="px-2 py-3 text-center text-sm text-fg-tertiary">
                Никого не нашли.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Хелперы ──────────────────────────────────────────────────────────────
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/** Склонение слова «задача» для строки-сводки. */
function pluralTasks(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "задача";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "задачи";
  return "задач";
}
