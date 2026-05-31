'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, Copy, LinkIcon } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

import { buildReferralUrl, type ReferralDomain } from '@/domain/referral';
import { Button } from '@/ui/shadcn/button';
import { Card } from '@/ui/shadcn/card';
import { Input } from '@/ui/shadcn/input';

interface Props {
  referral: ReferralDomain;
  /** Дополнительная подсказка под ссылкой (для состояния B — «нет данных»). */
  hint?: string | null;
}

/**
 * ReferralLinkCard — карточка партнёрской ссылки (ТЗ §8.1 B/C).
 *
 * Главное действие — копирование URL. Параллельно — QR-код (через
 * `qrcode.react` / `QRCodeSVG`, ~3 KB), чтобы можно было показать на
 * экране и сразу зашерить мобильному.
 *
 * Origin берётся из `window.location.origin` — это безопасно, так как
 * компонент `'use client'`. В SSR-fallback ставим `https://app.kora.app`.
 */
export function ReferralLinkCard({ referral, hint }: Props) {
  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://app.kora.app';
  const url = useMemo(
    () => buildReferralUrl(referral.slug, origin),
    [referral.slug, origin],
  );
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Браузер заблокировал clipboard API — fallback на select-all.
      const input = document.getElementById(
        'referral-url-input',
      ) as HTMLInputElement | null;
      input?.select();
    }
  };

  return (
    <Card className="space-y-4 p-6">
      <header className="flex items-center gap-2">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-muted text-accent"
          aria-hidden="true"
        >
          <LinkIcon className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-fg-primary">
            Твоя партнёрская ссылка
          </h2>
          <p className="text-xs text-fg-tertiary">
            Поделись ей — клики и оплаты попадают тебе автоматически.
          </p>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="referral-url-input"
              value={url}
              readOnly
              className="font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={handleCopy}
              aria-label="Скопировать ссылку"
            >
              {copied ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Скопировано
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Копировать
                </>
              )}
            </Button>
          </div>
          {hint && (
            <p className="rounded-md border border-border-subtle bg-bg-base/40 px-3 py-2 text-sm text-fg-secondary">
              {hint}
            </p>
          )}
        </div>

        <div className="flex justify-center lg:justify-end">
          <div
            className="rounded-md border border-border-subtle bg-bg-card p-3"
            aria-label="QR-код партнёрской ссылки"
          >
            <QRCodeSVG
              value={url}
              size={128}
              bgColor="transparent"
              fgColor="var(--text-primary)"
              level="M"
            />
          </div>
        </div>
      </div>
    </Card>
  );
}
