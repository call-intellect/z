"use client";

import { useState } from "react";
import { History as HistoryIcon, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { adminSecurityApi } from "@/api/admin-security.api";
import { ApiError } from "@/api/api-error";
import { SECURITY_SETTINGS, type SecuritySpec } from "@/domain/admin-security";
import { useAdminSettingEditor } from "@/hooks/useAdminSettingEditor";
import { AdminSection } from "@/ui/components/admin/AdminSection";
import {
  AdminDangerZone,
  DangerAction,
} from "@/ui/components/admin/AdminDangerZone";
import { AdminSettingField } from "@/ui/components/admin/AdminSettingField";
import { AdminSettingHistoryDrawer } from "@/ui/components/admin/AdminSettingHistoryDrawer";
import { Button } from "@/ui/shadcn/button";
import { Textarea } from "@/ui/shadcn/textarea";
import { adminRootCrumb } from "@/ui/components/admin/brand";

const MIN_REASON_LENGTH = 10;

export function SecurityClient() {
  const [historyKey, setHistoryKey] = useState<string | null>(null);

  const handleRotateIpSalt = async (reason?: string) => {
    try {
      await adminSecurityApi.rotateIpSalt(reason ?? "");
      toast.success("IP-salt успешно ротирован");
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Не удалось ротировать IP-salt";
      toast.error(msg);
      throw e instanceof Error ? e : new Error(msg);
    }
  };

  return (
    <AdminSection
      breadcrumbs={[
        adminRootCrumb(),
        { label: "Платформа" },
        { label: "Безопасность" },
      ]}
      title="Безопасность"
      description="Параметры Argon2id, TTL сессий и deep-link. Изменение требует причину (severity='high'). Применяется при следующей валидации session/cookie."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {SECURITY_SETTINGS.map((spec) => (
          <SecuritySettingRow
            key={spec.key}
            spec={spec}
            onOpenHistory={() => setHistoryKey(spec.key)}
          />
        ))}
      </div>

      <div className="mt-6">
        <AdminDangerZone
          title="Опасная зона"
          description="Эти операции необратимы. Изменения применяются немедленно."
        >
          <div className="flex items-start gap-3">
            <ShieldCheck
              size={18}
              className="mt-0.5 text-warning"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-medium text-fg-primary">
                Ротация IP-salt
              </h4>
              <p className="mb-2 text-xs text-fg-secondary">
                Сгенерировать новый секрет для анонимизации IP. После ротации
                все сохранённые анонимизированные IP перестанут совпадать с
                новыми. Реальные IP не восстановятся.
              </p>
              <DangerAction
                label="Ротировать IP salt"
                title="Ротировать IP-salt?"
                description="После ротации история анализа IP станет несравнимой со старой. Операция необратима."
                severity="destructive"
                confirmLabel="Ротировать"
                onConfirm={handleRotateIpSalt}
              />
            </div>
          </div>
        </AdminDangerZone>
      </div>

      <AdminSettingHistoryDrawer
        settingKey={historyKey}
        open={Boolean(historyKey)}
        onOpenChange={(open) => {
          if (!open) setHistoryKey(null);
        }}
      />
    </AdminSection>
  );
}

function SecuritySettingRow({
  spec,
  onOpenHistory,
}: {
  spec: SecuritySpec;
  onOpenHistory: () => void;
}) {
  const editor = useAdminSettingEditor<number>(spec.key, {
    schema: spec.schema,
    defaultValue: spec.defaultValue,
    requiresReason: "high",
  });
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  const handleSave = async () => {
    setReasonError(null);
    const trimmed = reason.trim();
    if (trimmed.length < MIN_REASON_LENGTH) {
      setReasonError(
        `Опишите причину минимум в ${MIN_REASON_LENGTH} символов.`,
      );
      return;
    }
    try {
      await editor.save(trimmed);
      toast.success(`Параметр «${spec.label}» сохранён`);
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

  return (
    <div className="rounded-md border border-border-subtle bg-bg-card p-3">
      <AdminSettingField<number>
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
      {editor.isDirty ? (
        <div className="mt-2 space-y-1">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={`Причина изменения (мин. ${MIN_REASON_LENGTH} символов)`}
            rows={2}
            disabled={editor.isSaving}
          />
          {reasonError ? (
            <p className="text-[11px] text-danger">{reasonError}</p>
          ) : null}
        </div>
      ) : null}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-fg-tertiary">
          {spec.key}
        </span>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={editor.reset}
            disabled={!editor.isDirty || editor.isSaving}
          >
            Сбросить
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSave()}
            disabled={!editor.isDirty || editor.isSaving}
          >
            {editor.isSaving ? (
              <Loader2 size={12} className="mr-1 animate-spin" aria-hidden />
            ) : null}
            Сохранить
          </Button>
        </div>
      </div>
    </div>
  );
}
