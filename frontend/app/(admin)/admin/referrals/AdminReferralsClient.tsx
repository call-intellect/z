"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  Users,
  XCircle,
} from "lucide-react";

import { ApiError } from "@/api/api-error";
import { referralsApi } from "@/api/referrals.api";
import type { ReferralPayoutApi, ReferralViewApi } from "@/api/types/referrals";
import { formatRubles } from "@/domain/billing";
import {
  isFullyVerified,
  legalFormLabel,
  payoutStatusColor,
  payoutStatusLabel,
  referralFromApi,
  referralPayoutFromApi,
  type ReferralPayoutDomain,
} from "@/domain/referral";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { Skeleton } from "@/ui/shadcn/skeleton";

type Tab = "referrals" | "payouts";

interface ReferralWithOwner extends ReferralViewApi {
  owner: { id: string; email: string; name: string };
}

export function AdminReferralsClient() {
  const [tab, setTab] = useState<Tab>("referrals");

  return (
    <div className="p-6 max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Users className="w-6 h-6" />
          Реферальная программа
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Управление профилями рефералов и начислениями (20 000 ₽ за каждый
          paid-инвойс приведённого клиента).
        </p>
      </div>

      <div className="border-b flex gap-1">
        <TabBtn
          active={tab === "referrals"}
          onClick={() => setTab("referrals")}
        >
          Рефералы
        </TabBtn>
        <TabBtn active={tab === "payouts"} onClick={() => setTab("payouts")}>
          Начисления
        </TabBtn>
      </div>

      {tab === "referrals" ? <ReferralsTab /> : <PayoutsTab />}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "px-4 py-2 text-sm font-medium border-b-2 transition-colors " +
        (active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground")
      }
    >
      {children}
    </button>
  );
}

