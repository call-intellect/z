'use client';

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Loader2,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { referralsApi } from '@/api/referrals.api';
import type { ReferralStatsApi } from '@/api/types/referrals';
import { formatRubles } from '@/domain/billing';
import {
  buildReferralUrl,
  isFullyVerified,
  legalFormLabel,
  payoutStatusColor,
  payoutStatusLabel,
  referralFromApi,
  referralPayoutFromApi,
  type ReferralDomain,
  type ReferralPayoutDomain,
} from '@/domain/referral';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Skeleton } from '@/ui/shadcn/skeleton';

/**
 * `/referrals` — кабинет реферала.
 *
 * Состояния:
 *   - Профиля нет → форма создания (ИНН + legalForm + payoutDetails)
 *   - Профиль есть, не верифицирован → CTA verifyInn + acceptContract
 *   - Профиль готов → ссылка для копирования + статистика + payouts
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §11.2.
 */
export function ReferralsClient() {
  const [referral, setReferral] = useState<ReferralDomain | null>(null);
  const [stats, setStats] = useState<ReferralStatsApi | null>(null);
  const [payouts, setPayouts] = useState<ReferralPayoutDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const refRes = await referralsApi.getMe();
      const ref = refRes ? referralFromApi(refRes) : null;
      setReferral(ref);
      if (ref) {
        const [statsRes, payoutsRes] = await Promise.all([
          referralsApi.getStats(),
          referralsApi.getMyPayouts(),
        ]);
        setStats(statsRes);
        setPayouts(payoutsRes.map(referralPayoutFromApi));
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleVerify = async () => {
    setActionLoading('verify');
    try {
      const updated = await referralsApi.verifyInn();
      setReferral(referralFromApi(updated));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка');
    } finally {
      setActionLoading(null);
    }
  };

  const handleAcceptContract = async () => {
    setActionLoading('contract');
    try {
      const updated = await referralsApi.acceptContract();
      setReferral(referralFromApi(updated));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-5xl space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Sparkles className="w-6 h-6" />
          Реферальная программа
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Приведи клиента — получи 20 000 ₽ за каждый его paid-платёж.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-900">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="text-sm">{error}</div>
        </div>
      )}

      {!referral ? (
        <CreateReferralForm onCreated={() => void load()} />
      ) : (
        <>
          <ReferralCard
            referral={referral}
            actionLoading={actionLoading}
            onVerify={handleVerify}
            onAcceptContract={handleAcceptContract}
          />
          {stats && <StatsCards stats={stats} />}
          <PayoutsTable payouts={payouts} />
        </>
      )}
    </div>
  );
}

// ────────────────────────── Create form ──────────────────────────

function CreateReferralForm({ onCreated }: { onCreated: () => void }) {
  const [inn, setInn] = useState('');
  const [legalForm, setLegalForm] = useState<
    'self_employed' | 'individual_entrepreneur' | 'legal_entity'
  >('self_employed');
  const [bankName, setBankName] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    try {
      await referralsApi.create({
        inn: inn.trim(),
        legalForm,
        payoutDetails: { bankName, bankAccount },
      });
      onCreated();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Ошибка');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border bg-card p-6 space-y-4"
    >
      <div>
        <h2 className="text-lg font-medium">Стать рефералом</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Заполни ИНН и реквизиты — после верификации и подписания оферты
          можно начать приглашать клиентов.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">ИНН (10 или 12 цифр)</label>
        <Input
          value={inn}
          onChange={(e) => setInn(e.target.value)}
          placeholder="7707083893"
          maxLength={12}
          required
          pattern="\d{10}|\d{12}"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Форма</label>
        <select
          value={legalForm}
          onChange={(e) => setLegalForm(e.target.value as typeof legalForm)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="self_employed">Самозанятый (НПД)</option>
          <option value="individual_entrepreneur">ИП</option>
          <option value="legal_entity">Юридическое лицо</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="text-sm font-medium">Название банка</label>
          <Input
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            placeholder="Тинькофф / Сбербанк / ..."
            required
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Номер счёта</label>
          <Input
            value={bankAccount}
            onChange={(e) => setBankAccount(e.target.value)}
            placeholder="40817810..."
            required
          />
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          {err}
        </div>
      )}

      <Button type="submit" disabled={submitting}>
        {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
        Создать профиль
      </Button>
    </form>
  );
}

// ────────────────────────── Profile card ──────────────────────────

