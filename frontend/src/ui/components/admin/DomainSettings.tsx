"use client";

import { useState, type JSX } from "react";
import { Loader2, History as HistoryIcon } from "lucide-react";
import { toast } from "sonner";
import type { ZodTypeAny } from "zod";

import { AdminSection } from "@/ui/components/admin/AdminSection";
import { AdminSettingField } from "@/ui/components/admin/AdminSettingField";
import { AdminSettingHistoryDrawer } from "@/ui/components/admin/AdminSettingHistoryDrawer";
import { adminRootCrumb } from "@/ui/components/admin/brand";
import {
  useAdminSettingEditor,
  type AdminSettingSeverity,
} from "@/hooks/useAdminSettingEditor";
import { ApiError } from "@/api/api-error";
import { Button } from "@/ui/shadcn/button";
import { Textarea } from "@/ui/shadcn/textarea";

export type SettingSpec<T = unknown> = {
  key: string;
  label: string;
  description?: string;
  schema: ZodTypeAny;
  defaultValue: T;
  requiresReason?: AdminSettingSeverity;
};

export type SettingsGroup = {
  title: string;
  description?: string;
  specs: SettingSpec[];
};

export function isSaveBlocked(args: {
  isDirty: boolean;
  isSaving: boolean;
  needsReason: boolean;
  reason: string;
}): boolean {
  if (!args.isDirty || args.isSaving) return true;
  if (args.needsReason && args.reason.trim().length < 10) return true;
  return false;
}

export function DomainSettingsClient(props: {
  breadcrumbLabel: string;
  title: string;
  description?: string;
  groups: SettingsGroup[];
}): JSX.Element {
  const [historyKey, setHistoryKey] = useState<string | null>(null);

  return (
    <AdminSection
      breadcrumbs={[adminRootCrumb(), { label: props.breadcrumbLabel }]}
      title={props.title}
      description={props.description}
    >
      <div className="flex flex-col gap-8">
        {props.groups.map((group) => (
          <div key={group.title} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold text-fg-primary">
                {group.title}
              </h2>
              {group.description ? (
                <p className="max-w-prose text-xs text-fg-tertiary">
                  {group.description}
                </p>
              ) : null}
            </div>
            <SettingsGrid specs={group.specs} onOpenHistory={setHistoryKey} />
          </div>
        ))}
      </div>

      <AdminSettingHistoryDrawer
        settingKey={historyKey}
        open={Boolean(historyKey)}
        onOpenChange={(o) => {
          if (!o) setHistoryKey(null);
        }}
      />
    </AdminSection>
  );
}

function SettingsGrid({
  specs,
  onOpenHistory,
}: {
  specs: SettingSpec[];
  onOpenHistory: (key: string) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {specs.map((spec) => (
        <SettingRow
          key={spec.key}
          spec={spec}
          onOpenHistory={() => onOpenHistory(spec.key)}
        />
      ))}
    </div>
  );
}

function SettingRow<T>({
  spec,
  onOpenHistory,
}: {
  spec: SettingSpec<T>;
  onOpenHistory: () => void;
}) {
  const editor = useAdminSettingEditor<T>(spec.key, {
    schema: spec.schema,
    defaultValue: spec.defaultValue,
    requiresReason: spec.requiresReason,
  });

  const needsReason =
    spec.requiresReason === "high" || spec.requiresReason === "destructive";
  const [reason, setReason] = useState("");

  const handleSave = async () => {
    try {
      await editor.save(needsReason ? reason : undefined);
      toast.success(`Настройка ${spec.key} сохранена`);
      setReason("");
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Не удалось сохранить";
      toast.error(msg);
    }
  };

  const saveBlocked = isSaveBlocked({
    isDirty: editor.isDirty,
    isSaving: editor.isSaving,
    needsReason,
    reason,
  });

  return (
    <div className="rounded-md border border-border-subtle bg-bg-card p-3">
      <AdminSettingField<T>
        schema={spec.schema}
        value={editor.value}
        onChange={editor.setValue}
        label={spec.label}
        description={spec.description}
        disabled={editor.isLoading || editor.isSaving}
        error={editor.error ?? undefined}
        rightSlot={
          <button
            type="button"
            onClick={onOpenHistory}
            className="inline-flex items-center gap-1 text-[10px] text-fg-tertiary hover:text-fg-primary"
            aria-label="История изменений"
          >
            <HistoryIcon size={11} aria-hidden />
            История
          </button>
        }
      />

      {needsReason ? (
        <div className="mt-3 flex flex-col gap-1.5">
          <label className="text-xs font-medium text-fg-secondary">
            Причина изменения (обязательна, не короче 10 символов)
          </label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={editor.isLoading || editor.isSaving}
            rows={2}
          />
        </div>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="text-[10px] text-fg-tertiary">
          <span className="font-mono">{spec.key}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              editor.reset();
              setReason("");
            }}
            disabled={!editor.isDirty || editor.isSaving}
          >
            Сбросить
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSave()}
            disabled={saveBlocked}
          >
            {editor.isSaving ? (
              <Loader2 size={12} className="mr-1 animate-spin" />
            ) : null}
            Сохранить
          </Button>
        </div>
      </div>
    </div>
  );
}
