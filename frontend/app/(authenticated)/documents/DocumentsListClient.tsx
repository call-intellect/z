"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  CloudUpload,
  Download,
  Loader2,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import useSWR from "swr";

import { ApiError, humanizeApiError } from "@/api/api-error";
import {
  ACCEPTED_DOCUMENT_ACCEPT,
  documentKindLabel,
  documentTypeLabel,
  documentsApi,
  type DocumentApi,
  type DocumentImportApi,
  type DocumentStatusApi,
  type DocumentTypeApi,
  type UploadDocumentItemApi,
} from "@/api/documents.api";
import { rolesDomainApi, type RoleDomainApi } from "@/api/structure.api";
import { themesApi } from "@/api/themes.api";
import { projectsApi } from "@/api/tracker/projects.api";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "sonner";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/shadcn/dialog";
import { Input } from "@/ui/shadcn/input";
import { Label } from "@/ui/shadcn/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/shadcn/tabs";

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
} from "@app/(admin)/admin/AdminStateViews";

const NO_VALUE = "__none__";

const STATUS_LABELS: Record<DocumentStatusApi, string> = {
  uploaded: "загружен",
  parsing: "обрабатывается",
  parsed: "готов",
  failed: "ошибка",
};

const DOC_TYPE_OPTIONS: ReadonlyArray<{
  value: DocumentTypeApi;
  label: string;
}> = [
  { value: "regulation", label: documentTypeLabel("regulation") },
  { value: "policy", label: documentTypeLabel("policy") },
  { value: "instruction", label: documentTypeLabel("instruction") },
  { value: "process", label: documentTypeLabel("process") },
  { value: "job_description", label: documentTypeLabel("job_description") },
  { value: "other", label: documentTypeLabel("other") },
];

type QueueStatus = "pending" | "uploading" | "done" | "deduped" | "error";

interface QueueItem {
  file: File;
  status: QueueStatus;
}

const QUEUE_STATUS_LABELS: Record<QueueStatus, string> = {
  pending: "ожидание",
  uploading: "загрузка",
  done: "готово",
  deduped: "дубликат",
  error: "ошибка",
};

export function DocumentsListClient() {
  const { currentOrgId, isLoading } = useAuth();
  if (isLoading) return null;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Этот раздел доступен только в рамках организации."
      />
    );
  }
  return <Content orgId={currentOrgId} />;
}