function ReferralCard({
  referral,
  actionLoading,
  onVerify,
  onAcceptContract,
}: {
  referral: ReferralDomain;
  actionLoading: string | null;
  onVerify: () => void;
  onAcceptContract: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://app.kora.app';
  const link = buildReferralUrl(referral.slug, origin);
  const verified = isFullyVerified(referral);

  const copy = () => {
    void navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="rounded-lg border bg-card p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-medium">Моя реферальная ссылка</h2>
          <p className="text-sm text-muted-foreground">
            ИНН {referral.inn} · {legalFormLabel(referral.legalForm)}
          </p>
        </div>
        <Badge
          className={
            verified ? 'bg-green-100 text-green-900' : 'bg-amber-100 text-amber-900'
          }
        >
          {verified ? 'Готов к выплатам' : 'Требуется верификация'}
        </Badge>
      </div>

      <div className="flex gap-2">
        <Input value={link} readOnly className="font-mono text-xs" />
        <Button variant="outline" onClick={copy}>
          {copied ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
          {copied ? 'Скопировано' : 'Копировать'}
        </Button>
      </div>

      {!verified && (
        <div className="space-y-2 pt-2 border-t">
          <p className="text-sm text-muted-foreground">
            Чтобы получать выплаты 10-го числа, нужно:
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={referral.innVerifiedAt ? 'ghost' : 'default'}
              size="sm"
              disabled={referral.innVerifiedAt !== null || actionLoading !== null}
              onClick={onVerify}
            >
              {actionLoading === 'verify' && (
                <Loader2 className="w-4 h-4 animate-spin" />
              )}
              {referral.innVerifiedAt ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  ИНН подтверждён
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  Проверить ИНН
                </>
              )}
            </Button>
            <Button
              variant={referral.contractAcceptedAt ? 'ghost' : 'default'}
              size="sm"
              disabled={
                referral.contractAcceptedAt !== null || actionLoading !== null
              }
              onClick={onAcceptContract}
            >
              {actionLoading === 'contract' && (
                <Loader2 className="w-4 h-4 animate-spin" />
              )}
              {referral.contractAcceptedAt ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Оферта принята
                </>
              ) : (
                'Принять оферту'
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────── Stats ──────────────────────────

function StatsCards({ stats }: { stats: ReferralStatsApi }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard
        icon={<Users className="w-5 h-5" />}
        label="Клиентов привёл"
        value={String(stats.totalClients)}
      />
      <StatCard
        icon={<TrendingUp className="w-5 h-5" />}
        label="Платящих сейчас"
        value={String(stats.activePaying)}
      />
      <StatCard
        icon={<Wallet className="w-5 h-5" />}
        label="К выплате"
        value={formatRubles(stats.totalPendingKopecks)}
      />
      <StatCard
        icon={<CheckCircle2 className="w-5 h-5" />}
        label="Выплачено"
        value={formatRubles(stats.totalPaidKopecks)}
      />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 text-xl font-semibold">{value}</div>
    </div>
  );
}

// ────────────────────────── Payouts table ──────────────────────────

function PayoutsTable({ payouts }: { payouts: ReferralPayoutDomain[] }) {
  if (payouts.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-medium mb-2">Начисления</h2>
        <p className="text-sm text-muted-foreground">
          Начисления появятся когда твои клиенты сделают первый платёж.
        </p>
      </div>
    );
  }

  const colorClass: Record<string, string> = {
    green: 'bg-green-100 text-green-900',
    amber: 'bg-amber-100 text-amber-900',
    red: 'bg-red-100 text-red-900',
  };

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="px-6 py-4 border-b">
        <h2 className="text-lg font-medium">Начисления</h2>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="text-left px-6 py-3 font-medium">Период</th>
            <th className="text-left px-6 py-3 font-medium">Сумма</th>
            <th className="text-left px-6 py-3 font-medium">Статус</th>
            <th className="text-left px-6 py-3 font-medium">Создано</th>
            <th className="text-left px-6 py-3 font-medium">Выплачено</th>
          </tr>
        </thead>
        <tbody>
          {payouts.map((p) => (
            <tr key={p.id} className="border-t">
              <td className="px-6 py-3 font-mono">{p.periodMonth}</td>
              <td className="px-6 py-3 font-medium">
                {formatRubles(p.amountKopecks)}
              </td>
              <td className="px-6 py-3">
                <Badge className={colorClass[payoutStatusColor(p.status)]}>
                  {payoutStatusLabel(p.status)}
                </Badge>
                {p.voidReason && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {p.voidReason}
                  </span>
                )}
              </td>
              <td className="px-6 py-3 text-muted-foreground">
                {p.createdAt.toLocaleDateString('ru-RU')}
              </td>
              <td className="px-6 py-3 text-muted-foreground">
                {p.paidAt?.toLocaleDateString('ru-RU') ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
