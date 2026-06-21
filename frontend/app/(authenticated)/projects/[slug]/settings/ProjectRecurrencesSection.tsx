"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { humanizeApiError } from "@/api/api-error";
import {
  issueRecurrencesApi,
  type CreateIssueRecurrenceRequest,
} from "@/api/tracker/recurrences.api";
import {
  issueTemplatesApi,
  type CreateIssueTemplateRequest,
} from "@/api/tracker/templates.api";
import {
  RECURRENCE_FREQUENCY_LABELS,
  type IssueRecurrence,
  type IssueTemplate,
  type RecurrenceFrequency,
} from "@/domain/tracker/recurrence";
import { useIssueRecurrences } from "@/hooks/tracker/useIssueRecurrences";
import { useIssueTemplates } from "@/hooks/tracker/useIssueTemplates";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select";
import { useConfirmDialog } from "@/ui/components/shared/useConfirmDialog";

const FREQUENCIES: RecurrenceFrequency[] = ["daily", "weekly", "monthly"];

function parseChecklist(raw: string): { items: { text: string }[] }[] {
  const items = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 100)
    .map((text) => ({ text: text.slice(0, 500) }));
  return items.length > 0 ? [{ items }] : [];
}

export function ProjectRecurrencesSection({
  orgId,
  projectId,
}: {
  orgId: string;
  projectId: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <TemplatesSubsection orgId={orgId} projectId={projectId} />
      <RecurrencesSubsection orgId={orgId} projectId={projectId} />
    </div>
  );
}

