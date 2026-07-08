"use client";

import { AlertTriangle, Lightbulb, Users } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";
import useSWR from "swr";

import { meStandApi } from "@/api/me-stand.api";
import { myCheckInsApi } from "@/api/my-check-ins.api";
import { useAuth } from "@/contexts/auth-context";
import { ideaHref, IDEA_KIND_LABEL, IDEA_STATUS_LABEL } from "@/domain/idea";
import type {
  DayLetter,
  TaskBucketItem,
  TaskBuckets,
  VerdictState,
} from "@/domain/me-stand";
import {
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
  STATUS_TONE,
} from "@/ui/components/dashboard/modern";

const STATE_COLOR: Record<VerdictState, string> = {
  ok: "var(--accent)",
  warn: "oklch(0.8 0.12 75)",
  risk: "oklch(0.68 0.16 25)",
};

const card: CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: 16,
  padding: 20,
};

const sectionTitle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-tertiary)",
  marginBottom: 12,
};

function useMe<T>(key: string, fetcher: () => Promise<T>) {
  const { currentOrgId } = useAuth();
  return useSWR(currentOrgId ? ([key, currentOrgId] as const) : null, fetcher);
}

export function StandClient() {
  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "24px 20px 80px", display: "grid", gap: 20 }}>
      <LetterCover />
      <TaskBoard />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <RequiresYou />
        <NightLedger />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <OnYourSide />
        <YouMove />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <CompanyBlockers />
        <CompanyIdeas />
      </div>
      <p style={{ textAlign: "center", fontSize: 12.5, color: "var(--text-tertiary)" }}>
        Кора показывает тебе то же, что руководителю — про тебя, и первым.
      </p>
    </div>
  );
}

