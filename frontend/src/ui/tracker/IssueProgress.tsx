"use client";

import { Check, Loader2, Pencil, Sparkles, X } from "lucide-react";
import { useCallback, useState } from "react";

import { progressUpdatesApi } from "@/api/tracker/progress-updates.api";
import {
  PROGRESS_HEALTH_CHIP,
  PROGRESS_HEALTH_DOT,
  PROGRESS_HEALTH_LABELS,
  progressUpdateDateLabel,
  type ProgressHealth,
  type ProgressUpdate,
} from "@/domain/tracker";
import { useProgressUpdates } from "@/hooks/tracker/useProgressUpdates";
import { cn } from "@/ui/shadcn/lib/utils";
import { Button } from "@/ui/shadcn/button";
import { Textarea } from "@/ui/shadcn/textarea";
import { ProvenancePreviewSnippet } from "@/ui/components/provenance/ProvenancePreviewSnippet";

const HEALTH_ORDER: ProgressHealth[] = ["on_track", "at_risk", "off_track"];

export interface IssueProgressProps {
  orgId: string;
  issueId: string;
}

export function IssueProgress({ orgId, issueId }: IssueProgressProps) {
  const { updates, isLoading, error, mutate } = useProgressUpdates(
    orgId,
    issueId,
  );

  const drafts = updates.filter((u) => u.isDraft && u.isAiAuthored);
  const published = updates.filter((u) => !(u.isDraft && u.isAiAuthored));

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {[...Array(2)].map((_, i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-md border border-border-subtle bg-bg-elevated"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-sm text-danger">
          Не удалось загрузить прогресс.
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void mutate()}
          className="self-start"
        >
          Повторить
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {drafts.map((draft) => (
        <DraftCard
          key={draft.id}
          orgId={orgId}
          draft={draft}
          onChanged={() => void mutate()}
        />
      ))}

      {published.length === 0 ? (
        <div className="text-sm text-fg-tertiary">
          Обновлений прогресса пока нет. Добавьте первое — коротко опишите, что
          сделано и что дальше.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {published.map((u) => (
            <ProgressItem key={u.id} update={u} />
          ))}
        </ul>
      )}

      <CreateProgressForm
        orgId={orgId}
        issueId={issueId}
        onCreated={() => void mutate()}
      />
    </div>
  );
}

function HealthBadge({ health }: { health: ProgressHealth }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium",
        PROGRESS_HEALTH_CHIP[health],
      )}
    >
      <span
        className={cn(
          "inline-block h-2 w-2 rounded-full",
          PROGRESS_HEALTH_DOT[health],
        )}
        aria-hidden
      />
      {PROGRESS_HEALTH_LABELS[health]}
    </span>
  );
}

function ProgressItem({ update }: { update: ProgressUpdate }) {
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-elevated px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <HealthBadge health={update.health} />
        <span className="text-[10px] text-fg-tertiary">
          {progressUpdateDateLabel(update.createdAt)}
        </span>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm text-fg-primary">
        {update.body}
      </p>
      {update.doneText ? (
        <div className="text-xs text-fg-secondary">
          <span className="font-medium text-fg-primary">Сделано: </span>
          <span className="whitespace-pre-wrap break-words">
            {update.doneText}
          </span>
        </div>
      ) : null}
      {update.nextText ? (
        <div className="text-xs text-fg-secondary">
          <span className="font-medium text-fg-primary">Дальше: </span>
          <span className="whitespace-pre-wrap break-words">
            {update.nextText}
          </span>
        </div>
      ) : null}
      {update.provenancePreview ? (
        <ProvenancePreviewSnippet preview={update.provenancePreview} />
      ) : null}
    </li>
  );
}

