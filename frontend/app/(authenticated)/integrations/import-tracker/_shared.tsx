'use client';

/**
 * Общие хелперы и UI-компоненты для wizard-ов импорта трекеров
 * (Wave 3 / Tracker Phase 5 — Bitrix24 + Я.Трекер ветки).
 *
 * Trello-wizard живёт inline в ImportTrackerClient.tsx (исторически), а новые
 * Bitrix24/Я.Трекер wizard-ы используют этот общий набор:
 *   - parseUserMappings  — парсер textarea email=value / email=skip.
 *   - MaskedWebhookDisplay — компонент маскирующий токен в URL.
 *   - WizardSteps          — общая шкала шагов 1-2-3-4.
 *   - FreeTextMappingStep  — простой шаг маппинга через textarea
 *                            (без member-list, как в Trello).
 *   - SummaryTile          — плитка статистики для preview-шага.
 */

import { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';

import { Button } from '@/ui/shadcn/button';
import { Card, CardContent } from '@/ui/shadcn/card';
import { Label } from '@/ui/shadcn/label';
import { Textarea } from '@/ui/shadcn/textarea';

/** Результат парсинга textarea с маппингами пользователей. */
export interface ParsedUserMappings {
  /** email → ourUserId | null. Готово для отправки на бэкенд. */
  mappings: Record<string, string | null>;
  /** Сколько строк «email=ourUserId» (валидные). */
  mappedCount: number;
  /** Сколько строк «email=skip». */
  skippedCount: number;
  /** Строки, которые не удалось распарсить (для подсветки в UI). */
  invalidLines: string[];
}

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Парсер пар "email=value" из textarea.
 *
 * Формат строки:
 *   - "email@example.com=user-id-123" -> mapping в нашего пользователя
 *   - "email@example.com=skip"        -> явный пропуск (null)
 *   - "# комментарий"                  -> игнорируется
 *   - пустая строка                    -> игнорируется
 *   - всё остальное                    -> попадёт в invalidLines.
 */
export function parseUserMappings(text: string): ParsedUserMappings {
  const mappings: Record<string, string | null> = {};
  const invalidLines: string[] = [];
  let mappedCount = 0;
  let skippedCount = 0;

  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith('#')) continue;

    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) {
      invalidLines.push(rawLine);
      continue;
    }
    const email = line.slice(0, eqIdx).trim().toLowerCase();
    const value = line.slice(eqIdx + 1).trim();
    if (!EMAIL_RX.test(email) || value.length === 0) {
      invalidLines.push(rawLine);
      continue;
    }
    if (value.toLowerCase() === 'skip') {
      mappings[email] = null;
      skippedCount += 1;
    } else {
      mappings[email] = value;
      mappedCount += 1;
    }
  }

  return { mappings, mappedCount, skippedCount, invalidLines };
}

/**
 * Маскирующее отображение webhook URL Битрикс24.
 *
 * Превращает https://your-portal.bitrix24.ru/rest/12/abc123secret/
 * в https://your-portal.bitrix24.ru/rest/12/(token)/.
 *
 * Также маскирует обычные OAuth-токены: показывает первые/последние 4 символа.
 */
export function MaskedWebhookDisplay({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  const masked = useMemo(() => maskWebhookUrl(url), [url]);
  return (
    <code
      className={
        'inline-block break-all rounded bg-bg-overlay px-2 py-0.5 font-mono text-xs text-fg-secondary ' +
        (className ?? '')
      }
    >
      {masked}
    </code>
  );
}

/** Маскирующий преобразователь URL/токена — экспортируется для preview-шагов. */
export function maskWebhookUrl(input: string): string {
  if (!input) return '';
  // Bitrix24 формат: .../rest/{userId}/{token}/...
  const bitrixRx = /^(https?:\/\/[^/]+\/rest\/\d+\/)([^/]+)(\/.*)?$/i;
  const m = input.match(bitrixRx);
  if (m) {
    return m[1] + '****' + (m[3] ?? '/');
  }
  // OAuth-токен (без слешей) — оставим хвост и голову.
  if (!input.includes('/') && input.length > 10) {
    return input.slice(0, 4) + '...' + input.slice(-4);
  }
  // Иначе — просто заменим всё кроме хоста.
  try {
    const u = new URL(input);
    return u.protocol + '//' + u.host + '/****';
  } catch {
    return '****';
  }
}

/** Простая валидация формата Bitrix24 webhook URL. */
export function isLikelyBitrixWebhook(url: string): boolean {
  return /^https?:\/\/[^/]+\/rest\/\d+\/[^/]+\/?$/i.test(url.trim());
}

/** Парсер comma/newline-separated списка идентификаторов. */
export function parseIdList(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  );
}

/** Валидатор ключа очереди Я.Трекера: 2-10 заглавных латинских букв/цифр. */
const QUEUE_KEY_RX = /^[A-Z][A-Z0-9]{1,9}$/;

export function validateQueueKeys(keys: string[]): {
  valid: string[];
  invalid: string[];
} {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const k of keys) {
    if (QUEUE_KEY_RX.test(k)) valid.push(k);
    else invalid.push(k);
  }
  return { valid, invalid };
}