function LetterCover() {
  const { data } = useMe<DayLetter>("me-day-letter", () => meStandApi.dayLetter());
  const sentFor = useRef<string | null>(null);
  useEffect(() => {
    if (!data?.generated || !data.verdict) return;
    const key = data.dateLocal;
    if (sentFor.current === key) return;
    sentFor.current = key;
  }, [data?.generated, data?.dateLocal, data?.verdict]);

  if (!data || !data.generated || !data.verdict) {
    return (
      <div style={{ ...card, background: "var(--bg-elevated)" }}>
        <div style={sectionTitle}>Твой день</div>
        <p style={{ color: "var(--text-secondary)", margin: 0 }}>
          Письмо придёт утром — Кора соберёт итог твоего вчерашнего дня.
        </p>
      </div>
    );
  }

  const v = data.verdict;
  return (
    <div style={{ ...card, background: "var(--bg-elevated)", padding: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 26 }}>{v.overall.emoji}</span>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: "var(--text-primary)" }}>
          {v.overall.title}
        </h1>
      </div>
      <p style={{ fontSize: 16, color: "var(--text-secondary)", marginTop: 8 }}>{v.overall.oneLiner}</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 18 }}>
        {v.axes.map((ax) => (
          <div
            key={ax.key}
            style={{
              borderRadius: 12,
              padding: "12px 14px",
              background: "var(--bg-card)",
              borderLeft: `3px solid ${STATE_COLOR[ax.state]}`,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{ax.label}</div>
            <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 3 }}>{ax.why}</div>
          </div>
        ))}
      </div>

      <details style={{ marginTop: 18 }}>
        <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--accent)", fontWeight: 600 }}>
          Письмо целиком
        </summary>
        <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
          {data.letter.map((s) => (
            <div key={s.key}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{s.title}</div>
              <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "4px 0 0", lineHeight: 1.6 }}>
                {s.prose}
              </p>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function BucketColumn({
  title,
  items,
  tone,
  pendingMethodIds,
}: {
  title: string;
  items: TaskBucketItem[];
  tone: string;
  pendingMethodIds?: Set<string>;
}) {
  return (
    <div style={{ ...card, padding: 14 }}>
      <div style={{ ...sectionTitle, marginBottom: 10, color: tone }}>
        {title} · {items.length}
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {items.length === 0 && (
          <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>пусто</div>
        )}
        {items.map((t) => (
          <div key={t.id} style={{ display: "grid", gap: 4 }}>
            <Link
              href={`/issues/${t.id}`}
              style={{
                display: "block",
                textDecoration: "none",
                borderRadius: 10,
                padding: "10px 12px",
                background: "var(--surface-inset)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.4 }}>
                <span style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono, monospace)" }}>
                  {t.identifier}
                </span>{" "}
                {t.title}
              </div>
              {(t.dueDate || t.reason) && (
                <div style={{ fontSize: 11.5, color: tone, marginTop: 4 }}>
                  {t.reason === "overdue_and_stuck"
                    ? "просрочено + зависло"
                    : t.reason === "overdue"
                      ? "просрочено"
                      : t.reason === "stuck"
                        ? "зависло"
                        : t.dueDate
                          ? `срок ${t.dueDate.slice(0, 10)}`
                          : ""}
                </div>
              )}
            </Link>
            {pendingMethodIds?.has(t.id) && (
              <Link
                href={`/issues/${t.id}`}
                style={{
                  fontSize: 12,
                  color: "var(--accent)",
                  textDecoration: "none",
                  paddingLeft: 2,
                }}
              >
                🎤 расскажи как делал
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function TaskBoard() {
  const { data } = useMe<TaskBuckets>("me-task-buckets", () => meStandApi.taskBuckets());
  const { data: pending } = useMe("me-method-capture-pending", () => meStandApi.methodCapturePending());
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const { data: eveningYesterday } = useMe("me-evening-checkin-yesterday", () =>
    myCheckInsApi.list({ date: yesterday, kind: "evening" }),
  );
  const pendingMethodIds = new Set((pending?.items ?? []).map((i) => i.id));
  const missedEveningCheckIn =
    eveningYesterday !== undefined && eveningYesterday.items.length === 0;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ ...sectionTitle, marginBottom: 0 }}>Мои задачи</div>
        <Link
          href="/me/inbox"
          style={{ fontSize: 12, color: CHART.cyan, textDecoration: "none" }}
        >
          Все задачи →
        </Link>
      </div>
      {missedEveningCheckIn && (
        <div
          style={{
            ...card,
            padding: "12px 16px",
            marginBottom: 12,
            borderColor: STATE_COLOR.warn,
            background: "var(--bg-elevated)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)" }}>
            <span style={{ fontSize: 16 }}>⚠️</span>
            Ты не отчитался за вчера — вечерний чек-ин не сдан.
          </div>
          <Link
            href="/me/check-ins"
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: STATE_COLOR.warn,
              textDecoration: "none",
              borderRadius: 8,
              padding: "6px 12px",
              border: `1px solid ${STATE_COLOR.warn}`,
            }}
          >
            Проверить и сдать
          </Link>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <BucketColumn title="Зависли / просрочено" items={data?.overdueStuck ?? []} tone={STATE_COLOR.risk} />
        <BucketColumn title="В работе" items={data?.inProgress ?? []} tone={STATE_COLOR.warn} />
        <BucketColumn title="Без срока" items={data?.noDueDate ?? []} tone="var(--text-tertiary)" />
        <BucketColumn
          title="Сделано"
          items={data?.done ?? []}
          tone={STATE_COLOR.ok}
          pendingMethodIds={pendingMethodIds}
        />
      </div>
    </div>
  );
}

function RequiresYou() {
  const { data } = useMe("me-requires-you", () => meStandApi.requiresYou());
  return (
    <div style={card}>
      <div style={sectionTitle}>Требует тебя</div>
      <div style={{ display: "grid", gap: 8 }}>
        {(data?.commitmentsOverdue ?? []).map((c) => (
          <div key={c.id} style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            <span style={{ color: STATE_COLOR.risk }}>●</span> Ты обещал: {c.text}
            {c.dueLabel ? ` (срок ${c.dueLabel}, ${c.ageDays} дн.)` : ""}
          </div>
        ))}
        {(data?.decisionsWithoutTask ?? []).map((d) => (
          <div key={d.id} style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            <span style={{ color: STATE_COLOR.warn }}>●</span> Решение без задачи: {d.statement}
          </div>
        ))}
        {(data?.counts.commitmentsOverdue ?? 0) + (data?.counts.decisionsWithoutTask ?? 0) === 0 && (
          <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>всё закрыто</div>
        )}
      </div>
    </div>
  );
}

function NightLedger() {
  const { data } = useMe("me-night-ledger", () => meStandApi.nightLedger());
  return (
    <div style={card}>
      <div style={sectionTitle}>Кора за ночь</div>
      <div style={{ display: "grid", gap: 8, fontSize: 13, color: "var(--text-secondary)" }}>
        {(data?.counts.autoDrafts ?? 0) > 0 && <div>📝 Черновики отчётов готовы: {data?.counts.autoDrafts}</div>}
        {(data?.counts.meetingTasks ?? 0) > 0 && <div>🎯 Задачи из встреч: {data?.counts.meetingTasks}</div>}
        {(data?.counts.cloneAnswers ?? 0) > 0 && <div>🤖 Клон ответил за тебя: {data?.counts.cloneAnswers}</div>}
        {(data?.counts.autoDrafts ?? 0) + (data?.counts.meetingTasks ?? 0) + (data?.counts.cloneAnswers ?? 0) === 0 && (
          <div style={{ color: "var(--text-tertiary)" }}>ночью тихо</div>
        )}
      </div>
    </div>
  );
}

function OnYourSide() {
  const { data: load } = useMe("me-load", () => meStandApi.load());
  const { data: stuck } = useMe("me-stuck", () => meStandApi.stuck());
  const { data: plan } = useMe("me-plan-signal", () => meStandApi.planSignal());

  const overloaded = load?.row?.level === "overloaded";
  const stuckCount = stuck?.items.length ?? 0;
  const planTriggered = plan?.triggered ?? false;
  const notDone = (plan?.lastNotDoneItems ?? []).slice(0, 3);

  if (!overloaded && stuckCount === 0 && !planTriggered) return null;

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ ...sectionTitle, marginBottom: 0 }}>Кора на твоей стороне</div>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)" }}>ты видишь это первым</span>
      </div>
      <div style={{ display: "grid", gap: 8, fontSize: 13, color: "var(--text-secondary)" }}>
        {overloaded && (
          <div>
            <span style={{ color: STATE_COLOR.risk }}>●</span> Ты взял {load?.row?.activeTasks} задач — это перегруз.
          </div>
        )}
        {stuckCount > 0 && (
          <div>
            <span style={{ color: STATE_COLOR.warn }}>●</span> {stuckCount} задач зависли больше{" "}
            {stuck?.staleDaysThreshold} дней.
          </div>
        )}
        {planTriggered && (
          <div>
            <div>
              <span style={{ color: STATE_COLOR.warn }}>●</span> {plan?.streakDays}-й день план не закрывается полностью.
            </div>
            {notDone.length > 0 && (
              <ul style={{ margin: "4px 0 0 20px", padding: 0, fontSize: 12.5, color: "var(--text-tertiary)" }}>
                {notDone.map((item, i) => (
                  <li key={`${i}-${item}`}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function YouMove() {
  const { data: letter } = useMe<DayLetter>("me-day-letter", () => meStandApi.dayLetter());
  const { data: clone } = useMe("me-clone-impact", () => meStandApi.cloneImpact());
  const { data: expertise } = useMe("me-expertise", () => meStandApi.expertise());

  const contribution = letter?.verdict?.axes.find((a) => a.key === "contribution");
  const cloneAnswers = clone?.answeredGroundedCount ?? 0;
  const topTheme = expertise?.themes[0];

  if (!contribution && cloneAnswers === 0 && !topTheme) return null;

  return (
    <div style={card}>
      <div style={sectionTitle}>Ты двигаешь</div>
      <div style={{ display: "grid", gap: 10 }}>
        {contribution && (
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text-primary)" }}>{contribution.label}</div>
            <div style={{ fontSize: 12.5, color: "var(--text-tertiary)", marginTop: 2 }}>{contribution.why}</div>
          </div>
        )}
        {cloneAnswers > 0 && (
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            🤖 Твой клон ответил за тебя {cloneAnswers} раз.
          </div>
        )}
        {topTheme && (
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            📈 Ты растёшь как эксперт по «{topTheme.name}».
          </div>
        )}
      </div>
    </div>
  );
}

const BLOCKER_STATUS_TONE: Record<string, "ok" | "warning" | "risk"> = {
  new: "warning",
  recurring: "risk",
  resolved: "ok",
};

const BLOCKER_STATUS_LABEL: Record<string, string> = {
  new: "новый",
  recurring: "повторяется",
  resolved: "решён",
};

function BlockerStatusPill({ status }: { status: string }) {
  const toneKey = BLOCKER_STATUS_TONE[status];
  const tone = toneKey
    ? STATUS_TONE[toneKey]
    : { c: CHART.dim, bg: "var(--surface-inset)" };
  return (
    <span
      className="shrink-0 rounded-full px-3 py-1 text-xs font-medium"
      style={{ color: tone.c, background: tone.bg }}
    >
      {BLOCKER_STATUS_LABEL[status] ?? status}
    </span>
  );
}

function CompanyBlockers() {
  const { data, isLoading } = useMe("me-company-blockers", () =>
    meStandApi.companyBlockers({ limit: 10 }),
  );
  const items = data?.items ?? [];
  return (
    <GlassCard>
      <CardTitle icon={<AlertTriangle size={16} />} grad={GRAD.amber}>
        Блокеры компании
      </CardTitle>
      <div className="mt-4">
        {isLoading ? (
          <p className="text-sm" style={{ color: CHART.dim }}>
            Загрузка…
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm" style={{ color: CHART.dim }}>
            Хронических блокеров нет.
          </p>
        ) : (
          <ul className="space-y-3">
            {items.map((b) => (
              <li
                key={b.id}
                className="rounded-xl p-3"
                style={{ background: "var(--surface-inset)" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex-1 text-sm">
                    {b.isMine && (
                      <span
                        className="mr-2 rounded-full px-2 py-0.5 align-middle text-[11px] font-semibold"
                        style={{
                          color: "var(--accent)",
                          border: "1px solid var(--accent)",
                        }}
                      >
                        твой
                      </span>
                    )}
                    {b.representativeText}
                  </span>
                  <BlockerStatusPill status={b.status} />
                </div>
                <div className="mt-1.5 text-xs" style={{ color: CHART.faint }}>
                  <span className="tabular-nums">{b.daysOpen} дн. открыт</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </GlassCard>
  );
}

function CompanyIdeas() {
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const { data, isLoading } = useMe("me-company-ideas", () =>
    meStandApi.companyIdeas(6),
  );
  const items = (data?.top?.items ?? []).slice(0, 6);
  return (
    <GlassCard>
      <div className="flex items-center justify-between gap-3">
        <CardTitle icon={<Lightbulb size={16} />} grad={GRAD.amber}>
          Идеи компании
        </CardTitle>
        <Link
          href="/ideas"
          className="text-xs hover:underline"
          style={{ color: CHART.cyan }}
        >
          Все →
        </Link>
      </div>

      {(data?.myIdeasThisMonth ?? 0) > 0 && (
        <p
          className="mt-3 text-sm font-medium"
          style={{ color: "var(--accent)" }}
        >
          Ты молодец — {data?.myIdeasThisMonth} идей за месяц.
        </p>
      )}

      <div className="mt-4">
        {isLoading ? (
          <ul className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <li
                key={i}
                className="h-12 animate-pulse rounded-xl"
                style={{ background: "var(--surface-inset)" }}
              />
            ))}
          </ul>
        ) : items.length === 0 ? (
          <p className="py-4 text-sm" style={{ color: CHART.faint }}>
            Идей пока нет.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {items.map((idea) => (
              <li key={idea.id}>
                <Link
                  href={ideaHref(idea.id)}
                  className="block rounded-xl px-3 py-2.5 transition-colors hover:bg-[var(--surface-hover)]"
                >
                  <p
                    className="line-clamp-2 text-sm"
                    style={{ color: CHART.text }}
                  >
                    {idea.statement}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                    {currentUserId &&
                      idea.createdByUserId === currentUserId && (
                        <span
                          className="rounded-full px-2 py-0.5 font-semibold"
                          style={{
                            color: "var(--accent)",
                            border: "1px solid var(--accent)",
                          }}
                        >
                          твоя
                        </span>
                      )}
                    <span
                      className="rounded-full px-2 py-0.5 font-medium"
                      style={{
                        background: "var(--surface-inset)",
                        color: CHART.dim,
                      }}
                    >
                      {IDEA_STATUS_LABEL[idea.status]}
                    </span>
                    <span style={{ color: CHART.faint }}>
                      {IDEA_KIND_LABEL[idea.kind]}
                    </span>
                    {idea.supporterCount > 0 && (
                      <span
                        className="inline-flex items-center gap-1"
                        style={{ color: CHART.faint }}
                      >
                        <Users size={11} />
                        {idea.supporterCount}
                      </span>
                    )}
                    <span
                      className="tabular-nums"
                      style={{ color: CHART.faint }}
                    >
                      вес {Math.round(idea.weight)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </GlassCard>
  );
}
