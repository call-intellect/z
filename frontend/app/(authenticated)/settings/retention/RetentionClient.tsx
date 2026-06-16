"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";

import { ApiError, humanizeApiError } from "@/api/api-error";
import { retentionApi } from "@/api/retention.api";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "sonner";
import {
  ARCHIVED_BLOCK_ACTIONS,
  RETENTION_LIMITS,
  archivedBlockActionHint,
  archivedBlockActionLabel,
  retentionPolicyFromApi,
  type ArchivedBlockAction,
  type OrgRetentionPolicyDomain,
  type UpdateRetentionPolicyRequest,
} from "@/domain/retention";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { Label } from "@/ui/shadcn/label";

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from "@app/(admin)/admin/AdminStateViews";

export function RetentionClient() {
  const { currentOrgId, currentOrgRole, isLoading: authLoading } = useAuth();
  const isOwner = currentOrgRole === "owner";

  if (authLoading) return <AdminLoading rows={4} />;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Вы не состоите ни в одной организации. Попросите владельца пригласить вас."
      />
    );
  }
  if (!isOwner) {
    return (
      <AdminForbidden
        title="Только для владельца организации"
        description="Только владелец организации может управлять политикой хранения данных. Обратитесь к нему."
      />
    );
  }

  return <RetentionForm orgId={currentOrgId} />;
}

