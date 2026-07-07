"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  Archive,
  CheckSquare,
  ChevronLeft,
  FileText,
  Hash,
  HelpCircle,
  Pencil,
  Plus,
  ScrollText,
  Sparkles,
  Star,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { themesApi } from "@/api/themes.api";
import { pluralRu } from "@/domain/contribution";
import { ApiError, humanizeApiError } from "@/api/api-error";
import {
  THEME_ADDED_VIA_LABELS,
  THEME_BRANCH_LABELS,
  type ThemeBlockDomain,
  type ThemeDecisionDomain,
  type ThemeDetailDomain,
  type ThemeDocumentDomain,
  type ThemeDynamic,
  type ThemeEntityDomain,
  type ThemeRegulationDomain,
  type ThemeTaskDomain,
  themeDetailFromApi,
} from "@/domain/theme";
import { useAuth } from "@/contexts/auth-context";
import { entityTypeLabel, signalTypeLabel } from "@/domain/entity";
import { Button } from "@/ui/shadcn/button";
import { Badge } from "@/ui/shadcn/badge";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/ui/shadcn/popover";
import { cn } from "@/ui/shadcn/lib/utils";
import { useRegisterBreadcrumb } from "@/ui/components/breadcrumbs/BreadcrumbContext";

type Verdict = {
  emoji: string;
  label: string;
  tone: string;
};

const VERDICT_BY_DYNAMIC: Record<ThemeDynamic, Verdict> = {
  declining: { emoji: "🔴", label: "Риск", tone: "text-danger" },
  stable: { emoji: "🟡", label: "Стабильна", tone: "text-warning" },
  growing: { emoji: "🟢", label: "Растёт", tone: "text-success" },
};

export function ThemeDetailClient({ themeId }: { themeId: string }) {
  const themeSwr = useSWR(["theme", themeId], async () => {
    const api = await themesApi.get(themeId);
    return themeDetailFromApi(api);
  });

  useRegisterBreadcrumb(
    themeSwr.data?.theme ? { label: themeSwr.data.theme.name } : null,
  );

  if (themeSwr.error) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <div className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
          Тема не найдена или у вас нет доступа.
        </div>
        <Button asChild variant="ghost" className="mt-3">
          <Link href="/themes">
            <ChevronLeft size={16} /> Все темы
          </Link>
        </Button>
      </div>
    );
  }

  const detail = themeSwr.data;
  if (!detail) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-8 text-fg-tertiary">
        Загрузка…
      </div>
    );
  }

  return (
    <ThemeDetail
      detail={detail}
      reload={() => {
        void themeSwr.mutate();
      }}
    />
  );
}

