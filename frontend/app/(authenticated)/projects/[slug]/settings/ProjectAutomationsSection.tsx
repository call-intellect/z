"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  automationRulesApi,
  type CreateAutomationRuleRequest,
} from "@/api/tracker/automation-rules.api";
import { humanizeApiError } from "@/api/api-error";
import {
  AUTOMATION_ACTION_LABELS,
  AUTOMATION_ACTION_TYPES,
  AUTOMATION_TRIGGER_LABELS,
  AUTOMATION_TRIGGER_TYPES,
  type AutomationAction,
  type AutomationActionType,
  type AutomationRule,
  type AutomationTriggerType,
} from "@/domain/tracker/automation-rule";
import { useAutomationRules } from "@/hooks/tracker/useAutomationRules";
import { useStates } from "@/hooks/tracker/useStates";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select";
import { Switch } from "@/ui/shadcn/switch";
import { useConfirmDialog } from "@/ui/components/shared/useConfirmDialog";

const PRIORITY_OPTIONS: { value: AutomationAction["priority"]; label: string }[] =
  [
    { value: "urgent", label: "Срочный" },
    { value: "high", label: "Высокий" },
    { value: "medium", label: "Средний" },
    { value: "low", label: "Низкий" },
    { value: "none", label: "Без приоритета" },
  ];

export function ProjectAutomationsSection({
  orgId,
  projectId,
}: {
  orgId: string;
  projectId: string;
}) {
  const { rules, isLoading, mutate } = useAutomationRules(orgId, projectId);
  const { states } = useStates(orgId, projectId);
  const { ask, dialog: confirmDialog } = useConfirmDialog();

  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<AutomationTriggerType>("status_changed");
  const [actionType, setActionType] =
    useState<AutomationActionType>("assign");
  const [actionStateId, setActionStateId] = useState<string>("");
  const [actionPriority, setActionPriority] =
    useState<AutomationAction["priority"]>("high");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projectRules = useMemo(
    () => rules.filter((r) => r.projectId === projectId || r.projectId === null),
    [rules, projectId],
  );

  const buildAction = useCallback((): AutomationAction | null => {
    switch (actionType) {
      case "assign":
        return { type: "assign", assignTo: "owner" };
      case "set_status":
        return actionStateId
          ? { type: "set_status", stateId: actionStateId }
          : null;
      case "set_priority":
        return { type: "set_priority", priority: actionPriority };
      case "notify":
        return { type: "notify" };
      default:
        return null;
    }
  }, [actionType, actionStateId, actionPriority]);

  const handleCreate = async () => {
    const action = buildAction();
    if (!name.trim() || !action) {
      setError("Заполните название и параметры действия");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: CreateAutomationRuleRequest = {
        projectId,
        name: name.trim(),
        trigger: { type: trigger },
        conditions: [],
        actions: [action],
      };
      await automationRulesApi.create(orgId, body);
      setName("");
      await mutate();
    } catch (e) {
      setError(humanizeApiError(e, "Не удалось создать правило"));
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (rule: AutomationRule) => {
    try {
      await automationRulesApi.update(orgId, rule.id, {
        enabled: !rule.enabled,
      });
      await mutate();
    } catch (e) {
      setError(humanizeApiError(e, "Не удалось изменить правило"));
    }
  };

  const handleDelete = async (rule: AutomationRule) => {
    const ok = await ask({
      title: "Удалить правило?",
      description: `Правило «${rule.name}» будет удалено без возможности восстановления.`,
      confirmLabel: "Удалить",
    });
    if (!ok) return;
    try {
      await automationRulesApi.remove(orgId, rule.id);
      await mutate();
    } catch (e) {
      setError(humanizeApiError(e, "Не удалось удалить правило"));
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-fg-primary">Автоматизации</h2>
        <p className="text-xs text-fg-tertiary">
          Правила «если — то»: при событии задачи Кора выполняет действие
          автоматически.
        </p>
      </div>

      {isLoading ? (
        <div className="h-16 animate-pulse rounded-md border border-border-subtle bg-bg-elevated" />
      ) : projectRules.length === 0 ? (
        <div className="text-sm text-fg-tertiary">Правил пока нет.</div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {projectRules.map((rule) => (
            <li
              key={rule.id}
              className="flex items-center gap-3 rounded-md border border-border-subtle bg-bg-elevated px-3 py-2"
            >
              <div className="flex flex-1 flex-col gap-0.5">
                <span className="truncate text-sm text-fg-primary">
                  {rule.name}
                </span>
                <span className="text-xs text-fg-tertiary">
                  {AUTOMATION_TRIGGER_LABELS[rule.trigger.type]} →{" "}
                  {rule.actions
                    .map((a) => AUTOMATION_ACTION_LABELS[a.type])
                    .join(", ")}
                </span>
              </div>
              <Switch
                checked={rule.enabled}
                onCheckedChange={() => void handleToggle(rule)}
                aria-label="Включить правило"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleDelete(rule)}
              >
                Удалить
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-elevated p-4">
        <span className="text-xs font-medium text-fg-secondary">
          Новое правило
        </span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Название правила"
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-fg-tertiary">Если</span>
          <Select
            value={trigger}
            onValueChange={(v) => setTrigger(v as AutomationTriggerType)}
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUTOMATION_TRIGGER_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {AUTOMATION_TRIGGER_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-fg-tertiary">то</span>
          <Select
            value={actionType}
            onValueChange={(v) => setActionType(v as AutomationActionType)}
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUTOMATION_ACTION_TYPES.filter(
                (t) => t !== "add_label" && t !== "create_subtask",
              ).map((t) => (
                <SelectItem key={t} value={t}>
                  {AUTOMATION_ACTION_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {actionType === "set_status" ? (
            <Select value={actionStateId} onValueChange={setActionStateId}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Статус" />
              </SelectTrigger>
              <SelectContent>
                {states.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {actionType === "set_priority" ? (
            <Select
              value={actionPriority ?? "high"}
              onValueChange={(v) =>
                setActionPriority(v as AutomationAction["priority"])
              }
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_OPTIONS.map((p) => (
                  <SelectItem key={p.value} value={p.value ?? "none"}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
        {actionType === "assign" ? (
          <p className="text-xs text-fg-tertiary">
            Исполнителем назначается владелец проекта.
          </p>
        ) : null}
        {error ? <p className="text-xs text-danger">{error}</p> : null}
        <div>
          <Button onClick={() => void handleCreate()} disabled={busy}>
            Добавить правило
          </Button>
        </div>
      </div>
      {confirmDialog}
    </section>
  );
}
