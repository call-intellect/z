"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import {
  ArrowLeft,
  Bold,
  Code,
  Eye,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Minus,
  Pencil,
  Pin,
  PinOff,
  Quote,
  Strikethrough,
  Trash2,
} from "lucide-react";

import { useAuth } from "@/contexts/auth-context";
import { useProjectBySlug } from "@/hooks/tracker/useProjectBySlug";
import { useProjectDocument } from "@/hooks/tracker/useProjectDocument";
import { projectDocumentsApi } from "@/api/tracker/project-documents.api";
import { ApiError } from "@/api/api-error";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { cn } from "@/ui/shadcn/lib/utils";
import { useRegisterBreadcrumb } from "@/ui/components/breadcrumbs/BreadcrumbContext";

const AUTO_SAVE_DEBOUNCE_MS = 3000;

interface TiptapLikeContent {
  type: "doc";
  markdown?: string;
  content?: unknown[];
}

function extractMarkdown(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const obj = content as Record<string, unknown>;
  if (typeof obj.markdown === "string") return obj.markdown;
  return "";
}

function wrapMarkdown(markdown: string): TiptapLikeContent {
  return { type: "doc", markdown };
}

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_~\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function ProjectDocumentEditorClient({
  slug,
  docId,
}: {
  slug: string;
  docId: string;
}) {
  const router = useRouter();
  const { currentOrgId } = useAuth();
  const { project } = useProjectBySlug(currentOrgId, slug);
  const { document, isLoading, error, mutate } = useProjectDocument(
    currentOrgId,
    docId,
  );

  useRegisterBreadcrumb(document ? { label: document.title } : null);

  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [pinned, setPinned] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [savingState, setSavingState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastSentRef = useRef<{
    title: string;
    markdown: string;
    pinned: boolean;
  }>({
    title: "",
    markdown: "",
    pinned: false,
  });
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!document) return;
    setTitle(document.title);
    setMarkdown(extractMarkdown(document.content));
    setPinned(document.pinned);
    lastSentRef.current = {
      title: document.title,
      markdown: extractMarkdown(document.content),
      pinned: document.pinned,
    };
  }, [document]);

  const persist = useCallback(
    async (args: {
      title: string;
      markdown: string;
      pinned: boolean;
    }): Promise<void> => {
      if (!currentOrgId) return;
      const stripped = stripMarkdown(args.markdown);
      try {
        setSavingState("saving");
        await projectDocumentsApi.update(currentOrgId, docId, {
          title: args.title,
          content: wrapMarkdown(args.markdown),
          contentStripped: stripped,
          pinned: args.pinned,
        });
        lastSentRef.current = { ...args };
        setSavingState("saved");
        window.setTimeout(() => setSavingState("idle"), 1200);
      } catch (err) {
        setSavingState("idle");
        const msg =
          err instanceof ApiError
            ? err.message
            : "Не удалось сохранить документ";
        toast.error(msg);
      }
    },
    [currentOrgId, docId],
  );

  useEffect(() => {
    if (!document) return;
    const next = { title, markdown, pinned };
    if (
      next.title === lastSentRef.current.title &&
      next.markdown === lastSentRef.current.markdown &&
      next.pinned === lastSentRef.current.pinned
    ) {
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void persist(next);
    }, AUTO_SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [title, markdown, pinned, document, persist]);

  useEffect(() => {
    const flush = () => {
      const next = { title, markdown, pinned };
      if (
        next.title === lastSentRef.current.title &&
        next.markdown === lastSentRef.current.markdown &&
        next.pinned === lastSentRef.current.pinned
      ) {
        return;
      }
      if (!currentOrgId) return;
      const baseUrl =
        process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";
      const body = JSON.stringify({
        title: next.title,
        content: wrapMarkdown(next.markdown),
        contentStripped: stripMarkdown(next.markdown),
        pinned: next.pinned,
      });
      try {
        void fetch(
          `${baseUrl.replace(/\/+$/, "")}/api/v1/project-documents/${encodeURIComponent(docId)}`,
          {
            method: "PATCH",
            credentials: "include",
            keepalive: true,
            headers: {
              "Content-Type": "application/json",
              "X-Org-Id": currentOrgId,
            },
            body,
          },
        );
      } catch {}
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [title, markdown, pinned, currentOrgId, docId]);

  const handleTogglePin = useCallback(() => {
    setPinned((p) => !p);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!currentOrgId) return;
    const ok = window.confirm(`Удалить документ «${title}»?`);
    if (!ok) return;
    try {
      await projectDocumentsApi.remove(currentOrgId, docId);
      toast.success("Документ удалён");
      router.push(`/projects/${slug}/documents`);
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : "Не удалось удалить документ";
      toast.error(msg);
    }
  }, [currentOrgId, docId, router, slug, title]);

  const insertMarkdown = useCallback(
    (template: { prefix: string; suffix?: string; block?: boolean }) => {
      const el = textareaRef.current;
      if (!el) return;
      const { selectionStart, selectionEnd, value } = el;
      const before = value.slice(0, selectionStart);
      const selected = value.slice(selectionStart, selectionEnd);
      const after = value.slice(selectionEnd);
      const suffix = template.suffix ?? "";
      const insertion = `${template.prefix}${selected || ""}${suffix}`;
      const newValue = template.block
        ? `${before}${before.endsWith("\n") || before.length === 0 ? "" : "\n"}${insertion}${after.startsWith("\n") ? "" : "\n"}${after}`
        : `${before}${insertion}${after}`;
      setMarkdown(newValue);
      window.setTimeout(() => {
        if (!el) return;
        const pos = before.length + insertion.length;
        el.focus();
        el.setSelectionRange(pos, pos);
      }, 0);
    },
    [],
  );

  const handleUploadImage = useCallback(
    async (file: File) => {
      if (!currentOrgId) return;
      try {
        const asset = await projectDocumentsApi.uploadAsset(currentOrgId, file);
        const alt = file.name.replace(/\.[^.]+$/, "");
        insertMarkdown({
          prefix: `![${alt}](${asset.url})`,
          block: true,
        });
        toast.success("Картинка загружена");
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Не удалось загрузить картинку";
        toast.error(msg);
      }
    },
    [currentOrgId, insertMarkdown],
  );

  const handleInsertLink = useCallback(() => {
    const url = window.prompt("Адрес ссылки (URL)");
    if (!url) return;
    insertMarkdown({ prefix: "[", suffix: `](${url})` });
  }, [insertMarkdown]);

  const wordCount = useMemo(
    () =>
      markdown.replace(/\s+/g, " ").trim().split(" ").filter(Boolean).length,
    [markdown],
  );

  if (isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 md:p-8">
        <div className="h-8 w-48 animate-pulse rounded-md bg-bg-elevated" />
        <div className="h-12 animate-pulse rounded-md bg-bg-elevated" />
        <div className="h-96 animate-pulse rounded-md bg-bg-elevated" />
      </div>
    );
  }

  if (error || !document || !project) {
    return (
      <div className="mx-auto w-full max-w-4xl p-4 md:p-8">
        <div className="rounded-md border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          Документ не найден или удалён.
        </div>
        <Link
          href={`/projects/${slug}/documents`}
          className="mt-4 inline-flex items-center gap-2 text-sm text-accent hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Вернуться к документам
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-col gap-2">
        <nav className="flex flex-wrap items-center gap-1 text-xs text-fg-tertiary">
          <Link href={`/projects/${slug}`} className="hover:text-fg-secondary">
            {project.name}
          </Link>
          <span aria-hidden>›</span>
          <Link
            href={`/projects/${slug}/documents`}
            className="hover:text-fg-secondary"
          >
            Документы
          </Link>
          <span aria-hidden>›</span>
          <span className="truncate text-fg-secondary">{title || "…"}</span>
        </nav>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Название документа"
            className="max-w-2xl text-base font-medium"
          />

          <div className="flex items-center gap-2">
            <span
              className={cn(
                "text-xs text-fg-tertiary",
                savingState === "saving" && "flex items-center gap-1",
              )}
              aria-live="polite"
            >
              {savingState === "saving" && (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" /> Сохраняем…
                </>
              )}
              {savingState === "saved" && "Сохранено"}
              {savingState === "idle" && `${wordCount} слов`}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPreviewMode((p) => !p)}
              aria-pressed={previewMode}
              title={previewMode ? "Режим редактирования" : "Предпросмотр"}
            >
              {previewMode ? (
                <Pencil className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleTogglePin}
              aria-pressed={pinned}
              title={pinned ? "Открепить" : "Закрепить"}
            >
              {pinned ? (
                <PinOff className="h-4 w-4" />
              ) : (
                <Pin className="h-4 w-4" />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleDelete()}
              title="Удалить документ"
            >
              <Trash2 className="h-4 w-4 text-danger" />
            </Button>
          </div>
        </div>
      </header>

      {!previewMode && (
        <Toolbar
          onCommand={insertMarkdown}
          onUploadImage={handleUploadImage}
          onInsertLink={handleInsertLink}
        />
      )}

      {previewMode ? (
        <article className="prose prose-sm dark:prose-invert max-w-none rounded-md border border-border-subtle bg-bg-elevated p-6">
          {markdown.trim().length === 0 ? (
            <p className="text-fg-tertiary">Документ пока пустой.</p>
          ) : (
            <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
              {markdown}
            </ReactMarkdown>
          )}
        </article>
      ) : (
        <textarea
          ref={textareaRef}
          value={markdown}
          onChange={(e) => {
            void mutate;
            setMarkdown(e.target.value);
          }}
          placeholder="Начните писать. Используйте # для заголовков, * для списка."
          className="min-h-[60vh] w-full resize-y rounded-md border border-border-subtle bg-bg-elevated p-4 font-mono text-sm leading-relaxed text-fg-primary placeholder:text-fg-tertiary focus:outline-none focus:ring-2 focus:ring-accent"
          spellCheck
        />
      )}
    </div>
  );
}

interface ToolbarCommand {
  prefix: string;
  suffix?: string;
  block?: boolean;
}

function Toolbar({
  onCommand,
  onUploadImage,
  onInsertLink,
}: {
  onCommand: (cmd: ToolbarCommand) => void;
  onUploadImage: (file: File) => Promise<void>;
  onInsertLink: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const cmds: Array<{
    icon: typeof Heading1;
    title: string;
    handler: () => void;
  }> = [
    {
      icon: Heading1,
      title: "Заголовок 1 (H1)",
      handler: () => onCommand({ prefix: "# ", block: true }),
    },
    {
      icon: Heading2,
      title: "Заголовок 2 (H2)",
      handler: () => onCommand({ prefix: "## ", block: true }),
    },
    {
      icon: Heading3,
      title: "Заголовок 3 (H3)",
      handler: () => onCommand({ prefix: "### ", block: true }),
    },
    {
      icon: Bold,
      title: "Жирный",
      handler: () => onCommand({ prefix: "**", suffix: "**" }),
    },
    {
      icon: Italic,
      title: "Курсив",
      handler: () => onCommand({ prefix: "_", suffix: "_" }),
    },
    {
      icon: Strikethrough,
      title: "Зачёркнутый",
      handler: () => onCommand({ prefix: "~~", suffix: "~~" }),
    },
    {
      icon: List,
      title: "Маркированный список",
      handler: () => onCommand({ prefix: "- ", block: true }),
    },
    {
      icon: ListOrdered,
      title: "Нумерованный список",
      handler: () => onCommand({ prefix: "1. ", block: true }),
    },
    {
      icon: ListChecks,
      title: "Список задач",
      handler: () => onCommand({ prefix: "- [ ] ", block: true }),
    },
    {
      icon: Quote,
      title: "Цитата",
      handler: () => onCommand({ prefix: "> ", block: true }),
    },
    {
      icon: Code,
      title: "Блок кода",
      handler: () =>
        onCommand({ prefix: "```\n", suffix: "\n```", block: true }),
    },
    {
      icon: Minus,
      title: "Разделитель",
      handler: () => onCommand({ prefix: "\n---\n", block: true }),
    },
  ];

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void onUploadImage(file);
    e.target.value = "";
  };

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 rounded-md border border-border-subtle bg-bg-elevated px-2 py-1.5">
      {cmds.map((c) => (
        <button
          key={c.title}
          type="button"
          onClick={c.handler}
          className="rounded p-1.5 text-fg-tertiary transition-colors hover:bg-bg-overlay hover:text-fg-primary"
          title={c.title}
          aria-label={c.title}
        >
          <c.icon className="h-4 w-4" />
        </button>
      ))}
      <button
        type="button"
        onClick={onInsertLink}
        className="rounded p-1.5 text-fg-tertiary transition-colors hover:bg-bg-overlay hover:text-fg-primary"
        title="Вставить ссылку"
        aria-label="Вставить ссылку"
      >
        <LinkIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="rounded p-1.5 text-fg-tertiary transition-colors hover:bg-bg-overlay hover:text-fg-primary"
        title="Вставить картинку"
        aria-label="Вставить картинку"
      >
        <ImageIcon className="h-4 w-4" />
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  );
}
