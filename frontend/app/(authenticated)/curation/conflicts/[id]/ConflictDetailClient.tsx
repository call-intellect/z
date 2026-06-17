"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";

import { ApiError, humanizeApiError } from "@/api/api-error";
import { curationApi, type ConflictResolutionApi } from "@/api/curation.api";
import { useAuth } from "@/contexts/auth-context";
import {
  conflictRelationLabel,
  conflictResolutionLabel,
  conflictStatusLabel,
  mapConflictItem,
} from "@/domain/curation";
import { resourceTypeRu } from "@/domain/resource-type";
import { Button } from "@/ui/shadcn/button";
import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from "@app/(admin)/admin/AdminStateViews";

import { isConflictAccessAllowed } from "../ConflictsListClient";

export interface EvolvingMetaInput {
  existingValidUntil: string;
  newValidFrom: string;
}

const RESOLUTION_OPTIONS: readonly ConflictResolutionApi[] = [
  "accept_new",
  "keep_old",
  "merge",
  "evolving",
];

export function isResolveBlocked(
  resolution: ConflictResolutionApi,
  evolvingMeta: EvolvingMetaInput,
): string | null {
  if (resolution === "evolving") {
    if (
      !evolvingMeta.existingValidUntil.trim() ||
      !evolvingMeta.newValidFrom.trim()
    ) {
      return "Для «Эволюции» укажите обе даты: старое действовало до и новое действует с.";
    }
  }
  return null;
}

export function ConflictDetailClient({ conflictId }: { conflictId: string }) {
  const {
    isLoading: authLoading,
    currentOrgId,
    currentOrgRole,
    isSuperAdmin,
  } = useAuth();

  const conflictSwr = useSWR(["curation-conflict", conflictId], async () => {
    const api = await curationApi.getConflict(conflictId);
    return mapConflictItem(api);
  });

  if (
    authLoading ||
    (conflictSwr.isLoading && !conflictSwr.data && !conflictSwr.error)
  ) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <AdminLoading rows={6} />
      </div>
    );
  }

  if (!currentOrgId) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <AdminForbidden
          title="Нет организации"
          description="Вы не состоите ни в одной компании, поэтому конфликты недоступны."
        />
      </div>
    );
  }

  if (!isConflictAccessAllowed(isSuperAdmin, currentOrgRole)) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <AdminForbidden
          title="Доступ запрещён"
          description="Разрешать конфликты канонизации могут только владелец и администратор компании."
        />
        <Button asChild variant="ghost" className="mt-3 gap-1 text-fg-tertiary">
          <Link href="/curation/conflicts">
            <ChevronLeft size={16} /> К списку конфликтов
          </Link>
        </Button>
      </div>
    );
  }

  if (conflictSwr.error) {
    const notFound =
      conflictSwr.error instanceof ApiError &&
      (conflictSwr.error.code === "conflict_not_found" ||
        conflictSwr.error.code === "http_404" ||
        conflictSwr.error.code === "forbidden" ||
        conflictSwr.error.code === "http_403");
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        {notFound ? (
          <AdminForbidden
            title="Конфликт не найден"
            description="Конфликт не существует или у вас нет к нему доступа."
          />
        ) : (
          <AdminError
            message={
              conflictSwr.error instanceof ApiError
                ? conflictSwr.error.message
                : "Не удалось загрузить конфликт"
            }
            onRetry={() => void conflictSwr.mutate()}
          />
        )}
        <Button asChild variant="ghost" className="mt-3 gap-1 text-fg-tertiary">
          <Link href="/curation/conflicts">
            <ChevronLeft size={16} /> К списку конфликтов
          </Link>
        </Button>
      </div>
    );
  }

  const conflict = conflictSwr.data;
  if (!conflict) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <AdminLoading rows={6} />
      </div>
    );
  }

  return (
    <ConflictDetailView
      conflict={conflict}
      onAfterResolve={() => void conflictSwr.mutate()}
    />
  );
}

