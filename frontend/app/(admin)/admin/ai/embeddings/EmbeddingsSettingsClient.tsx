"use client";

import { useState } from "react";
import {
  Boxes,
  DatabaseZap,
  History as HistoryIcon,
  Layers,
  Loader2,
  Scissors,
  Server,
} from "lucide-react";
import { toast } from "sonner";
import { z, type ZodTypeAny } from "zod";

import { AdminSection } from "@/ui/components/admin/AdminSection";
import { AdminSettingField } from "@/ui/components/admin/AdminSettingField";
import { AdminSettingHistoryDrawer } from "@/ui/components/admin/AdminSettingHistoryDrawer";
import { AdminTabs, type AdminTabDef } from "@/ui/components/admin/AdminTabs";
import { ApiError } from "@/api/api-error";
import {
  useAdminSettingEditor,
  type AdminSettingSeverity,
} from "@/hooks/useAdminSettingEditor";
import { Button } from "@/ui/shadcn/button";
import { Textarea } from "@/ui/shadcn/textarea";

import { AdminEmpty } from "../../AdminStateViews";
import { adminRootCrumb } from "@/ui/components/admin/brand";
import { EmbeddingProvidersClient } from "./EmbeddingProvidersClient";

type SettingSpec<T> = {
  key: string;
  label: string;
  description?: string;
  schema: ZodTypeAny;
  defaultValue: T;
  requiresReason?: AdminSettingSeverity;
};

function isSaveBlocked(args: {
  isDirty: boolean;
  isSaving: boolean;
  needsReason: boolean;
  reason: string;
}): boolean {
  if (!args.isDirty || args.isSaving) return true;
  if (args.needsReason && args.reason.trim().length < 10) return true;
  return false;
}

const MODEL_SETTINGS: SettingSpec<unknown>[] = [
  {
    key: "embeddings.provider",
    label: "Провайдер эмбеддингов",
    description:
      "Кто рассчитывает векторы. Поддерживаем только OpenAI-text-embedding-3-small (см. verified-карту).",
    schema: z.enum(["openai-via-proxy", "ollama"]).default("openai-via-proxy"),
    defaultValue: "openai-via-proxy",
    requiresReason: "high",
  },
  {
    key: "embeddings.model",
    label: "Имя модели",
    description:
      "По дефолту text-embedding-3-small. Смена модели требует реиндексации всей базы.",
    schema: z.string().min(3).max(64).default("text-embedding-3-small"),
    defaultValue: "text-embedding-3-small",
    requiresReason: "high",
  },
  {
    key: "embeddings.dimensions",
    label: "Размерность вектора",
    description:
      "Для text-embedding-3-small — 1536. Должна совпадать с pgvector-индексом.",
    schema: z.number().int().min(64).max(4096).default(1536),
    defaultValue: 1536,
    requiresReason: "destructive",
  },
];

const CHUNK_SETTINGS: SettingSpec<unknown>[] = [
  {
    key: "embeddings.chunk_target_tokens",
    label: "Целевой размер чанка (токены)",
    schema: z.number().int().min(64).max(2000).default(512),
    defaultValue: 512,
  },
  {
    key: "embeddings.chunk_overlap_tokens",
    label: "Перекрытие чанков (токены)",
    schema: z.number().int().min(0).max(500).default(64),
    defaultValue: 64,
  },
];

const BATCH_SETTINGS: SettingSpec<unknown>[] = [
  {
    key: "embeddings.batch_size",
    label: "Batch size",
    description: "Сколько чанков отправлять в одном HTTP-запросе к провайдеру.",
    schema: z.number().int().min(1).max(256).default(32),
    defaultValue: 32,
  },
];

const TABS: AdminTabDef[] = [
  { value: "providers", label: "Провайдеры", icon: Server },
  { value: "model", label: "Модель", icon: DatabaseZap },
  { value: "chunking", label: "Chunking", icon: Scissors },
  { value: "batch", label: "Batch", icon: Boxes },
  { value: "reindex", label: "Реиндексация", icon: Layers },
];

export function EmbeddingsSettingsClient() {
  const [historyKey, setHistoryKey] = useState<string | null>(null);

  return (
    <AdminSection
      breadcrumbs={[
        adminRootCrumb(),
        { label: "AI и модели" },
        { label: "Эмбеддинги" },
      ]}
      title="Эмбеддинги"
      description="Провайдер, размер чанков, batch и реиндексация. Смена модели или размерности требует полной реиндексации pgvector-индексов."
    >
      <AdminTabs tabs={TABS} defaultTab="providers">
        {(active) => (
          <>
            {active === "providers" && <EmbeddingProvidersClient />}
            {active === "model" && (
              <SettingsGrid
                settings={MODEL_SETTINGS}
                onOpenHistory={setHistoryKey}
              />
            )}
            {active === "chunking" && (
              <SettingsGrid
                settings={CHUNK_SETTINGS}
                onOpenHistory={setHistoryKey}
              />
            )}
            {active === "batch" && (
              <SettingsGrid
                settings={BATCH_SETTINGS}
                onOpenHistory={setHistoryKey}
              />
            )}
            {active === "reindex" && <ReindexTab />}
          </>
        )}
      </AdminTabs>

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

function SettingsGrid({
  settings,
  onOpenHistory,
}: {
  settings: SettingSpec<unknown>[];
  onOpenHistory: (key: string) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {settings.map((s) => (
        <SettingRow
          key={s.key}
          spec={s}
          onOpenHistory={() => onOpenHistory(s.key)}
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
            disabled={isSaveBlocked({
              isDirty: editor.isDirty,
              isSaving: editor.isSaving,
              needsReason,
              reason,
            })}
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

function ReindexTab() {
  return (
    <div className="flex flex-col gap-3">
      <AdminEmpty
        title="Полная реиндексация"
        description="Запуск фоновой задачи на пересчёт всех эмбеддингов появится в Фазе 8 (BullMQ-воркер reindex-embeddings)."
      />
      <div className="flex justify-center">
        <Button size="sm" disabled>
          Запустить реиндексацию
        </Button>
      </div>
    </div>
  );
}
