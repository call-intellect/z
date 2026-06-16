"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";

import { ApiError } from "@/api/api-error";
import {
  adminPromptTemplatesApi,
  type PromptTemplateApi,
} from "@/api/admin-prompt-templates.api";
import {
  mapPromptTemplate,
  type PromptTemplateUi,
} from "@/domain/admin-prompt-template";
import { toast } from "sonner";
import { useConfirmDialog } from "@/ui/components/shared/useConfirmDialog";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";

import { PromptEditor } from "./PromptEditor";
import { PromptVersionsTab } from "./PromptVersionsTab";
import { PromptPreviewModal } from "./PromptPreviewModal";

type TabKey = "editor" | "versions" | "preview" | "usage";

export function PromptDetailClient({ id }: { id: string }) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tpl, setTpl] = useState<PromptTemplateUi | null>(null);
  const [rawTpl, setRawTpl] = useState<PromptTemplateApi | null>(null);
  const [tab, setTab] = useState<TabKey>("editor");
  const [previewOpen, setPreviewOpen] = useState(false);
  const { ask, dialog: confirmDialog } = useConfirmDialog();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminPromptTemplatesApi.detail(id);
      setRawTpl(res);
      setTpl(mapPromptTemplate(res));
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : "Не удалось загрузить шаблон";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onDelete = async () => {
    if (!tpl) return;
    const ok = await ask({
      title: `Удалить шаблон «${tpl.name}»?`,
      description: "Действие можно отменить администратору в течение 30 дней.",
      confirmLabel: "Удалить",
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminPromptTemplatesApi.remove(tpl.id);
      toast.success("Шаблон удалён");
      router.push("/admin/prompts");
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : "Не удалось удалить шаблон";
      toast.error(msg);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-fg-secondary">
        <Loader2 size={16} className="mr-2 animate-spin" /> Загружаем…
      </div>
    );
  }
  if (error || !tpl || !rawTpl) {
    return (
      <div className="rounded-md border border-chip-danger-bg bg-chip-danger-bg p-3 text-sm text-chip-danger-fg">
        {error ?? "Шаблон не найден"}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/admin/prompts"
        className="mb-3 inline-flex items-center gap-1 text-xs text-fg-secondary hover:text-fg-primary"
      >
        <ArrowLeft size={12} /> Назад к списку
      </Link>
      <header className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
            {tpl.name}
          </h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-fg-secondary">
            <span className="font-mono">{tpl.key}</span>
            <span>·</span>
            <span>{tpl.taskTypeLabel}</span>
            {tpl.meetingTypeLabel && (
              <>
                <span>·</span>
                <span>{tpl.meetingTypeLabel}</span>
              </>
            )}
          </div>
          {tpl.description && (
            <p className="mt-2 max-w-2xl text-sm text-fg-secondary">
              {tpl.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={
              tpl.statusColor === "green"
                ? "border-chip-success-bg bg-chip-success-bg text-chip-success-fg"
                : tpl.statusColor === "amber"
                  ? "border-chip-warning-bg bg-chip-warning-bg text-chip-warning-fg"
                  : "border-border-subtle bg-bg-subtle text-fg-secondary"
            }
          >
            {tpl.statusLabel}
          </Badge>
          <Badge
            variant="outline"
            className="border-border-subtle bg-bg-card text-fg-secondary"
          >
            {tpl.scopeLabel}
          </Badge>
          {tpl.scope === "org" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              className="text-danger"
            >
              Удалить
            </Button>
          )}
        </div>
      </header>

      <div className="mb-4 border-b border-border-subtle">
        <nav className="flex gap-4 text-sm">
          <TabBtn active={tab === "editor"} onClick={() => setTab("editor")}>
            Редактор
          </TabBtn>
          <TabBtn
            active={tab === "versions"}
            onClick={() => setTab("versions")}
          >
            Версии ({rawTpl.versions?.length ?? 0})
          </TabBtn>
          <TabBtn active={tab === "preview"} onClick={() => setTab("preview")}>
            Тестирование
          </TabBtn>
          <TabBtn active={tab === "usage"} onClick={() => setTab("usage")}>
            Использование
          </TabBtn>
        </nav>
      </div>

      {tab === "editor" && (
        <PromptEditor
          templateId={tpl.id}
          activeVersion={rawTpl.activeVersion ?? null}
          onSaved={reload}
          onOpenPreview={() => setPreviewOpen(true)}
        />
      )}

      {tab === "versions" && rawTpl.versions && (
        <PromptVersionsTab
          templateId={tpl.id}
          versions={rawTpl.versions}
          activeVersionId={tpl.activeVersionId}
          onActivated={reload}
        />
      )}

      {tab === "preview" && (
        <div className="rounded-lg border border-border-subtle bg-bg-card p-5 text-sm">
          <p className="mb-3 text-fg-secondary">
            Сгенерируйте предпросмотр отчёта на демо-встрече, чтобы увидеть, как
            шаблон выглядит в работе.
          </p>
          <Button size="sm" onClick={() => setPreviewOpen(true)}>
            Открыть предпросмотр
          </Button>
        </div>
      )}

      {tab === "usage" && (
        <div className="rounded-lg border border-border-subtle bg-bg-card p-5 text-sm text-fg-secondary">
          Статистика использования (количество встреч, средняя оценка качества)
          появится после фазы A.3.
        </div>
      )}

      <PromptPreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        templateId={tpl.id}
        activeVersionId={tpl.activeVersionId}
      />
      {confirmDialog}
    </div>
  );
}

function TabBtn({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-1 pb-3 ${
        active
          ? "border-fg-primary font-semibold text-fg-primary"
          : "border-transparent text-fg-secondary hover:text-fg-primary"
      }`}
    >
      {children}
    </button>
  );
}
