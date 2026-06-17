"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Search,
} from "lucide-react";

import { ApiError } from "@/api/api-error";
import { projectsApi } from "@/api/tracker/projects.api";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "sonner";
import {
  useTeamTemplate,
  useTeamTemplates,
} from "@/hooks/tracker/useTeamTemplates";
import {
  teamTemplateCategoryLabel,
  teamTemplateEmoji,
  type TeamTemplateListItem,
} from "@/domain/tracker";
import { Button } from "@/ui/shadcn/button";
import { Checkbox } from "@/ui/shadcn/checkbox";
import { Input } from "@/ui/shadcn/input";
import { Label } from "@/ui/shadcn/label";

type WizardStep = 1 | 2 | 3;

const DEFAULT_TIMEZONE = "Europe/Moscow";

const TIMEZONES = [
  "Europe/Kaliningrad",
  "Europe/Moscow",
  "Europe/Samara",
  "Asia/Yekaterinburg",
  "Asia/Omsk",
  "Asia/Krasnoyarsk",
  "Asia/Irkutsk",
  "Asia/Yakutsk",
  "Asia/Vladivostok",
  "Asia/Magadan",
  "Asia/Kamchatka",
];

export function FromTemplateWizard() {
  const router = useRouter();
  const { currentOrgId } = useAuth();
  const { mutate: globalMutate } = useSWRConfig();

  const {
    templates,
    isLoading: listLoading,
    error: listError,
  } = useTeamTemplates(currentOrgId);

  const [step, setStep] = useState<WizardStep>(1);
  const [search, setSearch] = useState("");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const [projectName, setProjectName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [withExampleTasks, setWithExampleTasks] = useState(false);
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const filteredTemplates = useMemo<TeamTemplateListItem[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q),
    );
  }, [templates, search]);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.slug === selectedSlug) ?? null,
    [templates, selectedSlug],
  );

  const { template: selectedDetail, isLoading: detailLoading } =
    useTeamTemplate(currentOrgId, selectedSlug);

  const canGoStep2 = selectedSlug !== null;
  const canGoStep3 =
    projectName.trim().length > 0 &&
    /^[A-Z][A-Z0-9]{1,4}$/u.test(identifier.trim());

  const handlePickTemplate = (slug: string) => {
    setSelectedSlug(slug);
    const t = templates.find((x) => x.slug === slug);
    if (t && !projectName) setProjectName(t.name);
    if (!identifier) setIdentifier(buildDefaultIdentifier(slug));
  };

  const handleSubmit = async () => {
    if (!currentOrgId || !selectedSlug) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await projectsApi.createFromTemplate(currentOrgId, {
        templateSlug: selectedSlug,
        projectName: projectName.trim(),
        identifier: identifier.trim().toUpperCase(),
        withExampleTasks,
        timezone,
      });
      void globalMutate(
        (key: unknown) =>
          Array.isArray(key) &&
          typeof key[0] === "string" &&
          key[0] === "tracker.projects",
        undefined,
        { revalidate: true },
      );
      toast.success("Проект создан");
      router.push(`/projects/${encodeURIComponent(res.slug)}/board`);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Не удалось создать проект";
      setSubmitError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <StepIndicator step={step} />

      {step === 1 && (
        <Step1
          search={search}
          onSearch={setSearch}
          loading={listLoading}
          error={listError}
          templates={filteredTemplates}
          selectedSlug={selectedSlug}
          onPick={handlePickTemplate}
        />
      )}

      {step === 2 && selectedTemplate && (
        <Step2
          template={selectedTemplate}
          projectName={projectName}
          onProjectName={setProjectName}
          identifier={identifier}
          onIdentifier={setIdentifier}
          withExampleTasks={withExampleTasks}
          onWithExampleTasks={setWithExampleTasks}
          timezone={timezone}
          onTimezone={setTimezone}
        />
      )}

      {step === 3 && selectedTemplate && (
        <Step3
          template={selectedTemplate}
          detailLoading={detailLoading}
          definition={selectedDetail?.definition ?? null}
          projectName={projectName}
          identifier={identifier.toUpperCase()}
          timezone={timezone}
          withExampleTasks={withExampleTasks}
        />
      )}

      {submitError && (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {submitError}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() =>
            step === 1 ? router.back() : setStep((step - 1) as WizardStep)
          }
          disabled={submitting}
          className="gap-2"
        >
          <ArrowLeft size={14} />
          {step === 1 ? "Отмена" : "Назад"}
        </Button>

        {step < 3 && (
          <Button
            type="button"
            onClick={() => setStep((step + 1) as WizardStep)}
            disabled={
              submitting ||
              (step === 1 && !canGoStep2) ||
              (step === 2 && !canGoStep3)
            }
            className="gap-2"
          >
            Далее
            <ArrowRight size={14} />
          </Button>
        )}

        {step === 3 && (
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="gap-2"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            <CheckCircle2 size={14} />
            Создать проект
          </Button>
        )}
      </div>
    </div>
  );
}

