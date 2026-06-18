"use client";

import { useState } from "react";
import useSWR from "swr";
import { Bot, Loader2, Send, Sparkles, Users } from "lucide-react";

import { ApiError } from "@/api/api-error";
import { clonesApi } from "@/api/clones.api";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "sonner";
import { mapCloneAnswer, type CloneAnswer } from "@/domain/clone";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/shadcn/card";
import { Skeleton } from "@/ui/shadcn/skeleton";
import { Textarea } from "@/ui/shadcn/textarea";

export function RoleSkillProfileClient({ roleId }: { roleId: string }) {
  const { currentOrgId, isLoading } = useAuth();

  const swrKey = currentOrgId
    ? ["role-skill-profile", currentOrgId, roleId]
    : null;
  const {
    data,
    error,
    isLoading: loading,
  } = useSWR(swrKey, async () =>
    clonesApi.getRoleSkillProfile(currentOrgId!, roleId),
  );

  const [chatOpen, setChatOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<
    Array<{
      id: string;
      role: "user" | "assistant";
      text: string;
      clone?: CloneAnswer;
    }>
  >([]);

  async function handleAsk() {
    if (!currentOrgId) return;
    const text = question.trim();
    if (text.length < 3) {
      toast.error("Вопрос слишком короткий.");
      return;
    }
    setPending(true);
    const userMessageId = `user-${Date.now()}`;
    setMessages((prev) => [...prev, { id: userMessageId, role: "user", text }]);
    setQuestion("");
    try {
      const apiRes = await clonesApi.askRole(currentOrgId, roleId, {
        question: text,
        conversationId: conversationId ?? undefined,
      });
      const answer = mapCloneAnswer(apiRes);
      setConversationId(answer.conversationId);
      setMessages((prev) => [
        ...prev,
        {
          id: answer.messageId,
          role: "assistant",
          text: answer.text,
          clone: answer,
        },
      ]);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? (err.payload?.message ?? err.message)
          : "Не удалось получить ответ от клона роли.";
      toast.error(message);
      setMessages((prev) => prev.filter((m) => m.id !== userMessageId));
    } finally {
      setPending(false);
    }
  }

  if (isLoading || loading) {
    return (
      <section className="space-y-4 p-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="p-4">
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            Не удалось загрузить профиль роли. Возможно, у вас нет доступа.
          </CardContent>
        </Card>
      </section>
    );
  }
  if (!data) return null;

  return (
    <section className="space-y-4 p-4">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Навыковый профиль роли: {data.roleName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Топ-черт подхода к решениям, наблюдаемых у сотрудников этой должности.
          Агрегат по всем active SkillProfile роли.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" />
            Топ общих черт
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.topTraits.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Пока нет накопленных черт для этой роли.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.topTraits.map((t) => (
                <li key={t.category} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t.category}</span>
                    <Badge variant="outline">
                      наблюдений: {t.observationCount}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground">{t.statement}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            Сотрудники на роли ({data.people.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.people.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              На этой роли пока нет сотрудников с накопленным профилем.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {data.people.map((p) => (
                <li
                  key={p.personId}
                  className="flex items-center justify-between"
                >
                  <a
                    href={`/persons/${p.personId}/skill-profile`}
                    className="underline hover:text-foreground"
                  >
                    {p.personName}
                  </a>
                  <span className="text-xs text-muted-foreground">
                    черт: {p.activeTraitsCount} · v{p.profileBuildVersion}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="h-4 w-4" />
            Попробовать клона роли
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Чат с агрегатным клоном роли — отвечает в стиле «типичного носителя
            этой должности», опираясь на накопленные обсуждения подхода к
            решениям.
          </p>
          {!data.hasRolePersona && (
            <p className="text-sm text-warning">
              Клон роли пока не собран — нужно минимум 2 сотрудника с активным
              профилем. Снапшот собирается воскресенье 06:00.
            </p>
          )}
          {!chatOpen ? (
            <Button
              type="button"
              onClick={() => setChatOpen(true)}
              disabled={!data.hasRolePersona}
            >
              Начать диалог
            </Button>
          ) : (
            <div className="space-y-3">
              <ul className="space-y-2">
                {messages.map((m) => (
                  <li key={m.id}>
                    <Card
                      className={
                        m.role === "user"
                          ? "ml-auto max-w-[80%]"
                          : "max-w-[85%]"
                      }
                    >
                      <CardContent className="p-3 text-sm">
                        {m.role === "assistant" && (
                          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                            <Bot className="h-3 w-3" />
                            <span>Клон роли</span>
                            <Badge variant="secondary" className="gap-1">
                              <Sparkles className="h-3 w-3" />в стиле роли
                            </Badge>
                          </div>
                        )}
                        <div className="whitespace-pre-wrap">{m.text}</div>
                      </CardContent>
                    </Card>
                  </li>
                ))}
                {pending && (
                  <li>
                    <Card>
                      <CardContent className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Клон роли думает…
                      </CardContent>
                    </Card>
                  </li>
                )}
              </ul>
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Как подходит эта роль к ...?"
                rows={3}
                disabled={pending}
              />
              <div className="flex items-center justify-end">
                <Button
                  type="button"
                  onClick={() => void handleAsk()}
                  disabled={pending || question.trim().length < 3}
                >
                  <Send className="mr-2 h-4 w-4" />
                  Спросить
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
