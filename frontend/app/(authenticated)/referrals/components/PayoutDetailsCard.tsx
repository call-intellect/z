'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  ShieldCheck,
  Wallet,
} from 'lucide-react';

import { ApiError, humanizeApiError } from '@/api/api-error';
import { referralsApi } from '@/api/referrals.api';
import {
  legalFormLabel,
  payoutDetailsAreFilled,
  referralFromApi,
  type ReferralDomain,
  type ReferralLegalForm,
} from '@/domain/referral';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Card } from '@/ui/shadcn/card';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';

interface Props {
  referral: ReferralDomain;
  onUpdated: (referral: ReferralDomain) => void;
}

type PayoutStatus = 'empty' | 'unverified' | 'verified';

/**
 * PayoutDetailsCard — карточка реквизитов для вывода денег (ТЗ §8.2).
 *
 * Состояния (бейдж в заголовке):
 *   - `empty` — реквизиты не заполнены, вывод недоступен.
 *   - `unverified` — заполнены, но ИНН не подтверждён (кнопка «Проверить ИНН»).
 *   - `verified` — всё готово, выплаты идут автоматически 10-го числа.
 *
 * Карточка свёрнута по умолчанию в состоянии `verified` (там нечего
 * делать). В состоянии `empty` и `unverified` — развёрнута, чтобы
 * подтолкнуть к действию.
 */
export function PayoutDetailsCard({ referral, onUpdated }: Props) {
  const status: PayoutStatus = computeStatus(referral);
  const [expanded, setExpanded] = useState<boolean>(status !== 'verified');

  return (
    <Card>
      <header className="flex items-center justify-between gap-3 border-b border-border-subtle px-6 py-4">
        <div className="flex items-center gap-2">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-muted text-accent"
            aria-hidden="true"
          >
            <Wallet className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-fg-primary">
              Реквизиты для вывода
            </h2>
            <p className="text-xs text-fg-tertiary">
              ИНН, форма ведения деятельности и банковский счёт. Нужны для
              выплаты 10-го числа.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={status} />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Свернуть' : 'Развернуть'}
            aria-expanded={expanded}
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>
      </header>

      {expanded && (
        <PayoutDetailsForm referral={referral} onUpdated={onUpdated} />
      )}
    </Card>
  );
}

function computeStatus(ref: ReferralDomain): PayoutStatus {
  if (!payoutDetailsAreFilled(ref)) return 'empty';
  if (ref.innVerifiedAt === null) return 'unverified';
  return 'verified';
}

function StatusBadge({ status }: { status: PayoutStatus }) {
  if (status === 'verified') {
    return (
      <Badge variant="success">
        <CheckCircle2 className="h-3 w-3" />
        Готово
      </Badge>
    );
  }
  if (status === 'unverified') {
    return (
      <Badge variant="warning">
        <AlertTriangle className="h-3 w-3" />
        Не подтверждены
      </Badge>
    );
  }
  return (
    <Badge variant="danger">
      <AlertTriangle className="h-3 w-3" />
      Не заполнены — вывод недоступен
    </Badge>
  );
}

// ───────────────────────── Form ─────────────────────────

interface PayoutDetailsFormValues {
  inn: string;
  legalForm: ReferralLegalForm;
  bankName: string;
  bankAccount: string;
}

function PayoutDetailsForm({ referral, onUpdated }: Props) {
  const initial = readInitialValues(referral);
  const [values, setValues] = useState<PayoutDetailsFormValues>(initial);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^(\d{10}|\d{12})$/.test(values.inn.trim())) {
      setError('ИНН должен содержать 10 или 12 цифр.');
      return;
    }
    if (!values.bankName.trim() || !values.bankAccount.trim()) {
      setError('Заполни банк и номер счёта.');
      return;
    }
    setSaving(true);
    try {
      const updated = await referralsApi.update({
        inn: values.inn.trim(),
        legalForm: values.legalForm,
        payoutDetails: {
          bankName: values.bankName.trim(),
          bankAccount: values.bankAccount.trim(),
        },
      });
      onUpdated(referralFromApi(updated));
      setSavedAt(Date.now());
    } catch (e2) {
      setError(
        humanizeApiError(e2, 'Не удалось сохранить реквизиты.'),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async () => {
    setError(null);
    setVerifying(true);
    try {
      const updated = await referralsApi.verifyInn();
      onUpdated(referralFromApi(updated));
    } catch (e2) {
      setError(
        e2 instanceof ApiError
          ? e2.message
          : 'Не удалось запустить проверку ИНН.',
      );
    } finally {
      setVerifying(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-5 p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="referral-inn">ИНН (10 или 12 цифр)</Label>
          <Input
            id="referral-inn"
            value={values.inn}
            onChange={(e) =>
              setValues((v) => ({ ...v, inn: e.target.value.replace(/\D/g, '') }))
            }
            placeholder="7707083893"
            maxLength={12}
            inputMode="numeric"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="referral-legal-form">Форма ведения деятельности</Label>
          <Select
            value={values.legalForm}
            onValueChange={(v) =>
              setValues((s) => ({ ...s, legalForm: v as ReferralLegalForm }))
            }
          >
            <SelectTrigger id="referral-legal-form">
              <SelectValue placeholder="Выбери форму" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="self_employed">
                {legalFormLabel('self_employed')}
              </SelectItem>
              <SelectItem value="individual_entrepreneur">
                {legalFormLabel('individual_entrepreneur')}
              </SelectItem>
              <SelectItem value="legal_entity">
                {legalFormLabel('legal_entity')}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="referral-bank">Название банка</Label>
          <Input
            id="referral-bank"
            value={values.bankName}
            onChange={(e) =>
              setValues((v) => ({ ...v, bankName: e.target.value }))
            }
            placeholder="Тинькофф / Сбербанк / Точка"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="referral-account">Номер счёта</Label>
          <Input
            id="referral-account"
            value={values.bankAccount}
            onChange={(e) =>
              setValues((v) => ({ ...v, bankAccount: e.target.value }))
            }
            placeholder="40817810..."
          />
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {referral.innVerifiedAt && (
        <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          ИНН подтверждён{' '}
          {referral.innVerifiedAt.toLocaleDateString('ru-RU')}. Выплаты пойдут
          автоматически 10-го числа.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Сохранить реквизиты
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={handleVerify}
          disabled={
            verifying ||
            referral.innVerifiedAt !== null ||
            !values.inn ||
            !payoutDetailsAreFilled(referral)
          }
          title={
            referral.innVerifiedAt
              ? 'ИНН уже подтверждён'
              : !payoutDetailsAreFilled(referral)
                ? 'Сначала сохрани реквизиты'
                : undefined
          }
        >
          {verifying ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ShieldCheck className="h-4 w-4" />
          )}
          Проверить ИНН
        </Button>
        {savedAt && !error && (
          <span className="text-xs text-success">Реквизиты сохранены.</span>
        )}
      </div>
    </form>
  );
}

function readInitialValues(ref: ReferralDomain): PayoutDetailsFormValues {
  // payoutDetails не приходит в ReferralViewApi — это намеренно (защита от
  // утечки приватных банковских реквизитов через API). Форма стартует с
  // пустыми банковскими полями, ИНН и форма — из профиля. Если партнёр
  // что-то менял — увидит это после сохранения.
  return {
    inn: ref.inn ?? '',
    legalForm: ref.legalForm ?? 'self_employed',
    bankName: '',
    bankAccount: '',
  };
}