function ThemeDetail({
  detail,
  reload,
}: {
  detail: ThemeDetailDomain;
  reload: () => void;
}) {
  const router = useRouter();
  const { currentOrgRole } = useAuth();
  const { theme, entities, decisions, tasks, documents, regulations } = detail;

  const [saveOpen, setSaveOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [removedBlockIds, setRemovedBlockIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [removedEntityIds, setRemovedEntityIds] = useState<Set<string>>(
    () => new Set(),
  );

  const isManagerPlus = currentOrgRole != null;
  const canManage = theme.isMine || isManagerPlus;

  const branchLabel = theme.branch ? THEME_BRANCH_LABELS[theme.branch] : null;
  const verdict = VERDICT_BY_DYNAMIC[theme.dynamic];
  const isMerged = theme.status === "merged_into" && detail.mergedIntoId;
  const isActive = theme.status === "active";

  const blocks = useMemo(
    () => detail.blocks.filter((b) => !removedBlockIds.has(b.id)),
    [detail.blocks, removedBlockIds],
  );
  const visibleEntities = useMemo(
    () => entities.filter((e) => !removedEntityIds.has(e.id)),
    [entities, removedEntityIds],
  );
  const commitments = useMemo(
    () => blocks.filter((b) => b.signalType === "commitment"),
    [blocks],
  );

  async function handleUnpinBlock(blockId: string) {
    setRemovedBlockIds((prev) => {
      const next = new Set(prev);
      next.add(blockId);
      return next;
    });
    try {
      await themesApi.unpin(theme.id, "block", blockId);
      toast.success("Убрано, больше не вернётся");
    } catch (err) {
      setRemovedBlockIds((prev) => {
        const next = new Set(prev);
        next.delete(blockId);
        return next;
      });
      toast.error(humanizeApiError(err, "Не удалось убрать блок"));
    }
  }

  async function handleUnpinEntity(entityId: string) {
    setRemovedEntityIds((prev) => {
      const next = new Set(prev);
      next.add(entityId);
      return next;
    });
    try {
      await themesApi.unpin(theme.id, "entity", entityId);
      toast.success("Убрано, больше не вернётся");
    } catch (err) {
      setRemovedEntityIds((prev) => {
        const next = new Set(prev);
        next.delete(entityId);
        return next;
      });
      toast.error(humanizeApiError(err, "Не удалось убрать сущность"));
    }
  }

  async function handleArchive() {
    if (archiving) return;
    setArchiving(true);
    try {
      await themesApi.archive(theme.id);
      toast.success("Тема отправлена в архив");
      reload();
    } catch (err) {
      toast.error(humanizeApiError(err, "Не удалось архивировать тему"));
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6">
      <div className="mb-4">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="gap-1 text-fg-tertiary"
        >
          <Link href="/themes">
            <ChevronLeft size={16} /> Все темы
          </Link>
        </Button>
      </div>

      <header className="mb-6 flex flex-wrap items-start gap-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-accent/20 text-accent">
          <Sparkles size={22} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold">{theme.name}</h1>
            {theme.isMine && (
              <Badge variant="default" className="gap-1">
                <Star size={12} /> моя тема
              </Badge>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span
              className={cn(
                "inline-flex items-center gap-1 text-sm font-medium",
                verdict.tone,
              )}
            >
              <span aria-hidden>{verdict.emoji}</span>
              {verdict.label}
            </span>
            {branchLabel && <Badge variant="secondary">{branchLabel}</Badge>}
            <span className="text-xs text-fg-tertiary">
              {pluralRu(theme.blocksCount, "блок", "блока", "блоков")} ·{" "}
              {pluralRu(
                theme.entitiesCount,
                "сущность",
                "сущности",
                "сущностей",
              )}
            </span>
          </div>
        </div>
        {isActive && (
          <div className="flex flex-wrap items-center gap-2">
            {canManage && (
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                onClick={() => setRenameOpen(true)}
              >
                <Pencil size={16} /> Переименовать
              </Button>
            )}
            <Button
              type="button"
              className="gap-2"
              onClick={() => setSaveOpen(true)}
            >
              <Plus size={16} /> Сохранить как карточку
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="gap-2 text-fg-tertiary"
              onClick={handleArchive}
              disabled={archiving}
            >
              <Archive size={16} /> {archiving ? "Архивируем…" : "В архив"}
            </Button>
          </div>
        )}
      </header>

      {isMerged && detail.mergedIntoId && (
        <div className="mb-6 rounded-xl border border-border-subtle bg-bg-overlay p-4 text-sm text-fg-secondary">
          Эта тема была объединена с другой.{" "}
          <Link
            href={`/themes/${encodeURIComponent(detail.mergedIntoId)}`}
            className="text-accent hover:underline"
          >
            Перейти к актуальной теме →
          </Link>
        </div>
      )}

      {theme.description && (
        <Section title="Суть темы">
          <p className="text-sm leading-relaxed text-fg-secondary">
            {theme.description}
          </p>
        </Section>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Section title={`Что происходило (${blocks.length})`}>
            {blocks.length === 0 ? (
              <EmptyBox text="В теме пока нет блоков." />
            ) : (
              <ul className="flex flex-col gap-2">
                {blocks.map((b) => (
                  <BlockItem
                    key={b.id}
                    block={b}
                    onRemove={() => handleUnpinBlock(b.id)}
                  />
                ))}
              </ul>
            )}
          </Section>

          <Section title="Решения и обязательства">
            {decisions.length === 0 && commitments.length === 0 ? (
              <EmptyBox text="Решений и обязательств пока нет." />
            ) : (
              <ul className="flex flex-col gap-2">
                {decisions.map((d) => (
                  <DecisionItem key={d.id} decision={d} />
                ))}
                {commitments.map((b) => (
                  <CommitmentItem
                    key={b.id}
                    block={b}
                    themeId={theme.id}
                    onNavigate={(taskId) =>
                      router.push(`/issues/${encodeURIComponent(taskId)}`)
                    }
                  />
                ))}
              </ul>
            )}
          </Section>
        </div>

        <aside className="flex flex-col gap-6">
          <Section title={`Кто в теме (${visibleEntities.length})`}>
            {visibleEntities.length === 0 ? (
              <EmptyBox text="Участников и сущностей нет." small />
            ) : (
              <ul className="flex flex-col gap-2">
                {visibleEntities.map((e) => (
                  <EntityItem
                    key={e.id}
                    entity={e}
                    onRemove={() => handleUnpinEntity(e.id)}
                  />
                ))}
              </ul>
            )}
          </Section>

          <Section title={`Связанные задачи (${tasks.length})`}>
            {tasks.length === 0 ? (
              <EmptyBox text="Связанных задач нет." small />
            ) : (
              <ul className="flex flex-col gap-1.5">
                {tasks.map((t) => (
                  <LinkRow
                    key={t.id}
                    href={t.href}
                    title={t.title}
                    icon={<CheckSquare size={14} />}
                  />
                ))}
              </ul>
            )}
          </Section>

          <Section title={`Документы (${documents.length})`}>
            {documents.length === 0 ? (
              <EmptyBox text="Документов нет." small />
            ) : (
              <ul className="flex flex-col gap-1.5">
                {documents.map((d) => (
                  <DocumentRow key={d.id} document={d} />
                ))}
              </ul>
            )}
          </Section>

          <Section title={`Регламенты (${regulations.length})`}>
            {regulations.length === 0 ? (
              <EmptyBox text="Регламентов нет." small />
            ) : (
              <ul className="flex flex-col gap-1.5">
                {regulations.map((r) => (
                  <RegulationRow key={r.id} regulation={r} />
                ))}
              </ul>
            )}
          </Section>
        </aside>
      </div>

      <SaveAsCardDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        themeId={theme.id}
        defaultName={theme.name}
      />
      <RenameThemeDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        themeId={theme.id}
        defaultName={theme.name}
        onRenamed={reload}
      />
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6 last:mb-0">
      <h2 className="mb-3 text-sm font-medium text-fg-tertiary">{title}</h2>
      {children}
    </section>
  );
}

function EmptyBox({ text, small }: { text: string; small?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-dashed border-border-subtle text-center text-fg-tertiary",
        small ? "p-4 text-xs" : "p-6 text-sm",
      )}
    >
      {text}
    </div>
  );
}

function BlockItem({
  block,
  onRemove,
}: {
  block: ThemeBlockDomain;
  onRemove: () => void;
}) {
  const reasonParts: string[] = [];
  if (block.reason) reasonParts.push(block.reason);
  if (block.score != null) {
    reasonParts.push(`близость ${block.score.toFixed(2)}`);
  }
  reasonParts.push(THEME_ADDED_VIA_LABELS[block.addedVia]);

  return (
    <li className="rounded-lg border border-border-subtle bg-bg-elevated p-3">
      <div className="flex items-start gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-bg-overlay text-fg-secondary">
          <Hash size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-fg-primary">
              {block.name}
            </span>
            <Badge variant="outline" className="text-[10px]">
              {signalTypeLabel(block.signalType)}
            </Badge>
            <span className="text-[10px] text-fg-tertiary">
              {block.createdAt.toLocaleDateString("ru-RU")}
            </span>
          </div>
          {block.criticalQuestion && (
            <p className="mt-1 line-clamp-2 text-xs text-fg-tertiary">
              {block.criticalQuestion}
            </p>
          )}
          {block.trustedAnswer && (
            <p className="mt-1 line-clamp-3 text-xs text-fg-secondary">
              {block.trustedAnswer}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-fg-tertiary hover:text-fg-primary"
                aria-label="Почему это здесь"
              >
                <HelpCircle size={14} />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 text-xs">
              <p className="font-medium text-fg-primary">Почему это здесь</p>
              <p className="mt-1 text-fg-secondary">
                {reasonParts.join(" · ")}
              </p>
            </PopoverContent>
          </Popover>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-fg-tertiary hover:text-danger"
            aria-label="Убрать блок из темы"
            onClick={onRemove}
          >
            <X size={14} />
          </Button>
        </div>
      </div>
    </li>
  );
}

function EntityItem({
  entity,
  onRemove,
}: {
  entity: ThemeEntityDomain;
  onRemove: () => void;
}) {
  return (
    <li className="rounded-lg border border-border-subtle bg-bg-elevated p-3">
      <div className="flex items-start gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-bg-overlay text-fg-secondary">
          <Users size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="truncate text-sm font-medium text-fg-primary">
            {entity.canonicalName}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-tertiary">
            <span className="rounded-full bg-bg-overlay px-1.5 py-0.5 tracking-wide text-[10px]">
              {entityTypeLabel(String(entity.type).toLowerCase())}
            </span>
            <span>{entity.mentionsCount} упоминаний</span>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-fg-tertiary hover:text-danger"
          aria-label="Убрать сущность из темы"
          onClick={onRemove}
        >
          <X size={14} />
        </Button>
      </div>
    </li>
  );
}

function DecisionItem({ decision }: { decision: ThemeDecisionDomain }) {
  return (
    <li className="rounded-lg border border-border-subtle bg-bg-elevated p-3">
      <div className="flex items-start gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-bg-overlay text-fg-secondary">
          <ScrollText size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <Link
            href={decision.href}
            className="text-sm font-medium text-fg-primary hover:text-accent"
          >
            {decision.statement ?? "Решение"}
          </Link>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-fg-tertiary">
            <Badge variant="secondary" className="text-[10px]">
              Решение
            </Badge>
            {decision.reversibility && (
              <span>{decision.reversibility}</span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function CommitmentItem({
  block,
  themeId,
  onNavigate,
}: {
  block: ThemeBlockDomain;
  themeId: string;
  onNavigate: (taskId: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function handleToTask() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await themesApi.commitmentToTask(themeId, block.id);
      if (res.created) {
        toast.success("Задача создана", {
          action: {
            label: "Открыть",
            onClick: () => onNavigate(res.taskId),
          },
        });
      } else {
        toast.info("Задача уже есть", {
          action: {
            label: "Открыть",
            onClick: () => onNavigate(res.taskId),
          },
        });
      }
    } catch (err) {
      toast.error(humanizeApiError(err, "Не удалось завести задачу"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <li className="rounded-lg border border-border-subtle bg-bg-elevated p-3">
      <div className="flex items-start gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-bg-overlay text-fg-secondary">
          <CheckSquare size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-fg-primary">
              {block.name}
            </span>
            <Badge variant="outline" className="text-[10px]">
              {signalTypeLabel(block.signalType)}
            </Badge>
          </div>
          {block.trustedAnswer && (
            <p className="mt-1 line-clamp-2 text-xs text-fg-secondary">
              {block.trustedAnswer}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 gap-1"
          onClick={handleToTask}
          disabled={submitting}
        >
          <Plus size={14} /> {submitting ? "…" : "Завести задачу"}
        </Button>
      </div>
    </li>
  );
}

function LinkRow({
  href,
  title,
  icon,
}: {
  href: string;
  title: string;
  icon: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-2 rounded-lg border border-border-subtle bg-bg-elevated px-3 py-2 text-sm text-fg-secondary transition-colors hover:border-accent/60 hover:text-accent"
      >
        <span className="shrink-0 text-fg-tertiary">{icon}</span>
        <span className="truncate">{title}</span>
      </Link>
    </li>
  );
}

function DocumentRow({ document }: { document: ThemeDocumentDomain }) {
  return (
    <LinkRow
      href={document.href}
      title={document.title}
      icon={<FileText size={14} />}
    />
  );
}

function RegulationRow({ regulation }: { regulation: ThemeRegulationDomain }) {
  return (
    <li>
      <Link
        href={regulation.href}
        className="flex items-center gap-2 rounded-lg border border-border-subtle bg-bg-elevated px-3 py-2 text-sm text-fg-secondary transition-colors hover:border-accent/60 hover:text-accent"
      >
        <span className="shrink-0 text-fg-tertiary">
          <ScrollText size={14} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block truncate">{regulation.title}</span>
          {regulation.category && (
            <span className="block truncate text-[10px] text-fg-tertiary">
              {regulation.category}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

function RenameThemeDialog({
  open,
  onOpenChange,
  themeId,
  defaultName,
  onRenamed,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  themeId: string;
  defaultName: string;
  onRenamed: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [submitting, setSubmitting] = useState(false);

  function handleOpenChange(v: boolean) {
    if (v) setName(defaultName);
    onOpenChange(v);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Укажите название темы");
      return;
    }
    setSubmitting(true);
    try {
      await themesApi.rename(themeId, { name: trimmed });
      toast.success("Тема переименована");
      onOpenChange(false);
      onRenamed();
    } catch (err) {
      if (err instanceof ApiError && err.code === "not_theme_owner") {
        toast.error("Переименовать может только владелец темы или менеджер+");
      } else {
        toast.error(humanizeApiError(err, "Не удалось переименовать"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={cn("sm:max-w-md")}>
        <DialogHeader>
          <DialogTitle>Переименовать тему</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <div>
            <Label htmlFor="theme-rename-name">Название темы</Label>
            <Input
              id="theme-rename-name"
              autoFocus
              required
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Сохраняем…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SaveAsCardDialog({
  open,
  onOpenChange,
  themeId,
  defaultName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  themeId: string;
  defaultName: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [submitting, setSubmitting] = useState(false);

  function handleOpenChange(v: boolean) {
    if (v) setName(defaultName);
    onOpenChange(v);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!name.trim()) {
      toast.error("Укажите название карточки");
      return;
    }
    setSubmitting(true);
    try {
      const res = await themesApi.saveAsCard(themeId, {
        name: name.trim(),
      });
      toast.success("Карточка создана из темы");
      onOpenChange(false);
      router.push(`/cards/${encodeURIComponent(res.cardId)}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "card_name_taken") {
        toast.error("Карточка с таким названием уже существует");
      } else {
        const msg = humanizeApiError(err, "Не удалось сохранить");
        toast.error(msg);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={cn("sm:max-w-md")}>
        <DialogHeader>
          <DialogTitle>Сохранить тему как карточку</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <div>
            <Label htmlFor="theme-card-name">Название карточки</Label>
            <Input
              id="theme-card-name"
              autoFocus
              required
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="mt-1 text-xs text-fg-tertiary">
              Карточка будет создана как «Тема» (kind=topic) с описанием темы.
              История связи с темой сохранится.
            </p>
          </div>
          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Сохраняем…" : "Создать карточку"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
