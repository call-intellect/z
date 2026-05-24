'use client';

/**
 * Wizard импорта из Яндекс Трекера
 * (Wave 3 / Tracker Phase 5 — Я.Трекер ветка).
 *
 * 4 шага:
 *   1. Подключение      — OAuth-токен Яндекс ID.
 *   2. Очереди          — список ключей очередей (PROJ, DEV, ...).
 *   3. Маппинг          — textarea «email=ourUserId / skip» (общий компонент).
 *   4. Подтверждение    — итог + POST /api/v1/tracker/imports/yandex-tracker.
 *
 * RBAC проверяется родителем (ImportTrackerClient.tsx).
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Database,
  ExternalLink,
  Hourglass,
  KeyRound,
  Loader2,
  Sparkles,
} from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { importsApi } from '@/api/tracker/imports.api';
import { useToast } from '@/contexts/toast-context';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent } from '@/ui/shadcn/card';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import { Textarea } from '@/ui/shadcn/textarea';

import {
  FreeTextMappingStep,
  MaskedWebhookDisplay,
  SummaryTile,
  WizardSteps,
  parseIdList,
  parseUserMappings,
  validateQueueKeys,
  type WizardStepDef,
} from './_shared';

type Step = 'connect' | 'queues' | 'mapping' | 'preview';

const STEPS: WizardStepDef[] = [
  { id: 'connect', label: 'Подключение' },
  { id: 'queues', label: 'Очереди' },
  { id: 'mapping', label: 'Маппинг' },
  { id: 'preview', label: 'Подтверждение' },
];

export function YandexTrackerWizard({
  orgId,
  onCancel,
}: {
  orgId: string;
  onCancel: () => void;
}) {
  const router = useRouter();
  const { addToast } = useToast();

  const [step, setStep] = useState<Step>('connect');

  // Шаг 1 — Подключение
  const [oauthToken, setOauthToken] = useState('');
  const tokenValid = oauthToken.trim().length >= 10;

  // Шаг 2 — Очереди
  const [queuesInput, setQueuesInput] = useState('');
  const parsedQueueKeys = useMemo(
    () => parseIdList(queuesInput).map((k) => k.toUpperCase()),
    [queuesInput],
  );
  const { valid: validQueueKeys, invalid: invalidQueueKeys } = useMemo(
    () => validateQueueKeys(parsedQueueKeys),
    [parsedQueueKeys],
  );
  const queuesValid =
    validQueueKeys.length > 0 && invalidQueueKeys.length === 0;

  // Шаг 3 — Маппинг
  const [mappingText, setMappingText] = useState('');
  const parsedMappings = useMemo(
    () => parseUserMappings(mappingText),
    [mappingText],
  );

  // Шаг 4
  const [submitting, setSubmitting] = useState(false);

  const goNext = () => {
    if (step === 'connect') setStep('queues');
    else if (step === 'queues') setStep('mapping');
    else if (step === 'mapping') setStep('preview');
  };
  const goBack = () => {
    if (step === 'preview') setStep('mapping');
    else if (step === 'mapping') setStep('queues');
    else if (step === 'queues') setStep('connect');
    else onCancel();
  };

  const handleStart = async () => {
    setSubmitting(true);
    try {
      const res = await importsApi.startYandexTracker(orgId, {
        oauthToken: oauthToken.trim(),
        selectedQueueIds: validQueueKeys,
        userMappings:
          Object.keys(parsedMappings.mappings).length > 0
            ? parsedMappings.mappings
            : undefined,
      });
      addToast({ type: 'success', message: 'Импорт из Яндекс Трекера запущен' });
      router.push(`/integrations/import-tracker/${res.importLogId}`);
    } catch (e) {
      addToast({
        type: 'error',
        message:
          e instanceof ApiError
            ? e.message
            : 'Не удалось запустить импорт. Попробуйте ещё раз.',
      });
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <WizardSteps steps={STEPS} current={step} />

      {step === 'connect' && (
        <ConnectStep
          token={oauthToken}
          onChangeToken={setOauthToken}
          tokenValid={tokenValid}
          onBack={onCancel}
          onNext={goNext}
        />
      )}

      {step === 'queues' && (
        <QueuesStep
          value={queuesInput}
          onChange={setQueuesInput}
          validKeys={validQueueKeys}
          invalidKeys={invalidQueueKeys}
          canNext={queuesValid}
          onBack={goBack}
          onNext={goNext}
        />
      )}

      {step === 'mapping' && (
        <FreeTextMappingStep
          value={mappingText}
          onChange={setMappingText}
          parsed={parsedMappings}
          onBack={goBack}
          onNext={goNext}
          stepTitle="Шаг 3: Маппинг пользователей Яндекс Трекера"
        />
      )}

      {step === 'preview' && (
        <PreviewStep
          token={oauthToken}
          queueKeys={validQueueKeys}
          mappedCount={parsedMappings.mappedCount}
          skippedCount={parsedMappings.skippedCount}
          onBack={goBack}
          onStart={() => void handleStart()}
          submitting={submitting}
        />
      )}
    </div>
  );
}

// ─── Шаг 1: Подключение ────────────────────────────────────────────────────

function ConnectStep({
  token,
  onChangeToken,
  tokenValid,
  onBack,
  onNext,
}: {
  token: string;
  onChangeToken: (v: string) => void;
  tokenValid: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const touched = token.trim().length > 0;
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-accent-muted text-accent">
            <KeyRound size={18} />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-fg-primary">
              Шаг 1: Подключите Яндекс Трекер
            </h2>
            <p className="mt-1 text-sm text-fg-secondary">
              Создайте OAuth-приложение в Яндексе с правом{' '}
              <code className="rounded bg-bg-overlay px-1 py-0.5 text-xs">
                tracker:read
              </code>{' '}
              и получите долгоживущий токен. Мы используем его только в режиме
              чтения и шифруем в БД.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <Label htmlFor="oauth-token" className="text-sm">
            OAuth-токен
          </Label>
          <Input
            id="oauth-token"
            type="password"
            value={token}
            onChange={(e) => onChangeToken(e.target.value)}
            placeholder="y0_AgAAAAA..."
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-xs"
          />
          {touched && !tokenValid && (
            <p className="text-xs text-danger">
              Токен слишком короткий. Проверьте, что вы скопировали значение
              целиком.
            </p>
          )}
          {touched && tokenValid && (
            <p className="flex items-center gap-1.5 text-xs text-success">
              <CheckCircle2 size={14} /> Похоже на токен — переходим дальше
            </p>
          )}
        </div>

        <div className="mt-5 rounded-md border border-border-subtle bg-bg-elevated p-4 text-xs text-fg-secondary">
          <div className="mb-2 flex items-center gap-1.5 font-medium text-fg-primary">
            <ClipboardList size={14} /> Как получить OAuth-токен
          </div>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Зайдите на{' '}
              <a
                href="https://oauth.yandex.ru/client/new"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                oauth.yandex.ru
              </a>{' '}
              и создайте приложение.
            </li>
            <li>
              В правах укажите{' '}
              <code className="rounded bg-bg-overlay px-1">
                tracker:read
              </code>
              .
            </li>
            <li>
              Получите токен через{' '}
              <code className="rounded bg-bg-overlay px-1">
                https://oauth.yandex.ru/authorize?response_type=token&client_id=...
              </code>
              .
            </li>
          </ol>
          <a
            href="https://yandex.ru/dev/tracker/doc/ru/concepts/access"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-accent hover:underline"
          >
            Документация Яндекс Трекера <ExternalLink size={12} />
          </a>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-md border border-warn/30 bg-warn/10 p-3 text-xs text-warn">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <p>
            OAuth-токен — это секрет. Мы шифруем его в БД (AES-256-GCM) и
            используем только для импорта. Токен можно отозвать в кабинете
            Яндекс ID в любой момент.
          </p>
        </div>

        <div className="mt-6 flex justify-between">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={14} /> К выбору источника
          </Button>
          <Button onClick={onNext} disabled={!tokenValid}>
            Дальше <ArrowRight size={14} />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Шаг 2: Очереди ────────────────────────────────────────────────────────

function QueuesStep({
  value,
  onChange,
  validKeys,
  invalidKeys,
  canNext,
  onBack,
  onNext,
}: {
  value: string;
  onChange: (v: string) => void;
  validKeys: string[];
  invalidKeys: string[];
  canNext: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-accent-muted text-accent">
            <Database size={18} />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-fg-primary">
              Шаг 2: Какие очереди импортировать
            </h2>
            <p className="mt-1 text-sm text-fg-secondary">
              В Яндекс Трекере очередь — это аналог проекта. Каждая очередь
              станет отдельным проектом в Коре. Ключ очереди — это префикс
              перед номером задачи (например, для задачи{' '}
              <code className="rounded bg-bg-overlay px-1 py-0.5 text-xs">
                PROJ-42
              </code>{' '}
              ключ = PROJ).
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <Label htmlFor="queues-input" className="text-sm">
            Ключи очередей через запятую или пробел
          </Label>
          <Textarea
            id="queues-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="PROJ, DEV, MARKETING"
            className="min-h-[100px] font-mono text-sm uppercase"
            autoCapitalize="characters"
          />
          <p className="text-xs text-fg-tertiary">
            Распознано ключей: <b>{validKeys.length}</b>. Формат: 2–10
            латинских заглавных букв или цифр, начинается с буквы.
          </p>
        </div>

        {validKeys.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {validKeys.map((k) => (
              <span
                key={k}
                className="rounded-full bg-accent/10 px-2 py-0.5 font-mono text-xs text-accent"
              >
                {k}
              </span>
            ))}
          </div>
        )}

        {invalidKeys.length > 0 && (
          <div className="mt-3 rounded-md border border-warn/30 bg-warn/10 p-3 text-xs text-warn">
            <div className="flex items-center gap-1.5 font-medium">
              <AlertTriangle size={14} /> Некорректные ключи очередей:
            </div>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {invalidKeys.slice(0, 5).map((k) => (
                <li key={k}>
                  <code className="font-mono">{k}</code>
                </li>
              ))}
              {invalidKeys.length > 5 && (
                <li>… ещё {invalidKeys.length - 5}</li>
              )}
            </ul>
            <p className="mt-1">
              Ключи должны быть 2–10 заглавных латинских символов (буквы и
              цифры), начинаться с буквы.
            </p>
          </div>
        )}

        <div className="mt-4 flex items-start gap-2 rounded-md border border-accent/30 bg-accent/5 p-3 text-xs text-fg-secondary">
          <ClipboardList size={14} className="mt-0.5 shrink-0 text-accent" />
          <p>
            Будем тянуть задачи только из указанных очередей. Связи между
            задачами сохраним; задачи из других очередей будут отображены как
            «внешние».
          </p>
        </div>

        <div className="mt-6 flex justify-between">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={14} /> Назад
          </Button>
          <Button onClick={onNext} disabled={!canNext}>
            Дальше <ArrowRight size={14} />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Шаг 4: Preview ────────────────────────────────────────────────────────

function PreviewStep({
  token,
  queueKeys,
  mappedCount,
  skippedCount,
  onBack,
  onStart,
  submitting,
}: {
  token: string;
  queueKeys: string[];
  mappedCount: number;
  skippedCount: number;
  onBack: () => void;
  onStart: () => void;
  submitting: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-accent-muted text-accent">
            <Sparkles size={18} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-fg-primary">
              Шаг 4: Подтверждение запуска
            </h2>
            <p className="mt-1 text-sm text-fg-secondary">
              Проверьте параметры — после старта мы запросим список задач у
              Яндекс Трекера. Импорт можно отменить, пока он идёт.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <div className="text-xs uppercase tracking-wide text-fg-tertiary">
            OAuth-токен (замаскирован)
          </div>
          <MaskedWebhookDisplay url={token} />
        </div>

        <div className="mt-4 space-y-2">
          <div className="text-xs uppercase tracking-wide text-fg-tertiary">
            Очереди для импорта
          </div>
          <div className="flex flex-wrap gap-1.5">
            {queueKeys.map((k) => (
              <span
                key={k}
                className="rounded-full bg-accent/10 px-2 py-0.5 font-mono text-xs text-accent"
              >
                {k}
              </span>
            ))}
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-3 gap-4">
          <SummaryTile
            icon={<Database size={16} />}
            label="Очередей → Проектов"
            value={queueKeys.length}
          />
          <SummaryTile label="Сопоставлено user" value={mappedCount} />
          <SummaryTile label="Пропущено (skip)" value={skippedCount} />
        </dl>

        <div className="mt-5 flex items-start gap-2 rounded-md border border-accent/30 bg-accent/5 p-3 text-xs text-fg-secondary">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-accent" />
          <p>
            Импорт идемпотентен: повторный запуск не создаст дублей.
            Прогресс и журнал ошибок откроются на следующей странице.
          </p>
        </div>

        <div className="mt-6 flex justify-between">
          <Button variant="ghost" onClick={onBack} disabled={submitting}>
            <ArrowLeft size={14} /> Назад
          </Button>
          <Button onClick={onStart} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Запускаем…
              </>
            ) : (
              <>
                <Hourglass size={14} /> Начать импорт
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
