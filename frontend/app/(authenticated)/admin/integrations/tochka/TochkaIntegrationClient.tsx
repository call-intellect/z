'use client';

import { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
} from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { billingApi } from '@/api/billing.api';
import { Button } from '@/ui/shadcn/button';

/**
 * `/admin/integrations/tochka` — подключение Точка Банка к Z (super_admin).
 *
 * Сценарий:
 *   1. Backend стартует с TOCHKA_MODE=production. Если токенов нет в
 *      BillingProviderConfig — ensureOAuthReady пишет authorize URL в логи.
 *   2. Админ открывает эту страницу → нажимает «Получить URL» →
 *      backend генерирует state, делает client_credentials → consent →
 *      возвращает authorize URL.
 *   3. Админ открывает URL в новом таб'е → авторизуется в кабинете Точки →
 *      Точка редиректит на /internal/billing/tochka/oauth/callback с code+state.
 *   4. Backend обменивает code на access+refresh, сохраняет в BillingProviderConfig.
 *   5. Refresh обновляется автоматически за 5 мин до expiry.
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §7.3 + §11.4.
 */
export function TochkaIntegrationClient() {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ensureLoading, setEnsureLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleGetUrl = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await billingApi.adminGetTochkaAuthorizeUrl();
      setUrl(res.url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка получения URL');
    } finally {
      setLoading(false);
    }
  };

  const handleEnsureReady = async () => {
    setEnsureLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await billingApi.adminEnsureTochkaOAuthReady();
      setSuccess(
        'ensureOAuthReady выполнен. Если токенов не было — authorize URL появится в логах backend.',
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка');
    } finally {
      setEnsureLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Точка Банк — OAuth подключение</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Управление авторизацией Z в кабинете Точки. Токены хранятся в
          таблице BillingProviderConfig и автоматически рефрешатся.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-medium">Шаги подключения</h2>
          <ol className="text-sm space-y-2 mt-3 list-decimal list-inside text-muted-foreground">
            <li>
              Убедитесь что в <code>.env</code> заданы:{' '}
              <code>BILLING_PROVIDER=tochka</code>,{' '}
              <code>FEATURE_BILLING_TOCHKA=true</code>,{' '}
              <code>TOCHKA_MODE=production</code>,{' '}
              <code>TOCHKA_CLIENT_ID/SECRET</code>, <code>TOCHKA_REDIRECT_URI</code>.
            </li>
            <li>
              Перезапустите backend: <code>docker compose up -d --force-recreate backend</code>
            </li>
            <li>Нажмите «Получить URL» ниже → откройте URL в браузере.</li>
            <li>
              Авторизуйтесь в кабинете Точки → Точка вернёт callback на{' '}
              <code>/api/v1/internal/billing/tochka/oauth/callback</code> →
              увидите страницу «OAuth подключен».
            </li>
            <li>
              После этого webhook автоматически зарегистрируется (если{' '}
              <code>TOCHKA_WEBHOOK_AUTO_REGISTER=true</code>).
            </li>
          </ol>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-6 space-y-4">
        <h2 className="text-lg font-medium">Действия</h2>

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleGetUrl} disabled={loading}>
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ExternalLink className="w-4 h-4" />
            )}
            Получить URL для подключения
          </Button>
          <Button
            variant="outline"
            onClick={handleEnsureReady}
            disabled={ensureLoading}
          >
            {ensureLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Trigger ensureOAuthReady
          </Button>
        </div>

        {url && (
          <div className="rounded-md border bg-muted/30 p-4 space-y-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Authorize URL (откройте в новом таб'е)
            </p>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="block break-all text-sm text-primary hover:underline font-mono"
            >
              {url}
            </a>
            <p className="text-xs text-muted-foreground">
              ⚠️ TTL state'а — 15 минут. После авторизации в Точке token-pair
              автоматически сохранится в БД.
            </p>
          </div>
        )}

        {success && (
          <div className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground space-y-2">
        <h2 className="text-lg font-medium text-foreground">Проверка статуса</h2>
        <p>
          Чтобы проверить наличие токенов в БД — выполните в shell прода:
        </p>
        <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto">
          {`docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \\
  -c "SELECT key FROM billing_provider_config;"`}
        </pre>
        <p>
          Должна быть запись <code>tochka.production.oauth_tokens</code>.
        </p>
      </div>
    </div>
  );
}