function TemplatesSubsection({
  orgId,
  projectId,
}: {
  orgId: string;
  projectId: string;
}) {
  const { templates, isLoading, mutate } = useIssueTemplates(orgId, projectId);
  const { ask, dialog: confirmDialog } = useConfirmDialog();
  const router = useRouter();

  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [checklist, setChecklist] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim() || !title.trim()) {
      setError("Заполните название шаблона и заголовок задачи");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: CreateIssueTemplateRequest = {
        projectId,
        name: name.trim(),
        config: {
          title: title.trim(),
          checklist: parseChecklist(checklist),
        },
      };
      await issueTemplatesApi.create(orgId, body);
      setName("");
      setTitle("");
      setChecklist("");
      await mutate();
    } catch (e) {
      setError(humanizeApiError(e, "Не удалось создать шаблон"));
    } finally {
      setBusy(false);
    }
  };

  const handleInstantiate = async (tpl: IssueTemplate) => {
    setError(null);
    try {
      const res = await issueTemplatesApi.instantiate(orgId, tpl.id, projectId);
      router.push(`/issues/${res.issueId}`);
    } catch (e) {
      setError(humanizeApiError(e, "Не удалось создать задачу из шаблона"));
    }
  };

  const handleDelete = async (tpl: IssueTemplate) => {
    const ok = await ask({
      title: "Удалить шаблон?",
      description: `Шаблон «${tpl.name}» будет удалён без возможности восстановления.`,
      confirmLabel: "Удалить",
    });
    if (!ok) return;
    try {
      await issueTemplatesApi.remove(orgId, tpl.id);
      await mutate();
    } catch (e) {
      setError(humanizeApiError(e, "Не удалось удалить шаблон"));
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-fg-primary">Шаблоны задач</h2>
        <p className="text-xs text-fg-tertiary">
          Готовые заготовки задач: создавайте новую задачу из шаблона одним
          нажатием.
        </p>
      </div>

      {isLoading ? (
        <div className="h-16 animate-pulse rounded-md border border-border-subtle bg-bg-elevated" />
      ) : templates.length === 0 ? (
        <div className="text-sm text-fg-tertiary">Шаблонов пока нет.</div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {templates.map((tpl) => (
            <li
              key={tpl.id}
              className="flex items-center gap-3 rounded-md border border-border-subtle bg-bg-elevated px-3 py-2"
            >
              <div className="flex flex-1 flex-col gap-0.5">
                <span className="truncate text-sm text-fg-primary">
                  {tpl.name}
                </span>
                <span className="truncate text-xs text-fg-tertiary">
                  {tpl.config.title}
                  {tpl.config.checklist && tpl.config.checklist.length > 0
                    ? ` · чек-лист ${tpl.config.checklist.reduce((acc, c) => acc + c.items.length, 0)}`
                    : ""}
                </span>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleInstantiate(tpl)}
              >
                Создать из шаблона
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleDelete(tpl)}
              >
                Удалить
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-elevated p-4">
        <span className="text-xs font-medium text-fg-secondary">
          Новый шаблон
        </span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Название шаблона"
        />
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Заголовок задачи"
        />
        <textarea
          value={checklist}
          onChange={(e) => setChecklist(e.target.value)}
          placeholder="Чек-лист — по одному пункту в строке (необязательно)"
          rows={3}
          className="rounded-md border border-border-subtle bg-bg-base px-3 py-2 text-sm text-fg-primary placeholder:text-fg-tertiary"
        />
        {error ? <p className="text-xs text-danger">{error}</p> : null}
        <div>
          <Button onClick={() => void handleCreate()} disabled={busy}>
            Добавить шаблон
          </Button>
        </div>
      </div>
      {confirmDialog}
    </section>
  );
}

function RecurrencesSubsection({
  orgId,
  projectId,
}: {
  orgId: string;
  projectId: string;
}) {
  const { recurrences, isLoading, mutate } = useIssueRecurrences(
    orgId,
    projectId,
  );
  const { ask, dialog: confirmDialog } = useConfirmDialog();

  const [title, setTitle] = useState("");
  const [freq, setFreq] = useState<RecurrenceFrequency>("weekly");
  const [interval, setInterval] = useState("1");
  const [firstRun, setFirstRun] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!title.trim() || !firstRun) {
      setError("Заполните заголовок задачи и дату первого запуска");
      return;
    }
    const intervalNum = Math.max(1, Number(interval) || 1);
    setBusy(true);
    setError(null);
    try {
      const body: CreateIssueRecurrenceRequest = {
        projectId,
        rule: { freq, interval: intervalNum },
        config: { title: title.trim() },
        nextRunAt: new Date(firstRun).toISOString(),
      };
      await issueRecurrencesApi.create(orgId, body);
      setTitle("");
      setFirstRun("");
      setInterval("1");
      await mutate();
    } catch (e) {
      setError(humanizeApiError(e, "Не удалось создать повторение"));
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (rec: IssueRecurrence) => {
    try {
      await issueRecurrencesApi.update(orgId, rec.id, {
        enabled: !rec.enabled,
      });
      await mutate();
    } catch (e) {
      setError(humanizeApiError(e, "Не удалось изменить повторение"));
    }
  };

  const handleDelete = async (rec: IssueRecurrence) => {
    const ok = await ask({
      title: "Удалить повторение?",
      description: `Повторение «${rec.config.title}» будет удалено.`,
      confirmLabel: "Удалить",
    });
    if (!ok) return;
    try {
      await issueRecurrencesApi.remove(orgId, rec.id);
      await mutate();
    } catch (e) {
      setError(humanizeApiError(e, "Не удалось удалить повторение"));
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-fg-primary">
          Повторяющиеся задачи
        </h2>
        <p className="text-xs text-fg-tertiary">
          Кора сама создаёт задачу по расписанию из заготовки.
        </p>
      </div>

      {isLoading ? (
        <div className="h-16 animate-pulse rounded-md border border-border-subtle bg-bg-elevated" />
      ) : recurrences.length === 0 ? (
        <div className="text-sm text-fg-tertiary">Повторений пока нет.</div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {recurrences.map((rec) => (
            <li
              key={rec.id}
              className="flex items-center gap-3 rounded-md border border-border-subtle bg-bg-elevated px-3 py-2"
            >
              <div className="flex flex-1 flex-col gap-0.5">
                <span className="truncate text-sm text-fg-primary">
                  {rec.config.title}
                </span>
                <span className="text-xs text-fg-tertiary">
                  {RECURRENCE_FREQUENCY_LABELS[rec.rule.freq]}
                  {rec.rule.interval > 1 ? ` (каждые ${rec.rule.interval})` : ""}{" "}
                  · следующий запуск{" "}
                  {rec.nextRunAt.toLocaleDateString("ru-RU")}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleToggle(rec)}
              >
                {rec.enabled ? "Выключить" : "Включить"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleDelete(rec)}
              >
                Удалить
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-elevated p-4">
        <span className="text-xs font-medium text-fg-secondary">
          Новое повторение
        </span>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Заголовок задачи"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={freq}
            onValueChange={(v) => setFreq(v as RecurrenceFrequency)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FREQUENCIES.map((f) => (
                <SelectItem key={f} value={f}>
                  {RECURRENCE_FREQUENCY_LABELS[f]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-fg-tertiary">каждые</span>
          <Input
            type="number"
            min={1}
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
            className="w-[80px]"
          />
          <span className="text-xs text-fg-tertiary">первый запуск</span>
          <Input
            type="date"
            value={firstRun}
            onChange={(e) => setFirstRun(e.target.value)}
            className="w-[170px]"
          />
        </div>
        {error ? <p className="text-xs text-danger">{error}</p> : null}
        <div>
          <Button onClick={() => void handleCreate()} disabled={busy}>
            Добавить повторение
          </Button>
        </div>
      </div>
      {confirmDialog}
    </section>
  );
}
