"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import useSWR from "swr";
import {
  ArrowLeft,
  History,
  Loader2,
  MessageCircle,
  ShieldAlert,
  Users,
} from "lucide-react";

import { ApiError, humanizeApiError } from "@/api/api-error";
import { clonesApi } from "@/api/clones.api";
import { useAuth } from "@/contexts/auth-context";
import {
  cloneRefusalReasonRu,
  cloneVersionStatusBadge,
  mapAllFormers,
  mapCloneAnswer,
  mapCloneVersion,
  type AllFormersUiResult,
  type CloneAnswer,
  type CloneVersionUiItem,
} from "@/domain/clone";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/shadcn/card";
import { Skeleton } from "@/ui/shadcn/skeleton";
import { Textarea } from "@/ui/shadcn/textarea";
import { toast } from "@/ui/shadcn/toast";

import { AdminForbidden } from "@app/(admin)/admin/AdminStateViews";

export function RoleCloneHistoryClient({ roleId }: { roleId: string }) {
  const { currentOrgId, isLoading } = useAuth();
  if (isLoading) return <HistorySkeleton />;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Раздел доступен только внутри организации."
      />
    );
  }
  return <Content orgId={currentOrgId} roleId={roleId} />;
}

function Content({ orgId, roleId }: { orgId: string; roleId: string }) {
  const { data, error, isLoading } = useSWR(
    ["clone-history", orgId, roleId],
    () => clonesApi.getCloneHistory(orgId, roleId),
  );

  const versions: CloneVersionUiItem[] = useMemo(
    () => (data?.versions ?? []).map(mapCloneVersion),
    [data],
  );

  if (isLoading) return <HistorySkeleton />;

  if (error) {
    const message = humanizeApiError(error, "Не удалось загрузить историю.");
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <BackLink roleId={roleId} />
        <div className="mt-4 rounded-md border border-border-subtle bg-bg-card p-6 text-sm">
          <p className="text-error">{message}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-6 py-8">
      <BackLink roleId={roleId} />

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          История клона должности: {data.roleName}
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Каждая версия — отдельный snapshot клона должности. Версии создаются
          при смене носителя роли или при накоплении значимых изменений в
          навыковом профиле. Снимки бывших носителей замораживаются и остаются
          доступными для вопросов навсегда.
        </p>
      </header>

      {versions.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <History className="mx-auto mb-3 h-8 w-8 text-fg-tertiary" />
            <p className="text-sm text-fg-primary">
              У клона пока единственная версия (v1).
            </p>
            <p className="mt-1 text-xs text-fg-tertiary">
              Новые версии появятся, когда сменится носитель роли или накопится
              достаточно изменений в навыковом профиле.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Версии ({versions.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border-subtle">
              {versions.map((v) => (
                <VersionRow key={v.personaId} orgId={orgId} version={v} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <FormersCouncil orgId={orgId} roleId={roleId} roleName={data.roleName} />
    </div>
  );
}

function VersionRow({
  orgId,
  version: v,
}: {
  orgId: string;
  version: CloneVersionUiItem;
}) {
  const [asking, setAsking] = useState(false);
  const badge = cloneVersionStatusBadge(v.status);

  return (
    <li className="space-y-3 py-3 text-sm">
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-[1fr,auto] sm:items-center sm:gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">v{v.version}</Badge>
            <span className="font-medium">{v.publicName}</span>
            <Badge variant={badge.variant} className="text-[10px]">
              {badge.label}
            </Badge>
          </div>
          <div className="text-xs text-fg-secondary">
            Период: {v.validFrom.toLocaleDateString("ru-RU")} —{" "}
            {v.validUntil
              ? v.validUntil.toLocaleDateString("ru-RU")
              : "по сейчас"}
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="text-xs text-fg-tertiary sm:text-right">
            <span>Уверенность: {v.confidencePct}%</span>
            <span className="mx-1">·</span>
            <span>черт: {v.traitsCount}</span>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setAsking((prev) => !prev)}
            aria-expanded={asking}
          >
            <MessageCircle className="mr-1.5 h-4 w-4" />
            {asking ? "Скрыть" : "Спросить эту версию"}
          </Button>
        </div>
      </div>

      {asking ? (
        <AskVersionPanel
          orgId={orgId}
          roleId={v.roleId}
          roleVersion={v.version}
          publicName={v.publicName}
        />
      ) : null}
    </li>
  );
}

function AskVersionPanel({
  orgId,
  roleId,
  roleVersion,
  publicName,
}: {
  orgId: string;
  roleId: string;
  roleVersion: number;
  publicName: string;
}) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [answer, setAnswer] = useState<CloneAnswer | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const question = input.trim();
    if (!question || sending) return;
    if (question.length < 3) {
      toast.error("Слишком короткий вопрос (минимум 3 символа).");
      return;
    }
    setSending(true);
    try {
      const res = await clonesApi.askRole(orgId, roleId, {
        question,
        roleVersion,
      });
      setAnswer(mapCloneAnswer(res));
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : "Не удалось получить ответ этой версии клона.";
      toast.error(message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-md border border-border-subtle bg-bg-base p-3">
      <p className="mb-2 text-xs text-fg-tertiary">
        Вопрос к версии «{publicName}» (v{roleVersion}).
      </p>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={2}
          placeholder="Задайте вопрос этой версии клона…"
          disabled={sending}
          className="resize-none"
        />
        <div className="flex justify-end">
          <Button
            type="submit"
            size="sm"
            disabled={sending || input.trim().length < 3}
          >
            {sending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <MessageCircle className="mr-1.5 h-4 w-4" />
            )}
            Спросить
          </Button>
        </div>
      </form>

      {answer ? <AnswerBlock answer={answer} /> : null}
    </div>
  );
}

function FormersCouncil({
  orgId,
  roleId,
  roleName,
}: {
  orgId: string;
  roleId: string;
  roleName: string;
}) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<AllFormersUiResult | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const question = input.trim();
    if (!question || sending) return;
    if (question.length < 3) {
      toast.error("Слишком короткий вопрос (минимум 3 символа).");
      return;
    }
    setSending(true);
    try {
      const res = await clonesApi.askAllFormers(orgId, roleId, { question });
      setResult(mapAllFormers(res));
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : "Не удалось опросить версии клона.";
      toast.error(message);
    } finally {
      setSending(false);
    }
  }

  return (
    <Card id="council" className="scroll-mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4" />
          Совет бывших
        </CardTitle>
        <p className="text-sm text-fg-secondary">
          Задайте один вопрос — на него ответят все версии клона должности «
          {roleName}» (включая снимки бывших носителей). Сравните подходы рядом.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={3}
            placeholder="Например: как бы вы подошли к запуску нового продукта?"
            disabled={sending}
            className="resize-none"
          />
          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              disabled={sending || input.trim().length < 3}
            >
              {sending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Users className="mr-1.5 h-4 w-4" />
              )}
              Спросить всех бывших
            </Button>
          </div>
        </form>

        {sending && !result ? (
          <div className="flex items-center gap-2 text-sm text-fg-tertiary">
            <Loader2 className="h-4 w-4 animate-spin" />
            Опрашиваем версии клона…
          </div>
        ) : null}

        {result ? (
          result.answers.length === 0 ? (
            <p className="text-sm text-fg-secondary">
              У этой должности пока нет версий клона, способных ответить.
            </p>
          ) : (
            <div className="space-y-3">
              {result.answers.map((a) => {
                const badge = cloneVersionStatusBadge(a.status);
                return (
                  <div
                    key={a.personaId}
                    className="rounded-md border border-border-subtle bg-bg-base p-3"
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">v{a.version}</Badge>
                      <span className="text-sm font-medium">
                        {a.publicName}
                      </span>
                      <Badge variant={badge.variant} className="text-[10px]">
                        {badge.label}
                      </Badge>
                    </div>
                    {a.error ? (
                      <p className="text-sm text-fg-tertiary">
                        Эта версия не смогла ответить: {a.error}
                      </p>
                    ) : a.answer ? (
                      <AnswerBlock answer={a.answer} />
                    ) : (
                      <p className="text-sm text-fg-tertiary">
                        Ответ недоступен.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

function AnswerBlock({ answer }: { answer: CloneAnswer }) {
  if (answer.refused) {
    return (
      <div className="mt-3 rounded-md border border-warning/40 bg-warning/5 p-3">
        <div className="mb-1 flex items-center gap-2 text-xs font-medium text-warning">
          <ShieldAlert size={14} />
          Клон отказался отвечать
        </div>
        <p className="text-sm text-fg-secondary">
          {cloneRefusalReasonRu(answer.refusalReason)}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <p className="whitespace-pre-wrap text-sm text-fg-primary">
        {answer.text}
      </p>
      {answer.citations.length > 0 ? (
        <div className="space-y-1.5 border-t border-border-subtle pt-2">
          <div className="text-xs font-medium text-fg-tertiary">Источники:</div>
          {answer.citations.slice(0, 5).map((c, i) => (
            <div
              key={`${c.blockId}-${i}`}
              className="rounded bg-bg-card px-2 py-1.5 text-xs"
            >
              <div className="font-medium">{c.meetingTitle ?? "Источник"}</div>
              {c.snippet ? (
                <div className="mt-0.5 italic text-fg-secondary">
                  «{c.snippet}»
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BackLink({ roleId }: { roleId: string }) {
  return (
    <Link
      href={`/clones/${encodeURIComponent(roleId)}`}
      className="inline-flex items-center gap-1 text-sm text-fg-secondary hover:text-fg-primary"
    >
      <ArrowLeft size={14} />К клону должности
    </Link>
  );
}

function HistorySkeleton() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-6 py-8">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
