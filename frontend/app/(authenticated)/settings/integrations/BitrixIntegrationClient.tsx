'use client';

import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { Loader2, Plug, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import { bitrixApi } from '@/api/bitrix.api';
import { mapBitrixIntegration } from '@/domain/bitrix';
import { TierGate } from '@/ui/components/TierGate';
import { useConfirmDialog } from '@/ui/components/shared/useConfirmDialog';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';

function errMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

function formatDate(d: Date | null): string {
  return d ? d.toLocaleString('ru-RU') : '—';
}

export function BitrixIntegrationClient() {
  return (
    <TierGate feature="feature.bitrix">
      <BitrixIntegrationContent />
    </TierGate>
  );
}

function BitrixIntegrationContent() {
  const { data, error, isLoading, mutate } = useSWR(['bitrix-integration'], () =>
    bitrixApi.getIntegration().then(mapBitrixIntegration),
  );

  // Тост после возврата из OAuth-редиректа (?bitrix=connected|error). Читаем
  // window.location.search в useEffect — без useSearchParams, чтобы не тянуть
  // Suspense-границу при сборке.
  const handledRef = useRef(false);
  useEffect(() => {
    if (handledRef.current || typeof window === 'undefined') return;
    const status = new URLSearchParams(window.location.search).get('bitrix');
    if (status === 'connected') {
      handledRef.current = true;
      toast.success('Bitrix24 подключён');
      void mutate();
    } else if (status === 'error') {
      handledRef.current = true;
      toast.error('Не удалось подключить Bitrix24');
    }
  }, [mutate]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug size={18} className="text-accent" />
          Bitrix24
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-fg-secondary">
          Подключите портал Bitrix24, чтобы Кора собирала знания компании из
          CRM. Сейчас доступно подключение портала; синхронизация данных —
          следующим этапом.
        </p>

        {isLoading && (
          <div className="flex items-center py-8 text-sm text-fg-tertiary">
            <Loader2 size={16} className="mr-2 animate-spin" /> Загружаем…
          </div>
        )}

        {error && !isLoading && (
          <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            {errMessage(error, 'Не удалось загрузить интеграцию')}
          </div>
        )}

        {!isLoading && !error && !data && (
          <ConnectForm />
        )}

        {!isLoading && !error && data && (
          <ConnectedView integration={data} onChanged={() => void mutate()} />
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────── Не подключено ───────────────────────────────

function ConnectForm() {
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);

  const handleConnect = async () => {
    const normalized = domain.trim();
    if (!normalized) {
      toast.error('Введите домен портала, например acme.bitrix24.ru');
      return;
    }
    setBusy(true);
    try {
      const { url } = await bitrixApi.getAuthorizeUrl(normalized);
      // Полностраничный редирект на authorize Bitrix24.
      window.location.href = url;
    } catch (e) {
      toast.error(errMessage(e, 'Не удалось начать подключение'));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="bitrix-domain">Домен портала</Label>
        <Input
          id="bitrix-domain"
          placeholder="acme.bitrix24.ru"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          disabled={busy}
        />
      </div>
      <Button onClick={() => void handleConnect()} disabled={busy}>
        {busy ? (
          <Loader2 size={16} className="mr-2 animate-spin" />
        ) : (
          <Plug size={16} className="mr-2" />
        )}
        Подключить Bitrix24
      </Button>
    </div>
  );
}

// ─────────────────────────── Подключено ──────────────────────────────────

function ConnectedView({
  integration,
  onChanged,
}: {
  integration: NonNullable<ReturnType<typeof mapBitrixIntegration>>;
  onChanged: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { ask, dialog } = useConfirmDialog();

  const handleTest = async () => {
    setTesting(true);
    try {
      await bitrixApi.test();
      toast.success('Соединение с Bitrix24 в порядке');
      onChanged();
    } catch (e) {
      toast.error(errMessage(e, 'Проверка соединения не удалась'));
      onChanged();
    } finally {
      setTesting(false);
    }
  };

  const handleRemove = async () => {
    const ok = await ask({
      title: 'Отключить Bitrix24?',
      description: 'Токены портала будут удалены. Подключить можно будет заново.',
      confirmLabel: 'Отключить',
      destructive: true,
    });
    if (!ok) return;
    setRemoving(true);
    try {
      await bitrixApi.deleteIntegration();
      toast.success('Bitrix24 отключён');
      onChanged();
    } catch (e) {
      toast.error(errMessage(e, 'Не удалось отключить'));
    } finally {
      setRemoving(false);
    }
  };

  const statusVariant =
    integration.status === 'connected' ? 'default' : 'secondary';
  const statusClassName =
    integration.status === 'error' ? 'border-danger/40 text-danger' : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-fg-primary">
          {integration.portalDomain}
        </span>
        <Badge variant={statusVariant} className={statusClassName}>
          {integration.statusLabel}
        </Badge>
      </div>

      {integration.status === 'error' && integration.lastError && (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {integration.lastError}
        </div>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-fg-tertiary">Права (scope)</dt>
        <dd className="text-fg-secondary">{integration.scope || '—'}</dd>
        <dt className="text-fg-tertiary">Последняя проверка</dt>
        <dd className="text-fg-secondary">
          {formatDate(integration.lastConnectedAt)}
        </dd>
      </dl>

      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={() => void handleTest()}
          disabled={testing}
        >
          {testing ? (
            <Loader2 size={16} className="mr-2 animate-spin" />
          ) : (
            <RefreshCw size={16} className="mr-2" />
          )}
          Проверить соединение
        </Button>
        <Button
          variant="ghost"
          className="text-danger hover:text-danger"
          onClick={() => void handleRemove()}
          disabled={removing}
        >
          <Trash2 size={16} className="mr-2" />
          Отключить
        </Button>
      </div>

      {dialog}
    </div>
  );
}
