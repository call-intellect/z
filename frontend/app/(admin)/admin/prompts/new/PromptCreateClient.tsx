"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import {
  adminPromptTemplatesApi,
  PROMPT_TASK_TYPES,
  PROMPT_TEMPLATE_SCOPES,
  MEETING_TYPES,
  type MeetingTypeApi,
  type PromptTaskType,
  type PromptTemplateScope,
} from "@/api/admin-prompt-templates.api";
import {
  meetingTypeLabel,
  scopeLabel,
  taskTypeLabel,
} from "@/domain/admin-prompt-template";
import { ApiError } from "@/api/api-error";
import { toast } from "sonner";
import { Button } from "@/ui/shadcn/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select";

export function PromptCreateClient() {
  const router = useRouter();

  const [scope, setScope] = useState<PromptTemplateScope>("system");
  const [orgId, setOrgId] = useState("");
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [taskType, setTaskType] = useState<PromptTaskType>("summary");
  const [meetingType, setMeetingType] = useState<"none" | MeetingTypeApi>(
    "none",
  );
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (name.trim().length < 3) {
      toast.error("Название — минимум 3 символа");
      return;
    }
    if (key.trim().length < 3) {
      toast.error("Ключ — минимум 3 символа");
      return;
    }
    if (scope === "org" && !orgId.trim()) {
      toast.error("Для шаблона Org нужен ID организации");
      return;
    }
    setSaving(true);
    try {
      const res = await adminPromptTemplatesApi.create({
        scope,
        ...(scope === "org" ? { orgId: orgId.trim() } : {}),
        key: key.trim(),
        name: name.trim(),
        description: description.trim() || null,
        taskType,
        ...(meetingType !== "none" ? { meetingType } : { meetingType: null }),
      });
      toast.success("Шаблон создан");
      router.push(`/admin/prompts/${encodeURIComponent(res.id)}`);
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : "Не удалось создать шаблон";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-fg-primary">
        Новый шаблон промпта
      </h1>
      <p className="mb-6 text-sm text-fg-secondary">
        После создания вы попадёте в редактор: добавите разделы отчёта и
        активируете шаблон.
      </p>

      <div className="space-y-4 rounded-lg border border-border-subtle bg-bg-card p-5">
        <Field label="Область">
          <Select
            value={scope}
            onValueChange={(v) => setScope(v as PromptTemplateScope)}
          >
            <SelectTrigger className="h-9 bg-bg-card text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROMPT_TEMPLATE_SCOPES.map((s) => (
                <SelectItem key={s} value={s}>
                  {scopeLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {scope === "org" && (
          <Field label="ID организации">
            <input
              type="text"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              placeholder="org-cxxxxxxxxxxxxxx"
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-card px-3 text-sm"
            />
          </Field>
        )}

        <Field
          label="Ключ шаблона (slug)"
          hint="Латиница, цифры, дефис. Уникален в рамках области."
        >
          <input
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="type-custom-sales"
            className="h-9 w-full rounded-md border border-border-subtle bg-bg-card px-3 text-sm"
          />
        </Field>

        <Field label="Название">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например: Углублённый разбор продажи"
            className="h-9 w-full rounded-md border border-border-subtle bg-bg-card px-3 text-sm"
          />
        </Field>

        <Field label="Описание (необязательно)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={1000}
            className="w-full rounded-md border border-border-subtle bg-bg-card p-2 text-sm"
          />
        </Field>

        <Field label="Вид отчёта">
          <Select
            value={taskType}
            onValueChange={(v) => setTaskType(v as PromptTaskType)}
          >
            <SelectTrigger className="h-9 bg-bg-card text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROMPT_TASK_TYPES.map((tt) => (
                <SelectItem key={tt} value={tt}>
                  {taskTypeLabel(tt)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="Тип встречи (необязательно)"
          hint="Если не задан — шаблон работает для любого типа."
        >
          <Select
            value={meetingType}
            onValueChange={(v) => setMeetingType(v as "none" | MeetingTypeApi)}
          >
            <SelectTrigger className="h-9 bg-bg-card text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— для любого типа —</SelectItem>
              {MEETING_TYPES.map((mt) => (
                <SelectItem key={mt} value={mt}>
                  {meetingTypeLabel(mt)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <div className="flex items-center justify-end gap-2 pt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.back()}
            disabled={saving}
          >
            Отмена
          </Button>
          <Button size="sm" onClick={submit} disabled={saving}>
            {saving && <Loader2 size={14} className="mr-1 animate-spin" />}
            Создать
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium text-fg-secondary">{label}</div>
      {children}
      {hint && <div className="mt-1 text-xs text-fg-secondary">{hint}</div>}
    </label>
  );
}
