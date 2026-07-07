"use client";

import Link from "next/link";
import useSWR from "swr";
import {
  ChevronLeft,
  ClipboardList,
  FileText,
  ScrollText,
  Sparkles,
  Workflow,
} from "lucide-react";

import { branchesApi } from "@/api/branches.api";
import { ApiError } from "@/api/api-error";
import {
  branchDetailFromApi,
  type BranchDecisionDomain,
  type BranchDetailDomain,
  type BranchDocumentDomain,
  type BranchProcessDomain,
  type BranchRegulationDomain,
} from "@/domain/branch";
import { pluralRu } from "@/domain/contribution";
import { THEME_BRANCH_LABELS, type ThemeDomain } from "@/domain/theme";
import { Button } from "@/ui/shadcn/button";
import { cn } from "@/ui/shadcn/lib/utils";

export function BranchDetailClient({ branch }: { branch: string }) {
  const { data, isLoading, error } = useSWR(
    ["knowledge-branch-detail", branch],
    async () => {
      const api = await branchesApi.detail(branch);
      return branchDetailFromApi(api);
    },
    { shouldRetryOnError: false },
  );

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-8 text-fg-tertiary">
        Загрузка…
      </div>
    );
  }

  if (error) {
    const isUnknown =
      error instanceof ApiError && error.code === "unknown_branch";
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8">
        <div className="mb-4">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="gap-1 text-fg-tertiary"
          >
            <Link href="/memory">
              <ChevronLeft size={16} /> Второй мозг
            </Link>
          </Button>
        </div>
        <div className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
          {isUnknown
            ? "Область не найдена."
            : "Не удалось загрузить область. Попробуйте позже."}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-8 text-fg-tertiary">
        Загрузка…
      </div>
    );
  }

  return <BranchDetail detail={data} />;
}

function BranchDetail({ detail }: { detail: BranchDetailDomain }) {
  const { label, summary, themes, regulations, processes, documents, decisions } =
    detail;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-4">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="gap-1 text-fg-tertiary"
        >
          <Link href="/memory">
            <ChevronLeft size={16} /> Второй мозг
          </Link>
        </Button>
      </div>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
          {label}
        </h1>
        {summary && (
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg-secondary">
            {summary}
          </p>
        )}
      </header>

      <div className="flex flex-col gap-8">
        <Section title="Темы" count={themes.length}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {themes.map((t) => (
              <ThemeCard key={t.id} theme={t} />
            ))}
          </div>
        </Section>

        <Section title="Регламенты" count={regulations.length}>
          <ul className="flex flex-col gap-1.5">
            {regulations.map((r) => (
              <RegulationRow key={r.id} regulation={r} />
            ))}
          </ul>
        </Section>

        <Section title="Процессы" count={processes.length}>
          <ul className="flex flex-col gap-1.5">
            {processes.map((p) => (
              <ProcessRow key={p.id} process={p} />
            ))}
          </ul>
        </Section>

        <Section title="Документы" count={documents.length}>
          <ul className="flex flex-col gap-1.5">
            {documents.map((d) => (
              <DocumentRow key={d.id} document={d} />
            ))}
          </ul>
        </Section>

        <Section title="Решения" count={decisions.length}>
          <ul className="flex flex-col gap-1.5">
            {decisions.map((d) => (
              <DecisionRow key={d.id} decision={d} />
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-fg-tertiary">
        {title} ({count})
      </h2>
      {children}
    </section>
  );
}

function ThemeCard({ theme }: { theme: ThemeDomain }) {
  const branchLabel = theme.branch ? THEME_BRANCH_LABELS[theme.branch] : null;
  return (
    <Link
      href={`/themes/${encodeURIComponent(theme.id)}`}
      className={cn(
        "group flex flex-col gap-2 rounded-xl border border-border-subtle bg-bg-elevated p-4 transition-colors",
        "hover:border-accent/60 hover:bg-bg-overlay",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent/20 text-accent">
          <Sparkles size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg-primary">
            {theme.name}
          </span>
          {branchLabel && (
            <span className="mt-0.5 inline-block rounded-full bg-bg-overlay px-2 py-0.5 text-[10px] text-fg-tertiary">
              {branchLabel}
            </span>
          )}
        </span>
      </div>
      {theme.description && (
        <p className="line-clamp-2 text-xs text-fg-secondary">
          {theme.description}
        </p>
      )}
      <span className="mt-auto text-[10px] text-fg-tertiary">
        {pluralRu(theme.blocksCount, "блок", "блока", "блоков")} ·{" "}
        {pluralRu(
          theme.entitiesCount,
          "сущность",
          "сущности",
          "сущностей",
        )}
      </span>
    </Link>
  );
}

function LinkRow({
  href,
  title,
  subtitle,
  icon,
}: {
  href: string;
  title: string;
  subtitle?: string | null;
  icon: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-2 rounded-lg border border-border-subtle bg-bg-elevated px-3 py-2 text-sm text-fg-secondary transition-colors hover:border-accent/60 hover:text-accent"
      >
        <span className="shrink-0 text-fg-tertiary">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{title}</span>
          {subtitle && (
            <span className="block truncate text-[10px] text-fg-tertiary">
              {subtitle}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

function RegulationRow({
  regulation,
}: {
  regulation: BranchRegulationDomain;
}) {
  return (
    <LinkRow
      href={regulation.href}
      title={regulation.title}
      subtitle={regulation.category}
      icon={<ScrollText size={14} />}
    />
  );
}

function ProcessRow({ process }: { process: BranchProcessDomain }) {
  return (
    <LinkRow
      href={process.href}
      title={process.name}
      icon={<Workflow size={14} />}
    />
  );
}

function DocumentRow({ document }: { document: BranchDocumentDomain }) {
  return (
    <LinkRow
      href={document.href}
      title={document.title}
      icon={<FileText size={14} />}
    />
  );
}

function DecisionRow({ decision }: { decision: BranchDecisionDomain }) {
  return (
    <LinkRow
      href={decision.href}
      title={decision.statement ?? "Решение"}
      subtitle={decision.reversibility}
      icon={<ClipboardList size={14} />}
    />
  );
}
