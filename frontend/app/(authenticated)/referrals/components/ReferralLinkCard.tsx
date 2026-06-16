"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Copy, LinkIcon } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import { buildReferralUrl, type ReferralDomain } from "@/domain/referral";
import { GRAD, glass } from "@/ui/components/dashboard/modern";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";

interface Props {
  referral: ReferralDomain;
  hint?: string | null;
}

export function ReferralLinkCard({ referral, hint }: Props) {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://app.kora.app";
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
      const input = document.getElementById(
        "referral-url-input",
      ) as HTMLInputElement | null;
      input?.select();
    }
  };

  return (
    <div style={glass()} className="space-y-4 p-6">
      <header className="flex items-center gap-2.5">
        <span
          className="grid h-8 w-8 place-items-center rounded-xl"
          style={{ background: GRAD.blue, color: "oklch(0.99 0.005 280)" }}
          aria-hidden="true"
        >
          <LinkIcon className="h-4 w-4" />
        </span>
        <div>
          <h2
            className="text-[15px] font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            Твоя партнёрская ссылка
          </h2>
          <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
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
            <p
              className="rounded-xl px-3 py-2 text-sm"
              style={{
                background: "var(--surface-inset)",
                border: "1px solid var(--border-inset)",
                color: "var(--text-secondary)",
              }}
            >
              {hint}
            </p>
          )}
        </div>

        <div className="flex justify-center lg:justify-end">
          <div
            className="rounded-2xl p-3"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-inset)",
            }}
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
    </div>
  );
}