function buildDefaultIdentifier(slug: string): string {
  const base = slug.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return base.slice(0, Math.min(4, Math.max(3, base.length)));
}

function StepIndicator({ step }: { step: WizardStep }) {
  const items: Array<{ n: WizardStep; label: string }> = [
    { n: 1, label: "Шаблон" },
    { n: 2, label: "Параметры" },
    { n: 3, label: "Проверка" },
  ];
  return (
    <ol className="flex items-center gap-2 text-xs">
      {items.map((item, idx) => {
        const active = step === item.n;
        const done = step > item.n;
        return (
          <li key={item.n} className="flex items-center gap-2">
            <span
              className={`grid h-6 w-6 place-items-center rounded-full border text-[11px] font-semibold ${
                active
                  ? "border-accent bg-accent text-accent-fg"
                  : done
                    ? "border-success bg-success/15 text-success"
                    : "border-border-subtle bg-bg-elevated text-fg-tertiary"
              }`}
            >
              {done ? <CheckCircle2 size={12} /> : item.n}
            </span>
            <span
              className={
                active
                  ? "font-medium text-fg-primary"
                  : done
                    ? "text-fg-secondary"
                    : "text-fg-tertiary"
              }
            >
              {item.label}
            </span>
            {idx < items.length - 1 && (
              <span className="mx-1 h-px w-6 bg-border-subtle" aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Step1({
  search,
  onSearch,
  loading,
  error,
  templates,
  selectedSlug,
  onPick,
}: {
  search: string;
  onSearch: (v: string) => void;
  loading: boolean;
  error: unknown;
  templates: TeamTemplateListItem[];
  selectedSlug: string | null;
  onPick: (slug: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-tertiary"
        />
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Поиск по шаблонам — продажи, разработка, монтаж…"
          className="pl-8"
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-md border border-border-subtle bg-bg-elevated"
            />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          Не удалось загрузить шаблоны.
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-md border border-dashed border-border-subtle bg-bg-elevated px-4 py-12 text-center text-sm text-fg-tertiary">
          Ничего не найдено.
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => {
            const active = t.slug === selectedSlug;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onPick(t.slug)}
                  className={`flex h-full w-full flex-col gap-2 rounded-md border p-3 text-left transition-colors ${
                    active
                      ? "border-accent bg-accent-muted/40 ring-1 ring-accent"
                      : "border-border-subtle bg-bg-elevated hover:border-border hover:bg-bg-card"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xl" aria-hidden>
                        {teamTemplateEmoji(t.slug)}
                      </span>
                      <span className="text-sm font-medium text-fg-primary">
                        {t.name}
                      </span>
                    </div>
                    <span className="rounded-full bg-bg-overlay px-2 py-0.5 text-[10px] uppercase text-fg-tertiary">
                      {teamTemplateCategoryLabel(t.category)}
                    </span>
                  </div>
                  <p className="line-clamp-3 text-xs text-fg-tertiary">
                    {t.description}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Step2({
  template,
  projectName,
  onProjectName,
  identifier,
  onIdentifier,
  withExampleTasks,
  onWithExampleTasks,
  timezone,
  onTimezone,
}: {
  template: TeamTemplateListItem;
  projectName: string;
  onProjectName: (v: string) => void;
  identifier: string;
  onIdentifier: (v: string) => void;
  withExampleTasks: boolean;
  onWithExampleTasks: (v: boolean) => void;
  timezone: string;
  onTimezone: (v: string) => void;
}) {
  const idIsValid =
    identifier.length === 0 || /^[A-Z][A-Z0-9]{1,4}$/u.test(identifier);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-elevated p-3 text-xs text-fg-secondary">
        <span className="text-xl" aria-hidden>
          {teamTemplateEmoji(template.slug)}
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium text-fg-primary">
            {template.name}
          </div>
          <div className="line-clamp-1 text-xs text-fg-tertiary">
            {template.description}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="ft-name">Название проекта</Label>
        <Input
          id="ft-name"
          value={projectName}
          onChange={(e) => onProjectName(e.target.value)}
          placeholder="Например, Продажи Q3"
          required
          maxLength={200}
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="ft-identifier">Префикс задач</Label>
        <Input
          id="ft-identifier"
          value={identifier}
          onChange={(e) =>
            onIdentifier(
              e.target.value
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, "")
                .slice(0, 5),
            )
          }
          placeholder="SALE"
          required
          minLength={2}
          maxLength={5}
        />
        <span className="text-[11px] text-fg-tertiary">
          2–5 заглавных латинских букв или цифр. Подставится в номера задач: «
          {identifier || "SALE"}-1».
        </span>
        {!idIsValid && (
          <span className="text-[11px] text-danger">
            Только заглавные латинские буквы и цифры, начиная с буквы.
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="ft-timezone">Часовой пояс проекта</Label>
        <select
          id="ft-timezone"
          value={timezone}
          onChange={(e) => onTimezone(e.target.value)}
          className="h-9 rounded-md border border-border-subtle bg-bg-card px-3 text-sm"
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
        <span className="text-[11px] text-fg-tertiary">
          Дедлайны и отчёты будут считаться в этом поясе.
        </span>
      </div>

      <label className="mt-1 flex items-start gap-2 rounded-md border border-border-subtle bg-bg-elevated p-3 text-sm">
        <Checkbox
          checked={withExampleTasks}
          onCheckedChange={(v) => onWithExampleTasks(v === true)}
          id="ft-examples"
        />
        <span className="flex flex-col">
          <span className="font-medium text-fg-primary">
            Создать 2–3 примера задач
          </span>
          <span className="text-xs text-fg-tertiary">
            Из «типичных задач» шаблона — чтобы было что показать команде на
            старте.
          </span>
        </span>
      </label>
    </div>
  );
}

function Step3({
  template,
  detailLoading,
  definition,
  projectName,
  identifier,
  timezone,
  withExampleTasks,
}: {
  template: TeamTemplateListItem;
  detailLoading: boolean;
  definition: import("@/domain/tracker").TeamTemplateDefinition | null;
  projectName: string;
  identifier: string;
  timezone: string;
  withExampleTasks: boolean;
}) {
  const statesCount = definition?.states.length ?? 0;
  const rolesCount = definition?.roles.length ?? 0;
  const regulationsCount = definition?.regulationStubs.length ?? 0;
  const exampleTasksCount = withExampleTasks
    ? Math.min(3, definition?.typicalTasks.length ?? 0)
    : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-border-subtle bg-bg-elevated p-3">
        <div className="flex items-center gap-2">
          <span className="text-xl" aria-hidden>
            {teamTemplateEmoji(template.slug)}
          </span>
          <div>
            <div className="text-sm font-medium text-fg-primary">
              {projectName}
            </div>
            <div className="text-xs text-fg-tertiary">
              Префикс «{identifier}» · часовой пояс {timezone} · шаблон «
              {template.name}»
            </div>
          </div>
        </div>
      </div>

      {detailLoading ? (
        <div className="rounded-md border border-border-subtle bg-bg-elevated p-4 text-sm text-fg-tertiary">
          <Loader2 size={14} className="mr-2 inline animate-spin" />
          Загружаем содержимое шаблона…
        </div>
      ) : !definition ? (
        <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          Не удалось показать предпросмотр содержимого шаблона. Создание всё
          равно сработает — мы возьмём данные на стороне сервера.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <CountCard label="статусов" value={statesCount} />
          <CountCard label="ролей" value={rolesCount} />
          <CountCard label="регламентов" value={regulationsCount} />
          <CountCard label="примеров задач" value={exampleTasksCount} />
        </div>
      )}

      {definition && definition.states.length > 0 && (
        <div className="rounded-md border border-border-subtle bg-bg-elevated p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
            Статусы
          </div>
          <ul className="flex flex-wrap gap-2">
            {definition.states.map((s) => (
              <li
                key={s.key}
                className="flex items-center gap-2 rounded-full border border-border-subtle bg-bg-card px-2.5 py-1 text-xs"
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: s.color }}
                  aria-hidden
                />
                <span className="text-fg-primary">{s.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {definition && definition.roles.length > 0 && (
        <div className="rounded-md border border-border-subtle bg-bg-elevated p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
            Роли
          </div>
          <ul className="grid grid-cols-1 gap-1.5 text-xs text-fg-secondary md:grid-cols-2">
            {definition.roles.map((r) => (
              <li key={r.key} className="rounded-md bg-bg-card px-2 py-1.5">
                <div className="text-sm text-fg-primary">{r.name}</div>
                <div className="line-clamp-2 text-[11px] text-fg-tertiary">
                  {r.responsibilities[0] ?? ""}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {definition && withExampleTasks && definition.typicalTasks.length > 0 && (
        <div className="rounded-md border border-border-subtle bg-bg-elevated p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
            Примеры задач
          </div>
          <ul className="flex flex-col gap-1 text-sm text-fg-secondary">
            {definition.typicalTasks.slice(0, 3).map((t, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="text-fg-tertiary">·</span>
                {t.title}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CountCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border-subtle bg-bg-elevated p-3 text-center">
      <div className="text-xl font-semibold text-fg-primary">{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-fg-tertiary">
        {label}
      </div>
    </div>
  );
}