function RetentionForm({ orgId }: { orgId: string }) {
  const [policy, setPolicy] = useState<OrgRetentionPolicyDomain | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [saving, setSaving] = useState(false);

  const [rawEventDays, setRawEventDays] = useState("");
  const [archivedBlockDays, setArchivedBlockDays] = useState("");
  const [chatMessageDays, setChatMessageDays] = useState("");
  const [auditLogDays, setAuditLogDays] = useState("");
  const [archivedBlockAction, setArchivedBlockAction] =
    useState<ArchivedBlockAction>("archive_then_delete");

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const dto = await retentionApi.get(orgId);
      const domain = retentionPolicyFromApi(dto);
      setPolicy(domain);
      setRawEventDays(String(domain.rawEventDays));
      setArchivedBlockDays(String(domain.archivedBlockDays));
      setChatMessageDays(String(domain.chatMessageDays));
      setAuditLogDays(String(domain.auditLogDays));
      setArchivedBlockAction(domain.archivedBlockAction);
    } catch (e) {
      if (e instanceof ApiError && e.code === "forbidden") {
        setForbidden(true);
      } else {
        setError(humanizeApiError(e, "Не удалось загрузить политику"));
      }
    } finally {
      setIsLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    if (!policy) return;

    const ints = parseFormInts({
      rawEventDays,
      archivedBlockDays,
      chatMessageDays,
      auditLogDays,
    });
    if (ints.error !== null) {
      toast.error(ints.error);
      return;
    }

    const values = ints.values;
    const body: UpdateRetentionPolicyRequest = {};

    if (values.rawEventDays !== policy.rawEventDays) {
      body.rawEventDays = values.rawEventDays;
    }
    if (values.archivedBlockDays !== policy.archivedBlockDays) {
      body.archivedBlockDays = values.archivedBlockDays;
    }
    if (values.chatMessageDays !== policy.chatMessageDays) {
      body.chatMessageDays = values.chatMessageDays;
    }
    if (values.auditLogDays !== policy.auditLogDays) {
      body.auditLogDays = values.auditLogDays;
    }
    if (archivedBlockAction !== policy.archivedBlockAction) {
      body.archivedBlockAction = archivedBlockAction;
    }

    if (Object.keys(body).length === 0) {
      toast("Нет изменений для сохранения");
      return;
    }

    setSaving(true);
    try {
      const dto = await retentionApi.update(orgId, body);
      const domain = retentionPolicyFromApi(dto);
      setPolicy(domain);
      toast.success("Политика хранения сохранена");
    } catch (e) {
      toast.error(humanizeApiError(e, "Не удалось сохранить"));
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <AdminLoading rows={6} />;
  if (forbidden) return <AdminForbidden />;
  if (error) return <AdminError message={error} onRetry={load} />;
  if (!policy) return null;

  return (
    <div className="w-full space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Хранение данных и 152-ФЗ</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Управление сроками хранения исходных событий, архивных блоков, чатов и
          журнала аудита для вашей организации.
        </p>
      </header>

      <section className="flex gap-3 rounded-lg border border-border-subtle bg-bg-overlay p-4 text-sm text-fg-secondary">
        <ShieldCheck
          size={20}
          strokeWidth={1.75}
          className="mt-0.5 shrink-0 text-accent"
        />
        <div className="space-y-1">
          <p>
            По умолчанию исходные события (RawEvent) хранятся 7 лет (2555 дней)
            — это базовое требование 152-ФЗ. Сократить нельзя ниже 30 дней.
          </p>
          <p>
            После наступления срока данные удаляются ежечасным sweep&rsquo;ом
            (RetentionCron). Удаление необратимо.
          </p>
        </div>
      </section>

      <section className="space-y-5 rounded-lg border border-border-subtle bg-bg-card p-5">
        <h2 className="text-base font-medium">Сроки хранения (в днях)</h2>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <RetentionField
            id="raw-event-days"
            label="Сырые события (RawEvent)"
            hint={`Минимум — ${RETENTION_LIMITS.rawEventDays.min} дней. По 152-ФЗ рекомендуется 2555 (7 лет).`}
            value={rawEventDays}
            onChange={setRawEventDays}
            min={RETENTION_LIMITS.rawEventDays.min}
          />
          <RetentionField
            id="archived-block-days"
            label="Архивные блоки знаний"
            hint={`Минимум — ${RETENTION_LIMITS.archivedBlockDays.min} день. Влияет только на блоки в статусе archived.`}
            value={archivedBlockDays}
            onChange={setArchivedBlockDays}
            min={RETENTION_LIMITS.archivedBlockDays.min}
          />
          <RetentionField
            id="chat-message-days"
            label="Чат-сообщения встреч"
            hint={`Минимум — ${RETENTION_LIMITS.chatMessageDays.min} дней.`}
            value={chatMessageDays}
            onChange={setChatMessageDays}
            min={RETENTION_LIMITS.chatMessageDays.min}
          />
          <RetentionField
            id="audit-log-days"
            label="Журнал аудита (AuditLog)"
            hint={`Минимум — ${RETENTION_LIMITS.auditLogDays.min} день. Compliance-критичные события рекомендуется хранить ≥ 730 дней.`}
            value={auditLogDays}
            onChange={setAuditLogDays}
            min={RETENTION_LIMITS.auditLogDays.min}
          />
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-border-subtle bg-bg-card p-5">
        <h2 className="text-base font-medium">
          Действие при истечении срока архивных блоков
        </h2>
        <ul className="space-y-2">
          {ARCHIVED_BLOCK_ACTIONS.map((action) => (
            <li key={action}>
              <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border-subtle p-3 hover:bg-bg-overlay">
                <input
                  type="radio"
                  name="archived-block-action"
                  value={action}
                  checked={archivedBlockAction === action}
                  onChange={() => setArchivedBlockAction(action)}
                  className="mt-1 h-4 w-4 cursor-pointer accent-accent"
                />
                <span className="flex-1 space-y-0.5">
                  <span className="block text-sm font-medium text-fg-primary">
                    {archivedBlockActionLabel[action]}
                  </span>
                  <span className="block text-xs text-fg-tertiary">
                    {archivedBlockActionHint[action]}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-border-subtle bg-bg-card p-5">
        <h2 className="text-base font-medium">Состояние</h2>
        <div className="mt-3 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-fg-tertiary">Последняя очистка:</span>
            <span className="tabular-nums">
              {policy.lastSweepAt
                ? formatRelative(policy.lastSweepAt)
                : "никогда"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-fg-tertiary">Изменено:</span>
            <span className="tabular-nums">
              {policy.updatedAt.toLocaleString("ru-RU")}
            </span>
          </div>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Loader2 size={14} className="mr-1.5 animate-spin" />
              Сохраняем…
            </>
          ) : (
            "Сохранить"
          )}
        </Button>
      </div>
    </div>
  );
}

function RetentionField({
  id,
  label,
  hint,
  value,
  onChange,
  min,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  min: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={36500}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono"
      />
      <p className="text-xs text-fg-tertiary">{hint}</p>
    </div>
  );
}

type ParseResult =
  | {
      error: null;
      values: {
        rawEventDays: number;
        archivedBlockDays: number;
        chatMessageDays: number;
        auditLogDays: number;
      };
    }
  | {
      error: string;
      values: {
        rawEventDays: number;
        archivedBlockDays: number;
        chatMessageDays: number;
        auditLogDays: number;
      };
    };

function parseFormInts(input: {
  rawEventDays: string;
  archivedBlockDays: string;
  chatMessageDays: string;
  auditLogDays: string;
}): ParseResult {
  const fields: Array<{
    key: keyof typeof RETENTION_LIMITS;
    label: string;
    raw: string;
  }> = [
    { key: "rawEventDays", label: "Сырые события", raw: input.rawEventDays },
    {
      key: "archivedBlockDays",
      label: "Архивные блоки",
      raw: input.archivedBlockDays,
    },
    {
      key: "chatMessageDays",
      label: "Чат-сообщения",
      raw: input.chatMessageDays,
    },
    { key: "auditLogDays", label: "Журнал аудита", raw: input.auditLogDays },
  ];

  const out = {
    rawEventDays: 0,
    archivedBlockDays: 0,
    chatMessageDays: 0,
    auditLogDays: 0,
  };

  for (const f of fields) {
    const trimmed = f.raw.trim();
    if (!trimmed) {
      return { error: `Поле «${f.label}» не может быть пустым`, values: out };
    }
    const n = Number(trimmed);
    if (!Number.isInteger(n)) {
      return {
        error: `Поле «${f.label}» должно быть целым числом`,
        values: out,
      };
    }
    const limits = RETENTION_LIMITS[f.key];
    if (n < limits.min) {
      return {
        error: `Поле «${f.label}» не может быть меньше ${limits.min} дн.`,
        values: out,
      };
    }
    if (n > limits.max) {
      return {
        error: `Поле «${f.label}» не может быть больше ${limits.max} дн.`,
        values: out,
      };
    }
    out[f.key] = n;
  }

  return { error: null, values: out };
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return date.toLocaleString("ru-RU");
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} дн назад`;
  return date.toLocaleString("ru-RU");
}
