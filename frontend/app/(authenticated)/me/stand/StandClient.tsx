"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";
import useSWR from "swr";

import { meStandApi } from "@/api/me-stand.api";
import { useAuth } from "@/contexts/auth-context";
import type {
  DayLetter,
  TaskBucketItem,
  TaskBuckets,
  VerdictState,
} from "@/domain/me-stand";

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

function BucketColumn({ title, items, tone }: { title: string; items: TaskBucketItem[]; tone: string }) {
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
          <Link
            key={t.id}
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
        ))}
      </div>
    </div>
  );
}

function TaskBoard() {
  const { data } = useMe<TaskBuckets>("me-task-buckets", () => meStandApi.taskBuckets());
  return (
    <div>
      <div style={sectionTitle}>Мои задачи</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <BucketColumn title="Зависли / просрочено" items={data?.overdueStuck ?? []} tone={STATE_COLOR.risk} />
        <BucketColumn title="В работе" items={data?.inProgress ?? []} tone={STATE_COLOR.warn} />
        <BucketColumn title="Без срока" items={data?.noDueDate ?? []} tone="var(--text-tertiary)" />
        <BucketColumn title="Сделано" items={data?.done ?? []} tone={STATE_COLOR.ok} />
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

function CompanyBlockers() {
  const { data } = useMe("me-company-blockers", () => meStandApi.companyBlockers({ limit: 8 }));
  return (
    <div style={card}>
      <div style={sectionTitle}>Блокеры компании</div>
      <div style={{ display: "grid", gap: 8 }}>
        {(data?.items ?? []).map((b) => (
          <div
            key={b.id}
            style={{
              fontSize: 13,
              color: "var(--text-secondary)",
              paddingLeft: 10,
              borderLeft: `2px solid ${b.isMine ? "var(--accent)" : "var(--border)"}`,
            }}
          >
            {b.isMine && <span style={{ color: "var(--accent)", fontWeight: 700 }}>твой · </span>}
            {b.representativeText.slice(0, 140)}
          </div>
        ))}
        {(data?.items?.length ?? 0) === 0 && (
          <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>блокеров нет</div>
        )}
      </div>
    </div>
  );
}

function CompanyIdeas() {
  const { data } = useMe("me-company-ideas", () => meStandApi.companyIdeas(8));
  return (
    <div style={card}>
      <div style={sectionTitle}>Идеи компании</div>
      {(data?.myIdeasThisMonth ?? 0) > 0 && (
        <div style={{ fontSize: 13, color: "var(--accent)", marginBottom: 8 }}>
          Ты молодец — {data?.myIdeasThisMonth} идей за месяц.
        </div>
      )}
      <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>
        Топ идей компании подтягивается из общего фида.
      </div>
    </div>
  );
}