function Content({ orgId }: { orgId: string }) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const swr = useSWR(
    ["documents-list", orgId],
    () => documentsApi.list(orgId),
    {
      revalidateOnFocus: false,
      refreshInterval: (latestData) => {
        const items = latestData?.items ?? [];
        const hasProcessing = items.some(
          (d) => d.status === "uploaded" || d.status === "parsing",
        );
        return hasProcessing ? 2000 : 0;
      },
    },
  );

  if (swr.error) {
    if (swr.error instanceof ApiError && swr.error.code === "http_404") {
      return (
        <div className="mx-auto w-full max-w-6xl px-6 py-8">
          <AdminEmpty
            title="Раздел в разработке"
            description="API документов ещё не подключён."
          />
        </div>
      );
    }
    if (swr.error instanceof ApiError && swr.error.code === "forbidden") {
      return (
        <div className="mx-auto w-full max-w-6xl px-6 py-8">
          <AdminForbidden />
        </div>
      );
    }
    return (
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <AdminError
          message={swr.error instanceof Error ? swr.error.message : "Ошибка"}
          onRetry={() => void swr.mutate()}
        />
      </div>
    );
  }

  const items = swr.data?.items ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
            Документы
          </h1>
          <p className="mt-1 text-sm text-fg-secondary">
            Загрузите файлы и заметки — Кора разберёт их в память компании и
            будет отвечать по ним в чате.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setImportOpen(true)}
          >
            <Download size={14} className="mr-1" /> Импорт
          </Button>
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Plus size={14} className="mr-1" /> Загрузить документ
          </Button>
        </div>
      </header>

      {swr.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-10 w-full animate-pulse rounded-md bg-bg-overlay"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <AdminEmpty
          title="Документов пока нет"
          description="Загрузите первый файл кнопкой выше."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-card">
          <table className="w-full text-sm">
            <thead className="bg-bg-overlay/40 text-xs uppercase tracking-wider text-fg-tertiary">
              <tr>
                <th className="px-4 py-2 text-left">Имя</th>
                <th className="px-4 py-2 text-left">Тип</th>
                <th className="px-4 py-2 text-left">Формат</th>
                <th className="px-4 py-2 text-left">Кем загружен</th>
                <th className="px-4 py-2 text-left">К должности</th>
                <th className="px-4 py-2 text-left">Статус</th>
                <th className="px-4 py-2 text-right">Дата</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {items.map((d) => (
                <DocumentRow
                  key={d.id}
                  doc={d}
                  orgId={orgId}
                  onChanged={() => void swr.mutate()}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {uploadOpen && (
        <UploadDocumentDialog
          orgId={orgId}
          onUploaded={() => void swr.mutate()}
          onClose={() => setUploadOpen(false)}
        />
      )}

      {importOpen && (
        <ImportDocumentsDialog
          orgId={orgId}
          onImported={() => void swr.mutate()}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  );
}

function DocumentRow({
  doc,
  orgId,
  onChanged,
}: {
  doc: DocumentApi;
  orgId: string;
  onChanged: () => void;
}) {
  const showSuggestion = hasPendingSuggestion(doc);
  return (
    <>
      <tr className="hover:bg-bg-overlay/30">
        <td className="px-4 py-2 font-medium text-fg-primary">
          <Link
            href={`/documents/${encodeURIComponent(doc.id)}`}
            className="hover:text-accent"
          >
            {doc.name}
          </Link>
        </td>
        <td className="px-4 py-2 text-fg-secondary">
          {documentTypeLabel(doc.docType ?? null)}
        </td>
        <td className="px-4 py-2 text-fg-secondary">
          {documentKindLabel(doc.kind)}
        </td>
        <td className="px-4 py-2 text-fg-secondary">
          {doc.uploaderName ?? "—"}
        </td>
        <td className="px-4 py-2 text-fg-secondary">
          {doc.attachedRoleId ? (
            <Link
              href={`/roles/${encodeURIComponent(doc.attachedRoleId)}`}
              className="hover:text-accent"
            >
              {doc.attachedRoleName ?? "должность"}
            </Link>
          ) : (
            "—"
          )}
        </td>
        <td className="px-4 py-2">
          <StatusBadge status={doc.status} />
        </td>
        <td className="px-4 py-2 text-right text-xs text-fg-tertiary tabular-nums">
          {formatDate(doc.createdAt)}
        </td>
      </tr>
      {showSuggestion && (
        <tr className="bg-bg-overlay/20">
          <td colSpan={7} className="px-4 pb-2 pt-0">
            <SuggestionBanner orgId={orgId} doc={doc} onChanged={onChanged} />
          </td>
        </tr>
      )}
    </>
  );
}

export function hasPendingSuggestion(doc: {
  docType?: DocumentTypeApi | null;
  attachedThemeId?: string | null;
  suggestedDocType?: DocumentTypeApi | null;
  suggestedThemeId?: string | null;
}): boolean {
  const hasAccepted = Boolean(doc.docType) || Boolean(doc.attachedThemeId);
  const hasSuggestion =
    Boolean(doc.suggestedDocType) || Boolean(doc.suggestedThemeId);
  return hasSuggestion && !hasAccepted;
}

export function SuggestionBanner({
  orgId,
  doc,
  onChanged,
}: {
  orgId: string;
  doc: DocumentApi;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const themesSwr = useSWR(["suggest-themes", orgId], () =>
    themesApi.list({ limit: 100 }),
  );
  const suggestedThemeName = useMemo(() => {
    if (!doc.suggestedThemeId) return null;
    return (
      themesSwr.data?.items.find((t) => t.id === doc.suggestedThemeId)?.name ??
      null
    );
  }, [doc.suggestedThemeId, themesSwr.data]);

  const accept = async () => {
    setBusy(true);
    try {
      await documentsApi.setAttribution(orgId, doc.id, {
        docType: doc.suggestedDocType ?? undefined,
        attachedThemeId: doc.suggestedThemeId ?? undefined,
      });
      toast.success("Подсказка принята.");
      onChanged();
    } catch (e) {
      toast.error(humanizeApiError(e, "Не удалось применить."));
    } finally {
      setBusy(false);
    }
  };

  const parts: string[] = [];
  if (doc.suggestedDocType) {
    parts.push(`тип «${documentTypeLabel(doc.suggestedDocType)}»`);
  }
  if (doc.suggestedThemeId) {
    parts.push(`тема «${suggestedThemeName ?? doc.suggestedThemeId}»`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-accent/40 bg-accent/5 px-3 py-2 text-xs">
      <Sparkles size={13} className="shrink-0 text-accent" />
      <span className="text-fg-secondary">
        Кора предлагает: {parts.join(", ")}
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => setEditOpen(true)}
        >
          Изменить
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void accept()}>
          {busy ? <Loader2 size={12} className="mr-1 animate-spin" /> : null}
          Принять
        </Button>
      </span>
      {editOpen && (
        <EditAttributionDialog
          orgId={orgId}
          doc={doc}
          onSaved={() => {
            setEditOpen(false);
            onChanged();
          }}
          onClose={() => setEditOpen(false)}
        />
      )}
    </div>
  );
}

function EditAttributionDialog({
  orgId,
  doc,
  onSaved,
  onClose,
}: {
  orgId: string;
  doc: DocumentApi;
  onSaved: () => void;
  onClose: () => void;
}) {
  const themesSwr = useSWR(["edit-attr-themes", orgId], () =>
    themesApi.list({ limit: 100 }),
  );
  const projectsSwr = useSWR(["edit-attr-projects", orgId], () =>
    projectsApi.list(orgId),
  );
  const themes = useMemo(() => themesSwr.data?.items ?? [], [themesSwr.data]);
  const projects = useMemo(
    () => projectsSwr.data?.items ?? [],
    [projectsSwr.data],
  );

  const [docType, setDocType] = useState<DocumentTypeApi | null>(
    doc.suggestedDocType ?? null,
  );
  const [themeId, setThemeId] = useState<string | null>(
    doc.suggestedThemeId ?? null,
  );
  const [projectId, setProjectId] = useState<string | null>(
    doc.attachedProjectId ?? null,
  );
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await documentsApi.setAttribution(orgId, doc.id, {
        docType,
        attachedThemeId: themeId,
        attachedProjectId: projectId,
      });
      toast.success("Атрибуция сохранена.");
      onSaved();
    } catch (e) {
      toast.error(humanizeApiError(e, "Не удалось сохранить."));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Изменить атрибуцию</DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label>Тип документа</Label>
          <Select
            value={docType ?? NO_VALUE}
            onValueChange={(v) =>
              setDocType(v === NO_VALUE ? null : (v as DocumentTypeApi))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Не указывать" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_VALUE}>Не указывать</SelectItem>
              {DOC_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Тема</Label>
          {themes.length === 0 ? (
            <p className="text-xs text-fg-tertiary">Тем пока нет.</p>
          ) : (
            <Select
              value={themeId ?? NO_VALUE}
              onValueChange={(v) => setThemeId(v === NO_VALUE ? null : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Не привязывать" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_VALUE}>Не привязывать</SelectItem>
                {themes.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Проект</Label>
          {projects.length === 0 ? (
            <p className="text-xs text-fg-tertiary">Проектов пока нет.</p>
          ) : (
            <Select
              value={projectId ?? NO_VALUE}
              onValueChange={(v) => setProjectId(v === NO_VALUE ? null : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Не привязывать" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_VALUE}>Не привязывать</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ status }: { status: DocumentStatusApi }) {
  const variant =
    status === "parsed"
      ? "default"
      : status === "failed"
        ? "outline"
        : "secondary";
  return (
    <Badge
      variant={variant}
      className={`text-[10px] ${status === "failed" ? "text-danger" : ""}`}
    >
      {(status === "parsing" || status === "uploaded") && (
        <Loader2 size={10} className="mr-1 inline animate-spin" />
      )}
      {STATUS_LABELS[status]}
    </Badge>
  );
}

function UploadDocumentDialog({
  orgId,
  onUploaded,
  onClose,
}: {
  orgId: string;
  onUploaded: () => void;
  onClose: () => void;
}) {
  const rolesSwr = useSWR(["upload-roles", orgId], () =>
    rolesDomainApi.list(orgId),
  );
  const themesSwr = useSWR(["upload-themes", orgId], () =>
    themesApi.list({ limit: 100 }),
  );
  const projectsSwr = useSWR(["upload-projects", orgId], () =>
    projectsApi.list(orgId),
  );

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [themeId, setThemeId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [docType, setDocType] = useState<DocumentTypeApi | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const roles: RoleDomainApi[] = useMemo(
    () => rolesSwr.data?.items ?? [],
    [rolesSwr.data],
  );
  const themes = useMemo(() => themesSwr.data?.items ?? [], [themesSwr.data]);
  const projects = useMemo(
    () => projectsSwr.data?.items ?? [],
    [projectsSwr.data],
  );

  const addFiles = (incoming: FileList | File[] | null) => {
    if (!incoming) return;
    const list = Array.from(incoming);
    if (list.length === 0) return;
    setQueue((prev) => {
      const seen = new Set(prev.map((q) => `${q.file.name}::${q.file.size}`));
      const next = [...prev];
      for (const f of list) {
        const key = `${f.name}::${f.size}`;
        if (!seen.has(key)) {
          seen.add(key);
          next.push({ file: f, status: "pending" });
        }
      }
      return next;
    });
  };

  const doneCount = queue.filter(
    (q) => q.status === "done" || q.status === "deduped",
  ).length;
  const total = queue.length;

  const handleUpload = async () => {
    if (queue.length === 0) return;
    setBusy(true);
    setQueue((prev) =>
      prev.map((q) =>
        q.status === "pending" || q.status === "error"
          ? { ...q, status: "uploading" }
          : q,
      ),
    );
    try {
      const res = await documentsApi.uploadBatch(orgId, {
        files: queue.map((q) => q.file),
        attachedRoleId: roleId,
        attachedThemeId: themeId,
        attachedProjectId: projectId,
        docType,
      });
      setQueue((prev) =>
        prev.map((q, idx) => {
          const item: UploadDocumentItemApi | undefined =
            res.items[idx]?.name === q.file.name
              ? res.items[idx]
              : res.items.find((i) => i.name === q.file.name);
          if (!item) return { ...q, status: "error" };
          return { ...q, status: item.deduped ? "deduped" : "done" };
        }),
      );
      onUploaded();
      const dedupedCount = res.items.filter((i) => i.deduped).length;
      const createdCount = res.items.length - dedupedCount;
      toast.success(
        dedupedCount > 0
          ? `Загружено: ${createdCount}; дубликатов: ${dedupedCount}.`
          : `Загружено документов: ${createdCount}.`,
      );
    } catch (e) {
      setQueue((prev) =>
        prev.map((q) =>
          q.status === "uploading" ? { ...q, status: "error" } : q,
        ),
      );
      toast.error(humanizeApiError(e, "Не удалось загрузить."));
    } finally {
      setBusy(false);
    }
  };

  const allDone =
    total > 0 &&
    queue.every((q) => q.status === "done" || q.status === "deduped");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Загрузить документы</DialogTitle>
        </DialogHeader>

        <label
          htmlFor="doc-upload"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addFiles(e.dataTransfer.files);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed px-4 py-6 text-center text-sm transition-colors ${
            dragOver
              ? "border-accent bg-accent/10 text-accent"
              : "border-border-subtle text-fg-tertiary hover:border-accent/60 hover:text-fg-secondary"
          }`}
        >
          <CloudUpload size={18} />
          <span>Перетащите файлы или нажмите, чтобы выбрать</span>
          <span className="text-[11px] text-fg-tertiary">
            PDF, Word, Excel, PowerPoint, Markdown, текст, HTML, RTF, ODT, CSV
          </span>
          <input
            id="doc-upload"
            type="file"
            multiple
            className="hidden"
            accept={ACCEPTED_DOCUMENT_ACCEPT}
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>

        {queue.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-fg-tertiary">
              <span>Файлы ({total})</span>
              <span>
                Готово {doneCount} из {total}
              </span>
            </div>
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border-subtle p-2">
              {queue.map((q, idx) => (
                <li
                  key={`${q.file.name}-${q.file.size}-${idx}`}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {q.status === "uploading" && (
                      <Loader2
                        size={11}
                        className="animate-spin text-fg-tertiary"
                      />
                    )}
                    <span className="truncate text-fg-primary">
                      {q.file.name}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <QueueStatusBadge status={q.status} />
                    {!busy &&
                      (q.status === "pending" || q.status === "error") && (
                        <button
                          type="button"
                          className="text-fg-tertiary hover:text-danger"
                          aria-label="Убрать файл"
                          onClick={() =>
                            setQueue((prev) => prev.filter((_, i) => i !== idx))
                          }
                        >
                          <X size={12} />
                        </button>
                      )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Тип документа (опционально)</Label>
          <Select
            value={docType ?? NO_VALUE}
            onValueChange={(v) =>
              setDocType(v === NO_VALUE ? null : (v as DocumentTypeApi))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Не указывать" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_VALUE}>Не указывать</SelectItem>
              {DOC_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Тема (опционально)</Label>
          {themes.length === 0 ? (
            <p className="text-xs text-fg-tertiary">
              Темы появятся после первых встреч.
            </p>
          ) : (
            <Select
              value={themeId ?? NO_VALUE}
              onValueChange={(v) => setThemeId(v === NO_VALUE ? null : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Не привязывать" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_VALUE}>Не привязывать</SelectItem>
                {themes.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Проект (опционально)</Label>
          {projects.length === 0 ? (
            <p className="text-xs text-fg-tertiary">Проектов пока нет.</p>
          ) : (
            <Select
              value={projectId ?? NO_VALUE}
              onValueChange={(v) => setProjectId(v === NO_VALUE ? null : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Не привязывать" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_VALUE}>Не привязывать</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Привязать к должности (опционально)</Label>
          <Select
            value={roleId ?? NO_VALUE}
            onValueChange={(v) => setRoleId(v === NO_VALUE ? null : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Не привязывать" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_VALUE}>Не привязывать</SelectItem>
              {roles.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {allDone ? "Закрыть" : "Отмена"}
          </Button>
          <Button
            disabled={queue.length === 0 || busy || allDone}
            onClick={handleUpload}
          >
            {busy ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
            Загрузить{total > 0 ? ` (${total})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportDocumentsDialog({
  orgId,
  onImported,
  onClose,
}: {
  orgId: string;
  onImported: () => void;
  onClose: () => void;
}) {
  const [importId, setImportId] = useState<string | null>(null);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Импорт документов</DialogTitle>
        </DialogHeader>

        {importId ? (
          <ImportProgress
            orgId={orgId}
            importId={importId}
            onImported={onImported}
          />
        ) : (
          <Tabs defaultValue="zip">
            <TabsList className="w-full">
              <TabsTrigger value="zip" className="flex-1">
                ZIP
              </TabsTrigger>
              <TabsTrigger value="notion" className="flex-1">
                Notion
              </TabsTrigger>
              <TabsTrigger value="confluence" className="flex-1">
                Confluence
              </TabsTrigger>
            </TabsList>

            <TabsContent value="zip">
              <ImportZipTab
                orgId={orgId}
                source="upload_zip"
                hint="Загрузите .zip-архив — поддержанные файлы внутри станут отдельными документами."
                onStarted={setImportId}
              />
            </TabsContent>

            <TabsContent value="notion">
              <ImportZipTab
                orgId={orgId}
                source="notion"
                hint="Выгрузите рабочее пространство Notion как «Markdown & CSV» (.zip) и загрузите архив сюда. Имена страниц очистятся автоматически."
                onStarted={setImportId}
              />
            </TabsContent>

            <TabsContent value="confluence">
              <ImportConfluenceTab orgId={orgId} onStarted={setImportId} />
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {importId ? "Закрыть" : "Отмена"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportZipTab({
  orgId,
  source,
  hint,
  onStarted,
}: {
  orgId: string;
  source: "upload_zip" | "notion";
  hint: string;
  onStarted: (importId: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await documentsApi.importZip(orgId, { file, source });
      onStarted(res.importId);
    } catch (e) {
      toast.error(humanizeApiError(e, "Не удалось начать импорт."));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 pt-3">
      <p className="text-xs text-fg-tertiary">{hint}</p>
      <Input
        type="file"
        accept=".zip,application/zip"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      {file && (
        <p className="truncate text-xs text-fg-secondary">{file.name}</p>
      )}
      <Button disabled={!file || busy} onClick={() => void start()}>
        {busy ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
        Начать импорт
      </Button>
    </div>
  );
}

function ImportConfluenceTab({
  orgId,
  onStarted,
}: {
  orgId: string;
  onStarted: (importId: string) => void;
}) {
  const [baseUrl, setBaseUrl] = useState("");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [spaceKey, setSpaceKey] = useState("");
  const [busy, setBusy] = useState(false);

  const canSubmit =
    baseUrl.trim() && email.trim() && apiToken.trim() && spaceKey.trim();

  const start = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const res = await documentsApi.importConfluence(orgId, {
        baseUrl: baseUrl.trim(),
        email: email.trim(),
        apiToken: apiToken.trim(),
        spaceKey: spaceKey.trim(),
      });
      onStarted(res.importId);
    } catch (e) {
      toast.error(humanizeApiError(e, "Не удалось начать импорт."));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 pt-3">
      <div className="space-y-1.5">
        <Label>Адрес Confluence</Label>
        <Input
          placeholder="https://компания.atlassian.net"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Эл. почта учётки Atlassian</Label>
        <Input
          type="email"
          placeholder="you@company.ru"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label>API-токен</Label>
        <Input
          type="password"
          placeholder="Токен Atlassian (не пароль)"
          value={apiToken}
          onChange={(e) => setApiToken(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Ключ пространства</Label>
        <Input
          placeholder="например ENG"
          value={spaceKey}
          onChange={(e) => setSpaceKey(e.target.value)}
        />
      </div>
      <Button disabled={!canSubmit || busy} onClick={() => void start()}>
        {busy ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
        Начать импорт
      </Button>
    </div>
  );
}

function ImportProgress({
  orgId,
  importId,
  onImported,
}: {
  orgId: string;
  importId: string;
  onImported: () => void;
}) {
  const swr = useSWR<DocumentImportApi>(
    ["document-import", orgId, importId],
    () => documentsApi.getImportStatus(orgId, importId),
    {
      refreshInterval: (latest) =>
        latest && (latest.status === "completed" || latest.status === "failed")
          ? 0
          : 1500,
      onSuccess: (data) => {
        if (data.status === "completed" || data.status === "failed") {
          onImported();
        }
      },
    },
  );

  if (swr.error) {
    return (
      <p className="py-4 text-sm text-danger">
        {swr.error instanceof Error ? swr.error.message : "Ошибка"}
      </p>
    );
  }
  const data = swr.data;
  if (!data) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-fg-tertiary">
        <Loader2 size={14} className="animate-spin" /> Запускаем импорт…
      </div>
    );
  }

  const inProgress = data.status === "pending" || data.status === "processing";
  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center gap-2 text-sm">
        {inProgress && (
          <Loader2 size={14} className="animate-spin text-accent" />
        )}
        <span className="font-medium text-fg-primary">
          {IMPORT_STATUS_LABELS[data.status]}
        </span>
      </div>
      <p className="text-sm text-fg-secondary">
        Готово {data.doneFiles} из {data.totalFiles}, ошибок {data.failedFiles}
      </p>
      {data.errorLog.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-fg-tertiary">
            Ошибки ({data.errorLog.length})
          </div>
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border-subtle p-2 text-xs">
            {data.errorLog.map((e, idx) => (
              <li key={`${e.file}-${idx}`} className="text-fg-secondary">
                <span className="font-medium text-fg-primary">{e.file}</span>:{" "}
                {e.error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const IMPORT_STATUS_LABELS: Record<DocumentImportApi["status"], string> = {
  pending: "В очереди",
  processing: "Импортируем…",
  completed: "Импорт завершён",
  failed: "Импорт не удался",
};

function QueueStatusBadge({ status }: { status: QueueStatus }) {
  const variant =
    status === "done"
      ? "default"
      : status === "error"
        ? "outline"
        : "secondary";
  return (
    <Badge
      variant={variant}
      className={`text-[10px] ${status === "error" ? "text-danger" : ""}`}
    >
      {QUEUE_STATUS_LABELS[status]}
    </Badge>
  );
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
