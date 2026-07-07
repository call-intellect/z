"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  AlertTriangle,
  ArrowRight,
  ClipboardList,
  Lightbulb,
  Network,
  Sparkles,
  Table2,
  type LucideIcon,
} from "lucide-react";

import { branchesApi } from "@/api/branches.api";
import {
  branchesMapFromApi,
  type BranchSignal,
  type BranchTileDomain,
} from "@/domain/branch";
import { pluralRu } from "@/domain/contribution";
import { QueryGate } from "@/ui/components/shared/QueryGate";
import { EmptyState } from "@/ui/components/shared/EmptyState";
import {
  Tabs as TabsRoot,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/ui/shadcn/tabs";
import { cn } from "@/ui/shadcn/lib/utils";

type RegistryEntry = {
  href: string;
  label: string;
  desc: string;
  icon: LucideIcon;
};

const REGISTRIES: RegistryEntry[] = [
  {
    href: "/decisions",
    label: "Решения",
    desc: "Журнал ключевых решений",
    icon: ClipboardList,
  },
  {
    href: "/regulations",
    label: "Оцифровано",
    desc: "Регламенты, процессы, инструкции и политики из встреч",
    icon: ClipboardList,
  },
  {
    href: "/themes",
    label: "Темы",
    desc: "Кластеры обсуждений",
    icon: Sparkles,
  },
  {
    href: "/entities",
    label: "Сущности",
    desc: "Реестр сущностей графа",
    icon: Network,
  },
  {
    href: "/tables",
    label: "Таблицы",
    desc: "Извлечённые данные",
    icon: Table2,
  },
  {
    href: "/ideas",
    label: "Идеи",
    desc: "Копилка идей команды",
    icon: Lightbulb,
  },
  {
    href: "/insights",
    label: "Сигналы",
    desc: "Закономерности и риски",
    icon: AlertTriangle,
  },
];

const SIGNAL_META: Record<
  BranchSignal,
  { emoji: string; label: string; tone: string }
> = {
  green: { emoji: "🟢", label: "В порядке", tone: "text-success" },
  yellow: { emoji: "🟡", label: "Требует внимания", tone: "text-warning" },
  red: { emoji: "🔴", label: "Риск", tone: "text-danger" },
};

function tileCountsLabel(tile: BranchTileDomain): string {
  const parts: string[] = [];
  parts.push(pluralRu(tile.counts.themes, "тема", "темы", "тем"));
  parts.push(
    pluralRu(tile.counts.regulations, "регламент", "регламента", "регламентов"),
  );
  parts.push(
    pluralRu(tile.counts.processes, "процесс", "процесса", "процессов"),
  );
  parts.push(
    pluralRu(tile.counts.documents, "документ", "документа", "документов"),
  );
  parts.push(pluralRu(tile.counts.decisions, "решение", "решения", "решений"));
  return parts.join(" · ");
}

export function BranchMapClient() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
          Память
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Всё, что Кора извлекла из встреч и разговоров. Спросите у Мастера или
          откройте карту областей.
        </p>
      </header>

      <Link
        href="/chat"
        className="mb-6 flex items-center gap-4 rounded-lg border border-accent bg-accent/10 px-5 py-4 transition-colors hover:bg-accent/15"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg">
          <Sparkles size={20} />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-fg-primary">
            Спросить у Мастера
          </span>
          <span className="block text-xs text-fg-secondary">
            Задайте вопрос по памяти компании — Мастер найдёт ответ и сделает
            действие
          </span>
        </span>
      </Link>

      <TabsRoot defaultValue="map" className="flex w-full flex-col gap-6">
        <TabsList>
          <TabsTrigger value="map">Карта</TabsTrigger>
          <TabsTrigger value="registries">Все реестры</TabsTrigger>
        </TabsList>

        <TabsContent value="map">
          <BranchMap />
        </TabsContent>

        <TabsContent value="registries">
          <RegistriesGrid />
        </TabsContent>
      </TabsRoot>
    </div>
  );
}

function BranchMap() {
  const router = useRouter();
  const { data, isLoading, error, mutate } = useSWR(
    ["knowledge-branches-map"],
    async () => {
      const api = await branchesApi.map();
      return branchesMapFromApi(api);
    },
  );

  const tiles = data?.tiles ?? [];
  const main = tiles.filter((t) => t.branch !== "unassigned");
  const unassigned = tiles.find((t) => t.branch === "unassigned");

  return (
    <QueryGate
      isLoading={isLoading}
      error={error}
      isEmpty={tiles.length === 0}
      onRetry={() => void mutate()}
      empty={
        <EmptyState
          title="Карта областей пока пуста"
          description="Кора ещё не разложила знание по областям. Как только накопятся темы, регламенты и решения — здесь появятся области бизнеса."
        />
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {main.map((tile) => (
          <BranchTile
            key={tile.branch}
            tile={tile}
            onOpen={() =>
              router.push(`/memory/${encodeURIComponent(tile.branch)}`)
            }
          />
        ))}
      </div>

      {unassigned && (
        <div className="mt-4">
          <Link
            href={`/memory/${encodeURIComponent(unassigned.branch)}`}
            className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border-subtle bg-bg-surface px-4 py-3 transition-colors hover:border-accent/60 hover:bg-bg-overlay"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium text-fg-primary">
                {unassigned.label}
              </span>
              <span className="block truncate text-xs text-fg-tertiary">
                {tileCountsLabel(unassigned)}
              </span>
            </span>
            <ArrowRight size={16} className="shrink-0 text-fg-tertiary" />
          </Link>
        </div>
      )}
    </QueryGate>
  );
}

function BranchTile({
  tile,
  onOpen,
}: {
  tile: BranchTileDomain;
  onOpen: () => void;
}) {
  const signal = SIGNAL_META[tile.signal];
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex flex-col gap-2 rounded-xl border border-border-subtle bg-bg-elevated p-4 text-left transition-colors",
        "hover:border-accent/60 hover:bg-bg-overlay",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="truncate text-base font-medium text-fg-primary">
          {tile.label}
        </h3>
        <span
          className={cn("shrink-0 text-sm", signal.tone)}
          title={signal.label}
          aria-label={signal.label}
        >
          <span aria-hidden>{signal.emoji}</span>
        </span>
      </div>
      <p className="text-xs leading-relaxed text-fg-tertiary">
        {tileCountsLabel(tile)}
      </p>
    </button>
  );
}

function RegistriesGrid() {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {REGISTRIES.map((e) => {
        const Icon = e.icon;
        return (
          <Link
            key={e.href}
            href={e.href}
            className="flex items-center gap-3 rounded-lg border border-border-subtle bg-bg-surface px-4 py-3 transition-colors hover:border-accent hover:bg-bg-overlay"
          >
            <Icon size={16} className="shrink-0 text-fg-tertiary" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-fg-primary">
                {e.label}
              </span>
              <span className="block truncate text-xs text-fg-tertiary">
                {e.desc}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