function ReferralsTab() {
  const [items, setItems] = useState<ReferralWithOwner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await referralsApi.adminListReferrals({ limit: 200 });
      setItems(res.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Skeleton className="h-64" />;
  if (error) return <ErrorBlock message={error} />;
  if (items.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        Пока нет ни одного реферального профиля.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="text-left px-6 py-3 font-medium">Owner</th>
            <th className="text-left px-6 py-3 font-medium">Slug</th>
            <th className="text-left px-6 py-3 font-medium">ИНН</th>
            <th className="text-left px-6 py-3 font-medium">Форма</th>
            <th className="text-left px-6 py-3 font-medium">Верификация</th>
            <th className="text-left px-6 py-3 font-medium">Создан</th>
          </tr>
        </thead>
        <tbody>
          {items.map((api) => {
            const r = referralFromApi(api);
            const verified = isFullyVerified(r);
            return (
              <tr key={r.id} className="border-t">
                <td className="px-6 py-3">
                  <div className="font-medium">{api.owner.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {api.owner.email}
                  </div>
                </td>
                <td className="px-6 py-3 font-mono text-xs">{r.slug}</td>
                <td className="px-6 py-3 font-mono">{r.inn}</td>
                <td className="px-6 py-3">{legalFormLabel(r.legalForm)}</td>
                <td className="px-6 py-3">
                  <Badge
                    className={
                      verified
                        ? "bg-green-100 text-green-900"
                        : "bg-amber-100 text-amber-900"
                    }
                  >
                    {verified ? (
                      <span className="inline-flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3" /> Готов
                      </span>
                    ) : !r.innVerifiedAt && !r.contractAcceptedAt ? (
                      "Без верификации"
                    ) : !r.innVerifiedAt ? (
                      "ИНН не подтверждён"
                    ) : (
                      "Оферта не принята"
                    )}
                  </Badge>
                </td>
                <td className="px-6 py-3 text-muted-foreground">
                  {r.createdAt.toLocaleDateString("ru-RU")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PayoutsTab() {
  const [items, setItems] = useState<ReferralPayoutApi[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "pending" | "paid" | "void"
  >("pending");
  const [periodMonth, setPeriodMonth] = useState("");
  const [action, setAction] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await referralsApi.adminListPayouts({
        status: statusFilter === "all" ? undefined : statusFilter,
        periodMonth: periodMonth.trim() || undefined,
        limit: 200,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, periodMonth]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleMarkPaid = async (id: string) => {
    const docUrl = window.prompt(
      "URL акта / чека НПД / счёта ИП в S3 (опционально):",
      "",
    );
    setAction(`paid:${id}`);
    try {
      await referralsApi.adminMarkPayoutPaid(id, {
        payoutDocumentUrl: docUrl?.trim() || undefined,
      });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ошибка");
    } finally {
      setAction(null);
    }
  };

  const handleVoid = async (id: string) => {
    const reason = window.prompt("Причина отмены (обязательно):", "");
    if (!reason || reason.trim().length < 3) {
      setError("Причина обязательна (≥3 символа)");
      return;
    }
    setAction(`void:${id}`);
    try {
      await referralsApi.adminVoidPayout(id, { voidReason: reason.trim() });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ошибка");
    } finally {
      setAction(null);
    }
  };

  const handleClosePeriod = async () => {
    if (!periodMonth.match(/^\d{4}-\d{2}$/)) {
      setError("periodMonth должен быть в формате YYYY-MM");
      return;
    }
    if (
      !window.confirm(
        `Закрыть период ${periodMonth}?\n\n` +
          `Все pending-payouts: верифицированные → paid; не-верифицированные → void.`,
      )
    ) {
      return;
    }
    setAction("close");
    try {
      const result = await referralsApi.adminClosePeriod(periodMonth);
      alert(
        `Период ${periodMonth} закрыт:\n` +
          `  • paid:    ${result.paid}\n` +
          `  • voided:  ${result.voided}\n` +
          `  • skipped: ${result.skipped}`,
      );
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ошибка");
    } finally {
      setAction(null);
    }
  };

  const colorClass: Record<string, string> = {
    green: "bg-green-100 text-green-900",
    amber: "bg-amber-100 text-amber-900",
    red: "bg-red-100 text-red-900",
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">
            Статус
          </label>
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(
                e.target.value as "all" | "pending" | "paid" | "void",
              )
            }
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="all">Все</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="void">Void</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">
            Период (YYYY-MM)
          </label>
          <Input
            value={periodMonth}
            onChange={(e) => setPeriodMonth(e.target.value)}
            placeholder="2026-05"
            className="w-32"
            maxLength={7}
          />
        </div>
        <Button variant="outline" onClick={() => void load()}>
          Обновить
        </Button>
        <div className="grow" />
        <Button
          variant="destructive"
          onClick={handleClosePeriod}
          disabled={action !== null || !periodMonth.match(/^\d{4}-\d{2}$/)}
        >
          {action === "close" && <Loader2 className="w-4 h-4 animate-spin" />}
          Закрыть период
        </Button>
      </div>

      {error && <ErrorBlock message={error} />}

      <div className="text-xs text-muted-foreground">
        Всего: <strong>{total}</strong>
      </div>

      {loading ? (
        <Skeleton className="h-64" />
      ) : items.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          Начислений нет по выбранным фильтрам.
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Период</th>
                <th className="text-left px-4 py-3 font-medium">Сумма</th>
                <th className="text-left px-4 py-3 font-medium">Статус</th>
                <th className="text-left px-4 py-3 font-medium">Создан</th>
                <th className="text-left px-4 py-3 font-medium">Выплачен</th>
                <th className="text-right px-4 py-3 font-medium">Действия</th>
              </tr>
            </thead>
            <tbody>
              {items.map((api) => {
                const p: ReferralPayoutDomain = referralPayoutFromApi(api);
                return (
                  <tr key={p.id} className="border-t">
                    <td className="px-4 py-3 font-mono">{p.periodMonth}</td>
                    <td className="px-4 py-3 font-medium">
                      {formatRubles(p.amountKopecks)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        className={colorClass[payoutStatusColor(p.status)]}
                      >
                        {payoutStatusLabel(p.status)}
                      </Badge>
                      {p.voidReason && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {p.voidReason}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {p.createdAt.toLocaleDateString("ru-RU")}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {p.paidAt?.toLocaleDateString("ru-RU") ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      {p.status === "pending" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={action !== null}
                            onClick={() => void handleMarkPaid(p.id)}
                          >
                            {action === `paid:${p.id}` ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <CheckCircle2 className="w-3 h-3" />
                            )}
                            Paid
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={action !== null}
                            onClick={() => void handleVoid(p.id)}
                          >
                            {action === `void:${p.id}` ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Ban className="w-3 h-3" />
                            )}
                            Void
                          </Button>
                        </>
                      )}
                      {p.payoutDocumentUrl && (
                        <a
                          href={p.payoutDocumentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline"
                        >
                          Документ
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-900">
      <XCircle className="w-5 h-5 shrink-0 mt-0.5" />
      <div className="text-sm">{message}</div>
    </div>
  );
}