// ─── Шкала шагов wizard'а (универсальная) ──────────────────────────────────

export interface WizardStepDef {
  id: string;
  label: string;
}

export function WizardSteps({
  steps,
  current,
}: {
  steps: WizardStepDef[];
  current: string;
}) {
  const idx = steps.findIndex((s) => s.id === current);
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs font-medium text-fg-tertiary">
      {steps.map((s, i) => {
        const active = i === idx;
        const done = i < idx;
        return (
          <li
            key={s.id}
            className={
              active
                ? 'rounded-full bg-accent/10 px-3 py-1 text-accent'
                : done
                  ? 'rounded-full bg-bg-overlay px-3 py-1 text-fg-secondary'
                  : 'rounded-full bg-bg-overlay px-3 py-1'
            }
          >
            {i + 1}. {s.label}
          </li>
        );
      })}
    </ol>
  );
}

// ─── Шаг маппинга через свободный текст (общий для Bitrix24 / Я.Трекер) ───

export function FreeTextMappingStep({
  value,
  onChange,
  parsed,
  onBack,
  onNext,
  stepTitle,
}: {
  value: string;
  onChange: (v: string) => void;
  parsed: ParsedUserMappings;
  onBack: () => void;
  onNext: () => void;
  stepTitle: string;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="text-lg font-semibold text-fg-primary">{stepTitle}</h2>
        <p className="mt-1 text-sm text-fg-secondary">
          Сопоставьте email-адреса из внешнего трекера с пользователями Коры.
          Это позволит назначать исполнителей задач автоматически. Шаг не
          обязательный — можно оставить пустым и доделать после импорта.
        </p>

        <div className="mt-4 space-y-2">
          <Label htmlFor="mapping-textarea" className="text-sm">
            Пары «email = ID пользователя» — по одной на строку
          </Label>
          <Textarea
            id="mapping-textarea"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={
              '# Один маппинг на строку. Примеры:\n' +
              'alice@example.com=user_abc123\n' +
              'bob@example.com=skip\n' +
              '# carol@example.com=user_def456  (строки с # игнорируются)\n'
            }
            className="min-h-[160px] font-mono text-xs"
          />
          <p className="text-xs text-fg-tertiary">
            Формат:{' '}
            <code className="rounded bg-bg-overlay px-1 py-0.5">
              email = ourUserId
            </code>{' '}
            (назначить) или{' '}
            <code className="rounded bg-bg-overlay px-1 py-0.5">
              email = skip
            </code>{' '}
            (игнорировать). ID пользователя можно скопировать из раздела
            «Команда».
          </p>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
          <MappingStat label="Сопоставлено" value={parsed.mappedCount} />
          <MappingStat label="Пропущено (skip)" value={parsed.skippedCount} />
          <MappingStat
            label="Ошибок формата"
            value={parsed.invalidLines.length}
            danger={parsed.invalidLines.length > 0}
          />
        </div>

        {parsed.invalidLines.length > 0 && (
          <div className="mt-3 rounded-md border border-warn/30 bg-warn/10 p-3 text-xs text-warn">
            <div className="flex items-center gap-1.5 font-medium">
              <AlertTriangle size={14} /> Не удалось распарсить строки:
            </div>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {parsed.invalidLines.slice(0, 5).map((line, i) => (
                <li key={i}>
                  <code className="font-mono">{line || '(пустая строка)'}</code>
                </li>
              ))}
              {parsed.invalidLines.length > 5 && (
                <li>... ещё {parsed.invalidLines.length - 5}</li>
              )}
            </ul>
            <p className="mt-1">
              Эти строки будут пропущены при запуске — но лучше исправить.
            </p>
          </div>
        )}

        <div className="mt-4 flex items-start gap-2 rounded-md border border-accent/30 bg-accent/5 p-3 text-xs text-fg-secondary">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-accent" />
          <p>
            Email-адреса, которых нет в этом списке, попадут в журнал «не
            сопоставлено» в карточке импорта — вы сможете доделать маппинг
            позже из раздела «Команда».
          </p>
        </div>

        <div className="mt-6 flex justify-between">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={14} /> Назад
          </Button>
          <Button onClick={onNext}>
            Дальше <ArrowRight size={14} />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MappingStat({
  label,
  value,
  danger,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div
      className={
        'rounded-md border p-2 ' +
        (danger
          ? 'border-warn/30 bg-warn/10 text-warn'
          : 'border-border-subtle bg-bg-card text-fg-secondary')
      }
    >
      <div className="text-[11px] uppercase tracking-wide">{label}</div>
      <div
        className={
          'mt-0.5 text-lg font-semibold ' +
          (danger ? 'text-warn' : 'text-fg-primary')
        }
      >
        {value}
      </div>
    </div>
  );
}

// ─── Плитка для preview-шага ──────────────────────────────────────────────

export function SummaryTile({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-md border border-border-subtle bg-bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs text-fg-tertiary">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-fg-primary">{value}</div>
    </div>
  );
}