function DraftCard({
  orgId,
  draft,
  onChanged,
}: {
  orgId: string;
  draft: ProgressUpdate;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [health, setHealth] = useState<ProgressHealth>(draft.health);
  const [body, setBody] = useState(draft.body);
  const [doneText, setDoneText] = useState(draft.doneText ?? "");
  const [nextText, setNextText] = useState(draft.nextText ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleConfirmAsIs = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await progressUpdatesApi.confirm(orgId, draft.id);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось подтвердить");
    } finally {
      setBusy(false);
    }
  }, [busy, draft.id, onChanged, orgId]);

  const handleConfirmEdited = useCallback(async () => {
    const trimmed = body.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await progressUpdatesApi.confirm(orgId, draft.id, {
        health,
        body: trimmed,
        doneText: doneText.trim() ? doneText.trim() : null,
        nextText: nextText.trim() ? nextText.trim() : null,
      });
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }, [body, busy, doneText, draft.id, health, nextText, onChanged, orgId]);

  const handleReject = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await progressUpdatesApi.remove(orgId, draft.id);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось отклонить");
    } finally {
      setBusy(false);
    }
  }, [busy, draft.id, onChanged, orgId]);

  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-accent-border bg-accent-muted px-3 py-3">
      <div className="flex items-center gap-2">
        <Sparkles size={14} className="shrink-0 text-accent" aria-hidden />
        <span className="text-xs font-medium text-fg-primary">
          Кора собрала черновик прогресса
        </span>
        <span className="ml-auto text-[10px] text-fg-tertiary">
          {progressUpdateDateLabel(draft.createdAt)}
        </span>
      </div>
      <p className="text-[11px] text-fg-secondary">
        Можно подтвердить как есть, поправить или отклонить — без вашего слова
        ничего не публикуется.
      </p>

      {editing ? (
        <div className="flex flex-col gap-2">
          <HealthPicker value={health} onChange={setHealth} disabled={busy} />
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            disabled={busy}
            placeholder="Что по задаче"
            className="resize-none"
          />
          <Textarea
            value={doneText}
            onChange={(e) => setDoneText(e.target.value)}
            rows={2}
            disabled={busy}
            placeholder="Сделано (необязательно)"
            className="resize-none"
          />
          <Textarea
            value={nextText}
            onChange={(e) => setNextText(e.target.value)}
            rows={2}
            disabled={busy}
            placeholder="Дальше (необязательно)"
            className="resize-none"
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <HealthBadge health={draft.health} />
          <p className="whitespace-pre-wrap break-words text-sm text-fg-primary">
            {draft.body}
          </p>
          {draft.doneText ? (
            <div className="text-xs text-fg-secondary">
              <span className="font-medium text-fg-primary">Сделано: </span>
              <span className="whitespace-pre-wrap break-words">
                {draft.doneText}
              </span>
            </div>
          ) : null}
          {draft.nextText ? (
            <div className="text-xs text-fg-secondary">
              <span className="font-medium text-fg-primary">Дальше: </span>
              <span className="whitespace-pre-wrap break-words">
                {draft.nextText}
              </span>
            </div>
          ) : null}
        </div>
      )}

      {draft.provenancePreview ? (
        <ProvenancePreviewSnippet preview={draft.provenancePreview} />
      ) : null}

      {err ? <div className="text-xs text-danger">{err}</div> : null}

      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <Button
              size="sm"
              onClick={() => void handleConfirmEdited()}
              disabled={busy || body.trim().length === 0}
              className="gap-1.5"
            >
              {busy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Check size={14} />
              )}
              Сохранить и подтвердить
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
              disabled={busy}
            >
              Отмена
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              onClick={() => void handleConfirmAsIs()}
              disabled={busy}
              className="gap-1.5"
            >
              {busy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Check size={14} />
              )}
              Подтвердить
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setEditing(true)}
              disabled={busy}
              className="gap-1.5"
            >
              <Pencil size={14} />
              Поправить
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void handleReject()}
              disabled={busy}
              className="gap-1.5"
            >
              <X size={14} />
              Отклонить
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function HealthPicker({
  value,
  onChange,
  disabled,
}: {
  value: ProgressHealth;
  onChange: (h: ProgressHealth) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {HEALTH_ORDER.map((h) => {
        const active = h === value;
        return (
          <button
            key={h}
            type="button"
            disabled={disabled}
            onClick={() => onChange(h)}
            className={cn(
              "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50",
              active
                ? PROGRESS_HEALTH_CHIP[h]
                : "bg-bg-overlay text-fg-secondary hover:text-fg-primary",
            )}
          >
            <span
              className={cn(
                "inline-block h-2 w-2 rounded-full",
                PROGRESS_HEALTH_DOT[h],
              )}
              aria-hidden
            />
            {PROGRESS_HEALTH_LABELS[h]}
          </button>
        );
      })}
    </div>
  );
}

function CreateProgressForm({
  orgId,
  issueId,
  onCreated,
}: {
  orgId: string;
  issueId: string;
  onCreated: () => void;
}) {
  const [health, setHealth] = useState<ProgressHealth>("on_track");
  const [body, setBody] = useState("");
  const [doneText, setDoneText] = useState("");
  const [nextText, setNextText] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    const trimmed = body.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setErr(null);
    try {
      await progressUpdatesApi.create(orgId, issueId, {
        health,
        body: trimmed,
        ...(doneText.trim() ? { doneText: doneText.trim() } : {}),
        ...(nextText.trim() ? { nextText: nextText.trim() } : {}),
      });
      setBody("");
      setDoneText("");
      setNextText("");
      setHealth("on_track");
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось добавить");
    } finally {
      setSaving(false);
    }
  }, [body, doneText, health, issueId, nextText, onCreated, orgId, saving]);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-elevated p-3">
      <span className="text-xs font-medium text-fg-secondary">
        Добавить обновление
      </span>
      <HealthPicker value={health} onChange={setHealth} disabled={saving} />
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        disabled={saving}
        placeholder="Что по задаче сейчас"
        className="resize-none"
      />
      <Textarea
        value={doneText}
        onChange={(e) => setDoneText(e.target.value)}
        rows={2}
        disabled={saving}
        placeholder="Сделано (необязательно)"
        className="resize-none"
      />
      <Textarea
        value={nextText}
        onChange={(e) => setNextText(e.target.value)}
        rows={2}
        disabled={saving}
        placeholder="Дальше (необязательно)"
        className="resize-none"
      />
      {err ? <div className="text-xs text-danger">{err}</div> : null}
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => void handleSubmit()}
          disabled={saving || body.trim().length === 0}
          className="gap-2"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          Добавить
        </Button>
      </div>
    </div>
  );
}
