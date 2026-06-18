"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Flag } from "lucide-react";

import {
  KNOWLEDGE_PROFILE_CONFIDENCE_SHORT,
  type KnowledgeProfileCategory,
} from "@/domain/knowledge-profile";
import { Button } from "@/ui/shadcn/button";
import { cn } from "@/ui/shadcn/lib/utils";

export interface SkillsTableProps {
  categories: KnowledgeProfileCategory[];
  onMarkWrong?: (category: KnowledgeProfileCategory) => void;
}

export function SkillsTable({ categories, onMarkWrong }: SkillsTableProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const order: Record<KnowledgeProfileCategory["confidence"], number> = {
      high: 0,
      medium: 1,
      low: 2,
    };
    return [...categories].sort((a, b) => {
      const byConf = order[a.confidence] - order[b.confidence];
      if (byConf !== 0) return byConf;
      return b.observationCount - a.observationCount;
    });
  }, [categories]);

  if (sorted.length === 0) {
    return <p className="text-sm text-muted-foreground">Областей пока нет.</p>;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-card">
      <table className="w-full text-sm">
        <thead className="bg-bg-overlay/50 text-xs uppercase tracking-wider text-fg-tertiary">
          <tr>
            <th className="px-4 py-2 text-left font-medium" scope="col">
              Компетенция
            </th>
            <th className="px-4 py-2 text-left font-medium" scope="col">
              Уровень
            </th>
            <th
              className="hidden px-4 py-2 text-left font-medium md:table-cell"
              scope="col"
            >
              Наблюдений
            </th>
            <th
              className="hidden px-4 py-2 text-left font-medium md:table-cell"
              scope="col"
            >
              Последнее
            </th>
            {onMarkWrong && (
              <th className="px-4 py-2 text-right font-medium" scope="col" />
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {sorted.map((cat) => {
            const isOpen = expanded === cat.name;
            return (
              <SkillsTableRow
                key={cat.name}
                category={cat}
                isOpen={isOpen}
                onToggle={() => setExpanded(isOpen ? null : cat.name)}
                onMarkWrong={onMarkWrong}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SkillsTableRow({
  category,
  isOpen,
  onToggle,
  onMarkWrong,
}: {
  category: KnowledgeProfileCategory;
  isOpen: boolean;
  onToggle: () => void;
  onMarkWrong?: (cat: KnowledgeProfileCategory) => void;
}) {
  const lastObservedRel = useMemo(
    () => formatRelative(new Date(category.lastObservedAt)),
    [category.lastObservedAt],
  );
  return (
    <>
      <tr
        className={cn(
          "cursor-pointer transition-colors hover:bg-bg-overlay/50",
          isOpen && "bg-bg-overlay/40",
        )}
        onClick={onToggle}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {isOpen ? (
              <ChevronDown size={14} className="shrink-0 text-fg-tertiary" />
            ) : (
              <ChevronRight size={14} className="shrink-0 text-fg-tertiary" />
            )}
            <span className="font-medium text-fg-primary">{category.name}</span>
          </div>
        </td>
        <td className="px-4 py-3">
          <ConfidenceCell confidence={category.confidence} />
        </td>
        <td className="hidden px-4 py-3 text-fg-secondary md:table-cell">
          {category.observationCount}
        </td>
        <td className="hidden px-4 py-3 text-fg-tertiary md:table-cell">
          {lastObservedRel}
        </td>
        {onMarkWrong && (
          <td className="px-4 py-3 text-right">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onMarkWrong(category);
              }}
              className="text-xs"
            >
              <Flag className="mr-1 h-3 w-3" />
              Неверно
            </Button>
          </td>
        )}
      </tr>
      {isOpen && (
        <tr className="bg-bg-overlay/20">
          <td colSpan={onMarkWrong ? 5 : 4} className="px-4 pb-4 pt-1">
            {category.sampleStatements.length === 0 ? (
              <p className="text-xs italic text-fg-tertiary">Цитат пока нет.</p>
            ) : (
              <ul className="space-y-2">
                {category.sampleStatements.map((s, idx) => (
                  <li
                    key={`${s.blockId}-${idx}`}
                    className="border-l-2 border-accent/30 pl-3 text-sm text-fg-secondary"
                  >
                    «{s.quote}»
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function ConfidenceCell({
  confidence,
}: {
  confidence: KnowledgeProfileCategory["confidence"];
}) {
  const filled = confidence === "high" ? 3 : confidence === "medium" ? 2 : 1;
  const color =
    confidence === "high"
      ? "bg-success"
      : confidence === "medium"
        ? "bg-warning"
        : "bg-fg-tertiary/50";
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn(
              "h-2 w-2 rounded-full",
              i < filled ? color : "bg-border-strong/50",
            )}
            aria-hidden
          />
        ))}
      </div>
      <span className="text-xs text-fg-secondary">
        {KNOWLEDGE_PROFILE_CONFIDENCE_SHORT[confidence]}
      </span>
    </div>
  );
}

const RU_RELATIVE = new Intl.RelativeTimeFormat("ru-RU", { numeric: "auto" });

function formatRelative(date: Date): string {
  const now = Date.now();
  const diff = date.getTime() - now;
  const absSec = Math.abs(diff) / 1000;
  if (absSec < 60) return RU_RELATIVE.format(Math.round(diff / 1000), "second");
  if (absSec < 3600)
    return RU_RELATIVE.format(Math.round(diff / 60_000), "minute");
  if (absSec < 86_400)
    return RU_RELATIVE.format(Math.round(diff / 3_600_000), "hour");
  if (absSec < 86_400 * 30) {
    return RU_RELATIVE.format(Math.round(diff / 86_400_000), "day");
  }
  if (absSec < 86_400 * 365) {
    return RU_RELATIVE.format(Math.round(diff / (86_400_000 * 30)), "month");
  }
  return RU_RELATIVE.format(Math.round(diff / (86_400_000 * 365)), "year");
}