function ConflictDetailView({
  conflict,
  onAfterResolve,
}: {
  conflict: ReturnType<typeof mapConflictItem>;
  onAfterResolve: () => void;
}) {
  const router = useRouter();

  const [resolution, setResolution] =
    useState<ConflictResolutionApi>("accept_new");
  const [existingValidUntil, setExistingValidUntil] = useState("");
  const [newValidFrom, setNewValidFrom] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isOpen = conflict.status === "open";

  const blockReason = useMemo<string | null>(
    () => isResolveBlocked(resolution, { existingValidUntil, newValidFrom }),
    [resolution, existingValidUntil, newValidFrom],
  );

  const resolve = useCallback(async () => {
    if (blockReason) return;
    setSubmitting(true);
    try {
      await curationApi.resolveConflict(conflict.id, {
        resolution,
        ...(resolution === "evolving"
          ? {
              evolvingMeta: {
                existingValidUntil: new Date(existingValidUntil).toISOString(),
                newValidFrom: new Date(newValidFrom).toISOString(),
              },
            }
          : {}),
        ...(reasoning.trim() ? { reasoning: reasoning.trim() } : {}),
      });
      toast.success("Конфликт разрешён");
      onAfterResolve();
      router.push("/curation/conflicts");
    } catch (e) {
      toast.error(humanizeApiError(e, "Не удалось разрешить конфликт"));
    } finally {
      setSubmitting(false);
    }
  }, [
    blockReason,
    conflict.id,
    resolution,
    existingValidUntil,
    newValidFrom,
    reasoning,
    onAfterResolve,
    router,
  ]);

  const dismiss = useCallback(async () => {
    setSubmitting(true);
    try {
      await curationApi.dismissConflict(
        conflict.id,
        reasoning.trim() || undefined,
      );
      toast.success("Конфликт отклонён");
      onAfterResolve();
      router.push("/curation/conflicts");
    } catch (e) {
      toast.error(humanizeApiError(e, "Не удалось отклонить конфликт"));
    } finally {
      setSubmitting(false);
    }
  }, [conflict.id, reasoning, onAfterResolve, router]);

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <div className="mb-4">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="gap-1 text-fg-tertiary"
        >
          <Link href="/curation/conflicts">
            <ChevronLeft size={16} /> К списку конфликтов
          </Link>
        </Button>
      </div>

      {}
      <header className="mb-6">
        <div className="text-xs uppercase tracking-wide text-fg-tertiary">
          {resourceTypeRu(conflict.resourceType)}
        </div>
        <h1 className="mt-1 text-2xl font-semibold">Возможное противоречие</h1>
        <p className="mt-1 max-w-2xl text-sm text-fg-secondary">
          Кора заметила, что две карточки знания расходятся между собой.
          Посмотрите объяснение ниже и выберите, какую версию оставить.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-border-subtle bg-bg-overlay px-2 py-0.5 text-fg-secondary">
            {conflictStatusLabel(conflict.status)}
          </span>
          <span className="rounded-full border border-border-subtle bg-bg-overlay px-2 py-0.5 text-fg-secondary">
            {conflictRelationLabel(conflict.relationType)}
          </span>
          <span className="rounded-full border border-border-subtle bg-bg-overlay px-2 py-0.5 text-fg-secondary">
            Найдено автоматически
          </span>
        </div>
        <div className="mt-2 text-xs text-fg-tertiary">
          обнаружено {conflict.createdAt.toLocaleString("ru-RU")}
        </div>
      </header>

      {}
      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border-subtle bg-bg-card p-4">
          <div className="mb-1 text-xs uppercase tracking-wide text-fg-tertiary">
            Существующая карточка
          </div>
          <div className="text-sm font-medium text-fg-primary">
            {resourceTypeRu(conflict.resourceType)}
          </div>
          <div className="mt-1 break-all text-[11px] text-fg-tertiary">
            ID: {conflict.existingId}
          </div>
        </div>
        <div className="rounded-lg border border-accent/40 bg-accent/5 p-4">
          <div className="mb-1 text-xs uppercase tracking-wide text-fg-tertiary">
            Новая карточка
          </div>
          <div className="text-sm font-medium text-fg-primary">
            {resourceTypeRu(conflict.resourceType)}
          </div>
          <div className="mt-1 break-all text-[11px] text-fg-tertiary">
            ID: {conflict.newId}
          </div>
        </div>
      </section>

      {}
      <section className="mb-6">
        <h2 className="mb-1.5 text-sm font-medium">Почему Кора так решила</h2>
        <ConflictEvidence evidence={conflict.evidence} />
      </section>

      {}
      {conflict.status === "resolved" && conflict.resolution && (
        <section className="mb-6 space-y-1 rounded-lg border border-success/40 bg-success/5 p-4 text-sm">
          <div className="font-medium">
            Решение: {conflictResolutionLabel(conflict.resolution)}
          </div>
          {conflict.resolvedAt && (
            <div className="text-xs text-fg-tertiary">
              разрешён {conflict.resolvedAt.toLocaleString("ru-RU")}
            </div>
          )}
          {conflict.evolvingMeta && (
            <div className="text-xs text-fg-secondary">
              {conflict.evolvingMeta.existingValidUntil && (
                <span>
                  старое действовало до:{" "}
                  {new Date(
                    conflict.evolvingMeta.existingValidUntil,
                  ).toLocaleString("ru-RU")}
                </span>
              )}
              {conflict.evolvingMeta.newValidFrom && (
                <span className="ml-2">
                  новое действует с:{" "}
                  {new Date(conflict.evolvingMeta.newValidFrom).toLocaleString(
                    "ru-RU",
                  )}
                </span>
              )}
            </div>
          )}
          {conflict.reasoning && (
            <p className="text-xs text-fg-secondary">{conflict.reasoning}</p>
          )}
        </section>
      )}

      {conflict.status === "dismissed" && (
        <section className="mb-6 space-y-1 rounded-lg border border-border-subtle bg-bg-overlay p-4 text-sm">
          <div className="font-medium">Конфликт отклонён</div>
          {conflict.resolvedAt && (
            <div className="text-xs text-fg-tertiary">
              {conflict.resolvedAt.toLocaleString("ru-RU")}
            </div>
          )}
          {conflict.reasoning && (
            <p className="text-xs text-fg-secondary">{conflict.reasoning}</p>
          )}
        </section>
      )}

      {}
      {isOpen ? (
        <section className="space-y-3 rounded-lg border border-border-subtle bg-bg-card p-5">
          <h2 className="text-sm font-medium">Разрешить конфликт</h2>

          <div>
            <label
              htmlFor="conflict-resolution"
              className="mb-1 block text-xs text-fg-tertiary"
            >
              Способ разрешения
            </label>
            <select
              id="conflict-resolution"
              value={resolution}
              onChange={(e) =>
                setResolution(e.target.value as ConflictResolutionApi)
              }
              className="w-full rounded-md border border-border-subtle bg-bg-input px-2 py-1.5 text-sm"
            >
              {RESOLUTION_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {conflictResolutionLabel(r)}
                </option>
              ))}
            </select>
          </div>

          {resolution === "evolving" && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="conflict-existing-valid-until"
                  className="mb-1 block text-xs text-fg-tertiary"
                >
                  Старое действовало до
                </label>
                <input
                  id="conflict-existing-valid-until"
                  type="datetime-local"
                  value={existingValidUntil}
                  onChange={(e) => setExistingValidUntil(e.target.value)}
                  className="w-full rounded-md border border-border-subtle bg-bg-input px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="conflict-new-valid-from"
                  className="mb-1 block text-xs text-fg-tertiary"
                >
                  Новое действует с
                </label>
                <input
                  id="conflict-new-valid-from"
                  type="datetime-local"
                  value={newValidFrom}
                  onChange={(e) => setNewValidFrom(e.target.value)}
                  className="w-full rounded-md border border-border-subtle bg-bg-input px-2 py-1.5 text-sm"
                />
              </div>
            </div>
          )}

          <div>
            <label
              htmlFor="conflict-reasoning"
              className="mb-1 block text-xs text-fg-tertiary"
            >
              Обоснование (опц.)
            </label>
            <textarea
              id="conflict-reasoning"
              value={reasoning}
              onChange={(e) => setReasoning(e.target.value)}
              placeholder="Почему вы приняли такое решение"
              rows={3}
              className="w-full rounded-md border border-border-subtle bg-bg-input p-2 text-sm"
            />
          </div>

          {blockReason && <p className="text-xs text-warning">{blockReason}</p>}

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => void dismiss()}
              disabled={submitting}
            >
              {submitting ? "Сохраняем…" : "Отклонить"}
            </Button>
            <Button
              onClick={() => void resolve()}
              disabled={submitting || !!blockReason}
            >
              {submitting ? "Сохраняем…" : "Разрешить"}
            </Button>
          </div>
        </section>
      ) : (
        <section className="rounded-lg border border-dashed border-border-subtle p-6 text-center text-sm text-fg-tertiary">
          Этот конфликт уже закрыт.
        </section>
      )}
    </div>
  );
}

function ConflictEvidence({ evidence }: { evidence: Record<string, unknown> }) {
  const explanation =
    typeof evidence.explanation === "string" ? evidence.explanation.trim() : "";
  const confidence =
    typeof evidence.confidence === "number" ? evidence.confidence : null;

  return (
    <div className="space-y-2 rounded-lg border border-border-subtle bg-bg-card p-4 text-sm">
      <p className="leading-relaxed text-fg-secondary">
        {explanation ||
          "Кора нашла возможное противоречие между двумя карточками знания."}
      </p>
      {confidence !== null ? (
        <p className="text-xs text-fg-tertiary">
          Уверенность Коры: {Math.round(confidence * 100)}%
        </p>
      ) : null}
    </div>
  );
}
