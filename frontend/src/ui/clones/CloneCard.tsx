"use client";

import { Lock, MessageCircle, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import type { ReactElement } from "react";

import { cloneVersionStatusBadge, type CloneListUiItem } from "@/domain/clone";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { cn } from "@/ui/shadcn/lib/utils";

import { CloneAvatar } from "./CloneAvatar";

export interface CloneCardProps {
  item: CloneListUiItem;
  hasGrant: boolean;
  onRequestAccess?: (roleId: string) => void;
  requestAccessPending?: boolean;
}

export function CloneCard({
  item,
  hasGrant,
  onRequestAccess,
  requestAccessPending = false,
}: CloneCardProps): ReactElement {
  const subtitle = item.bearerName
    ? `Сейчас: ${item.bearerName}`
    : "Носитель не назначен";

  const ariaLabel = `${item.publicName}. ${
    hasGrant ? "Спросить клона" : "Запросить доступ"
  }`;

  const inner = (
    <div
      className={cn(
        "group flex h-full flex-col gap-3 rounded-lg border border-border-subtle bg-bg-card p-4 transition-colors",
        hasGrant
          ? "hover:border-accent hover:shadow-sm"
          : "opacity-60 hover:opacity-80",
      )}
    >
      <div className="flex items-start gap-3">
        <CloneAvatar
          roleName={item.roleName}
          departmentId={item.departmentId}
          size={48}
          className="sm:h-14 sm:w-14"
        />
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-1 text-sm font-semibold text-fg-primary">
            {item.publicName}
          </h3>
          <p className="mt-0.5 line-clamp-1 text-xs text-fg-tertiary">
            {item.departmentName ?? "Без отдела"}
          </p>
          <p className="mt-1 line-clamp-1 text-xs text-fg-secondary">
            <Users size={11} className="-mt-0.5 mr-1 inline" />
            {subtitle}
          </p>
        </div>
        {!hasGrant ? (
          <Lock size={14} className="text-fg-tertiary" aria-hidden="true" />
        ) : null}
      </div>

      {item.status !== "active" ? (
        <Badge
          variant={cloneVersionStatusBadge(item.status).variant}
          className="self-start text-[10px]"
        >
          {cloneVersionStatusBadge(item.status).label}
        </Badge>
      ) : null}

      <div className="mt-auto flex items-center justify-between gap-2 text-xs text-fg-tertiary">
        <span className="flex items-center gap-1">
          <Sparkles size={11} />
          {item.traitsCount} {pluralTraits(item.traitsCount)}
        </span>
        <span>Обновлён {item.lastBuildAt.toLocaleDateString("ru-RU")}</span>
      </div>

      <div className="pt-1">
        {hasGrant ? (
          <Button
            size="sm"
            className="w-full"
            aria-label={ariaLabel}
            tabIndex={-1}
          >
            <MessageCircle size={14} className="mr-1.5" />
            Спросить
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full"
            disabled={requestAccessPending}
            onClick={(e) => {
              e.preventDefault();
              onRequestAccess?.(item.roleId);
            }}
            aria-label={ariaLabel}
          >
            <Lock size={14} className="mr-1.5" />
            {requestAccessPending ? "Отправляем…" : "Запросить доступ"}
          </Button>
        )}
      </div>
    </div>
  );

  if (hasGrant) {
    return (
      <Link
        href={`/clones/${encodeURIComponent(item.roleId)}`}
        className="block focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 rounded-lg"
        aria-label={ariaLabel}
      >
        {inner}
      </Link>
    );
  }

  return (
    <article role="group" aria-label={ariaLabel} className="block rounded-lg">
      {inner}
    </article>
  );
}

function pluralTraits(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "черта";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "черты";
  return "черт";
}

export function CloneCardSkeleton(): ReactElement {
  return (
    <div className="h-44 animate-pulse rounded-lg border border-border-subtle bg-bg-card" />
  );
}
