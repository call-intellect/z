'use client';

/**
 * `IntroWizardWidget` — онбординг-плашка между Hero и Tabs.
 *
 * 4 состояния (см. ТЗ `2026-06-01-dashboard-main-tabs-restructure.md` Фаза 5):
 *   1. role=member → null.
 *   2. setupCompletedAt + ≤30 дней → компактная плашка «✅ Компания
 *      настроена · N дн. назад».
 *   3. setupCompletedAt + >30 дней → null.
 *   4. setupCompletedAt=null:
 *      - localStorage `dashboard.onboardingDeferredUntil` > now() → null.
 *      - иначе полный блок с прогрессом N/6 + CTA «Пройти знакомство» +
 *        кнопка «Отложить на неделю».
 *
 * 6 шагов прогресса (по полям Org):
 *   welcomeCompletedAt → companyInfoCompletedAt → departmentsCompletedAt →
 *   rolesCompletedAt → teamInvitedAt → (firstMeetingCreatedAt OR firstSprintCreatedAt).
 */

import Link from 'next/link';
import { ArrowRight, CheckCircle2, Clock, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import useSWR from 'swr';

import { orgsApi } from '@/api/orgs.api';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/ui/shadcn/button';

const DEFER_LS_KEY = 'dashboard.onboardingDeferredUntil';
const SHOW_AFTER_DEFER_MS = 7 * 24 * 60 * 60 * 1000; // 7 дней
const COMPACT_TTL_DAYS = 30;
const TOTAL_STEPS = 6;

function readDeferredUntil(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DEFER_LS_KEY);
    if (!raw) return null;
    const v = Number(raw);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function writeDeferredUntil(ts: number | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (ts == null) window.localStorage.removeItem(DEFER_LS_KEY);
    else window.localStorage.setItem(DEFER_LS_KEY, String(ts));
  } catch {
    // silent — privacy mode и т.п.
  }
}

function daysAgo(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

type OrgProgressFields = {
  welcomeCompletedAt?: string | null;
  companyInfoCompletedAt?: string | null;
  departmentsCompletedAt?: string | null;
  rolesCompletedAt?: string | null;
  teamInvitedAt?: string | null;
  firstMeetingCreatedAt?: string | null;
  firstSprintCreatedAt?: string | null;
  setupCompletedAt?: string | null;
};

function countCompleted(org: OrgProgressFields): number {
  let n = 0;
  if (org.welcomeCompletedAt) n++;
  if (org.companyInfoCompletedAt) n++;
  if (org.departmentsCompletedAt) n++;
  if (org.rolesCompletedAt) n++;
  if (org.teamInvitedAt) n++;
  if (org.firstMeetingCreatedAt || org.firstSprintCreatedAt) n++;
  return n;
}

export function IntroWizardWidget() {
  const { currentOrgId, currentOrgRole } = useAuth();
  const [deferredUntil, setDeferredUntil] = useState<number | null>(null);

  useEffect(() => {
    setDeferredUntil(readDeferredUntil());
  }, []);

  const swr = useSWR(
    currentOrgId ? ['intro-wizard-org', currentOrgId] : null,
    () => orgsApi.byId(currentOrgId!),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const handleDefer = useCallback(() => {
    const ts = Date.now() + SHOW_AFTER_DEFER_MS;
    writeDeferredUntil(ts);
    setDeferredUntil(ts);
  }, []);

  // ── Role-gate. ───────────────────────────────────────────────────
  if (!currentOrgRole) return null;
  if (currentOrgRole !== 'owner' && currentOrgRole !== 'admin') return null;

  if (!swr.data) return null;
  const org = swr.data.org as OrgProgressFields;

  // ── Состояние 1: setupCompletedAt — компактная или null. ─────────
  if (org.setupCompletedAt) {
    const dn = daysAgo(org.setupCompletedAt);
    if (dn > COMPACT_TTL_DAYS) return null;
    return (
      <div className="flex items-center gap-2 rounded-xl border border-chip-success-bg bg-chip-success-bg/20 px-4 py-2 text-sm">
        <CheckCircle2 size={16} className="shrink-0 text-chip-success-fg" />
        <span className="text-fg-primary">Компания настроена</span>
        <span className="text-fg-tertiary">· {dn} дн. назад</span>
      </div>
    );
  }

  // ── Состояние 2: отложено пользователем. ─────────────────────────
  if (deferredUntil && deferredUntil > Date.now()) return null;

  // ── Состояние 3: полный блок прогресса. ──────────────────────────
  const completed = countCompleted(org);

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex-1">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-accent">
            <Sparkles size={14} />
            Настройка компании
          </div>
          <h2 className="text-lg font-semibold text-fg-primary">
            Настройка {completed}/{TOTAL_STEPS}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-fg-secondary">
            Добавьте отделы, должности и сотрудников — после этого AI начнёт
            собирать карты должностей и подсказывать «кто за что отвечает».
          </p>
          {/* Прогресс-бар */}
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-bg-overlay/60">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${(completed / TOTAL_STEPS) * 100}%` }}
            />
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 md:flex-row md:items-center">
          <Button asChild size="lg">
            <Link href="/onboarding/company/step-1">
              Пройти знакомство <ArrowRight size={16} className="ml-1" />
            </Link>
          </Button>
          <button
            type="button"
            onClick={handleDefer}
            className="inline-flex items-center justify-center gap-1 rounded-md border border-border-default bg-bg-overlay/40 px-3 py-1.5 text-xs font-medium text-fg-secondary transition-colors hover:bg-bg-overlay/80 hover:text-fg-primary"
          >
            <Clock size={12} />
            Отложить на неделю
          </button>
        </div>
      </div>
    </div>
  );
}
