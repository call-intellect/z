"use client";

import { useState } from "react";

import Link from "next/link";

import { ApiError } from "@/api/api-error";
import { adminEconomicsApi } from "@/api/admin-economics.api";
import type { AdminOrgBudgetApi, UpdateOrgBudgetRequest } from "@/domain/admin-economics";
import { toast } from "sonner";
import { Button } from "@/ui/shadcn/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/shadcn/card";
import { Input } from "@/ui/shadcn/input";
import { Label } from "@/ui/shadcn/label";

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from "../../../AdminStateViews";
import { useAdminQuery } from "../../../useAdminQuery";

export function OrgEconomicsDetailClient({ tenantId }: { tenantId: string }) {
  const q = useAdminQuery(
    `admin-economics-org-budget:${tenantId}`,
    () => adminEconomicsApi.getBudget(tenantId),
    [tenantId],
  );

  const [editing, setEditing] = useState(false);

  const onSaveBudget = async (body: UpdateOrgBudgetRequest) => {
    try {
      await adminEconomicsApi.setBudget(tenantId, body);
      toast.success("Бюджет сохранён");
      setEditing(false);
      q.refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Не удалось сохранить");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{tenantId}</h1>
        <p className="text-sm text-fg-tertiary">
          Бюджет-лимит компании на AI-расход.
        </p>
      </div>

      {q.isLoading && <AdminLoading rows={4} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading && !q.isForbidden && !q.error && (
        <OrgDetail
          tenantId={tenantId}
          budget={q.data}
          editing={editing}
          onEdit={() => setEditing(true)}
          onCancel={() => setEditing(false)}
          onSave={onSaveBudget}
        />
      )}
    </div>
  );
}

function OrgDetail({
  tenantId,
  budget,
  editing,
  onEdit,
  onCancel,
  onSave,
}: {
  tenantId: string;
  budget: AdminOrgBudgetApi | null;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (body: UpdateOrgBudgetRequest) => Promise<void>;
}) {
  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Бюджет</CardTitle>
            {!editing && (
              <Button size="sm" variant="outline" onClick={onEdit}>
                {budget ? "Изменить" : "Установить"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {editing ? (
            <BudgetForm budget={budget} onSave={onSave} onCancel={onCancel} />
          ) : budget ? (
            <BudgetView budget={budget} />
          ) : (
            <p className="text-sm text-fg-tertiary">
              Лимит не установлен. Алерты не отправляются.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Расход AI</CardTitle>
        </CardHeader>
        <CardContent>
          <Link
            href={`/admin/analytics/llm-cost?view=company&id=${encodeURIComponent(tenantId)}`}
            className="text-accent hover:underline"
          >
            Смотреть расход этой компании →
          </Link>
        </CardContent>
      </Card>
    </>
  );
}

function BudgetView({ budget }: { budget: AdminOrgBudgetApi }) {
  return (
    <div className="space-y-2 text-sm">
      <div>
        Лимит:{" "}
        <strong>
          {budget.monthlyCapRub != null
            ? Number(budget.monthlyCapRub).toLocaleString("ru-RU")
            : "—"}{" "}
          ₽/мес
        </strong>{" "}
        ({budget.capKind})
      </div>
      <div>Пороги алертов: {budget.alertThresholds.join("%, ")}%</div>
      {budget.lastAlertAt && (
        <div className="text-xs text-fg-tertiary">
          Последний алерт: {new Date(budget.lastAlertAt).toLocaleString("ru-RU")}{" "}
          (порог {budget.lastAlertThreshold}%)
        </div>
      )}
    </div>
  );
}

function BudgetForm({
  budget,
  onSave,
  onCancel,
}: {
  budget: AdminOrgBudgetApi | null;
  onSave: (body: UpdateOrgBudgetRequest) => Promise<void>;
  onCancel: () => void;
}) {
  const [monthlyCap, setMonthlyCap] = useState(
    budget?.monthlyCapRub != null ? String(budget.monthlyCapRub) : "",
  );
  const [capKind, setCapKind] = useState<"soft" | "hard" | "downgrade">(
    (budget?.capKind as "soft" | "hard" | "downgrade") ?? "soft",
  );
  const [thresholdsStr, setThresholdsStr] = useState(
    (budget?.alertThresholds ?? [80, 100]).join(","),
  );

  const handleSubmit = () => {
    const numCap = monthlyCap.trim() === "" ? null : Number(monthlyCap);
    const thresholds = thresholdsStr
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    void onSave({
      monthlyCapRub: numCap,
      capKind,
      alertThresholds: thresholds.length > 0 ? thresholds : [80, 100],
    });
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">
          Месячный лимит, ₽ (0 или пусто = без лимита)
        </Label>
        <Input
          value={monthlyCap}
          onChange={(e) => setMonthlyCap(e.target.value)}
          type="number"
        />
      </div>
      <div>
        <Label className="text-xs">Тип лимита</Label>
        <select
          value={capKind}
          onChange={(e) =>
            setCapKind(e.target.value as "soft" | "hard" | "downgrade")
          }
          className="block w-full rounded border border-border-subtle bg-bg-card px-2 py-1 text-sm"
        >
          <option value="soft">soft (только alert)</option>
          <option value="hard">hard (заблокировать AI)</option>
          <option value="downgrade">
            Экономный — переходить на более дешёвую модель
          </option>
        </select>
      </div>
      <div>
        <Label className="text-xs">Пороги алертов через запятую (%)</Label>
        <Input
          value={thresholdsStr}
          onChange={(e) => setThresholdsStr(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSubmit}>
          Сохранить
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </div>
  );
}
