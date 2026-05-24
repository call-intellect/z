'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { adminPricesApi } from '@/api/admin-prices.api';
import {
  adminPriceListFromApi,
  type AdminPriceDomain,
} from '@/domain/admin-price';
import { toast } from 'sonner';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/ui/shadcn/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import { Switch } from '@/ui/shadcn/switch';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../AdminStateViews';
import { useAdminQuery } from '../useAdminQuery';

export function LlmPricesClient() {
  const [activeOnly, setActiveOnly] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const q = useAdminQuery(
    `admin-prices:${activeOnly}`,
    async () => {
      const res = await adminPricesApi.list({ activeOnly });
      return adminPriceListFromApi(res);
    },
    [activeOnly],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Прайс LLM</h1>
          <p className="text-sm text-fg-tertiary">
            Цены за 1M токенов. Версионирование через effectiveFrom/To.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={activeOnly}
              onCheckedChange={(v) => setActiveOnly(v)}
            />
            Только активные
          </label>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus size={14} /> Добавить цену
          </Button>
        </div>
      </div>

      {q.isLoading && <AdminLoading rows={5} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading &&
        q.data &&
        (q.data.items.length === 0 ? (
          <AdminEmpty
            title="Прайс пуст"
            description="Добавьте первую запись, чтобы Lll-Router начал считать стоимость."
          />
        ) : (
          <PricesTable items={q.data.items} />
        ))}

      {showAdd && (
        <AddPriceDialog
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            q.refetch();
          }}
        />
      )}
    </div>
  );
}

function PricesTable({ items }: { items: AdminPriceDomain[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle">
      <table className="w-full text-sm">
        <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
          <tr>
            <th className="px-3 py-2 text-left">Provider</th>
            <th className="px-3 py-2 text-left">Model</th>
            <th className="px-3 py-2 text-right">Input / 1M</th>
            <th className="px-3 py-2 text-right">Output / 1M</th>
            <th className="px-3 py-2 text-right">Cached / 1M</th>
            <th className="px-3 py-2 text-left">Currency</th>
            <th className="px-3 py-2 text-left">Effective</th>
            <th className="px-3 py-2 text-left">Статус</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr
              key={p.id}
              className="border-t border-border-subtle hover:bg-bg-overlay"
            >
              <td className="px-3 py-2 font-mono text-xs">{p.provider}</td>
              <td className="px-3 py-2 font-mono text-xs">{p.model}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {p.inputCostPerMillionTokens.toFixed(2)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {p.outputCostPerMillionTokens.toFixed(2)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {p.cachedCostPerMillionTokens.toFixed(2)}
              </td>
              <td className="px-3 py-2 text-xs">{p.currency}</td>
              <td className="px-3 py-2 text-xs text-fg-tertiary">
                {p.effectiveFrom.toLocaleDateString('ru-RU')}
                {p.effectiveTo
                  ? ` — ${p.effectiveTo.toLocaleDateString('ru-RU')}`
                  : ' — сейчас'}
              </td>
              <td className="px-3 py-2">
                {p.isActive ? (
                  <Badge variant="default">активна</Badge>
                ) : (
                  <Badge variant="secondary">архив</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddPriceDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [provider, setProvider] = useState('anthropic');
  const [model, setModel] = useState('');
  const [inputCost, setInputCost] = useState('');
  const [outputCost, setOutputCost] = useState('');
  const [cachedCost, setCachedCost] = useState('0');
  const [currency, setCurrency] = useState('USD');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!provider || !model) {
      toast.error('provider/model обязательны');
      return;
    }
    const i = Number(inputCost);
    const o = Number(outputCost);
    const c = Number(cachedCost || '0');
    if (!isFinite(i) || !isFinite(o) || !isFinite(c) || i < 0 || o < 0 || c < 0) {
      toast.error('некорректные цены');
      return;
    }
    setSubmitting(true);
    try {
      await adminPricesApi.set({
        provider,
        model,
        inputCostPerMillionTokens: i,
        outputCostPerMillionTokens: o,
        cachedCostPerMillionTokens: c,
        currency,
      });
      toast.success('Цена сохранена');
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось сохранить');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новая цена</DialogTitle>
          <DialogDescription>
            Если для этой пары provider+model уже есть активная — она будет
            закрыта (effectiveTo = сейчас).
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Provider">
            <Input value={provider} onChange={(e) => setProvider(e.target.value)} />
          </Field>
          <Field label="Model">
            <Input value={model} onChange={(e) => setModel(e.target.value)} />
          </Field>
          <Field label="Input / 1M токенов">
            <Input
              type="number"
              step="0.01"
              value={inputCost}
              onChange={(e) => setInputCost(e.target.value)}
            />
          </Field>
          <Field label="Output / 1M токенов">
            <Input
              type="number"
              step="0.01"
              value={outputCost}
              onChange={(e) => setOutputCost(e.target.value)}
            />
          </Field>
          <Field label="Cached / 1M токенов">
            <Input
              type="number"
              step="0.01"
              value={cachedCost}
              onChange={(e) => setCachedCost(e.target.value)}
            />
          </Field>
          <Field label="Currency">
            <Input value={currency} onChange={(e) => setCurrency(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            Отмена
          </Button>
          <Button size="sm" onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
