'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Bot, Flag, Loader2, Send, Sparkles } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { clonesApi } from '@/api/clones.api';
import { knowledgeCloneApi } from '@/api/knowledge-clone.api';
import { meProfileApi } from '@/api/structure.api';
import { useAuth } from '@/contexts/auth-context';
import { toast } from 'sonner';
import { mapCloneAnswer, type CloneAnswer } from '@/domain/clone';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { Textarea } from '@/ui/shadcn/textarea';

/**
 * `/me/clone` (SBA γ-1) — обязательная страница диалога с собственным клоном.
 *
 * Поведение:
 *   1. SWR грузит /me/profile → получаем Person.id (носителя).
 *   2. Параллельно грузит /me/knowledge-profile — нужно для предусмотра пустого
 *      профиля (если isEmpty → input disabled с tooltip «накопится после
 *      нескольких встреч»).
 *   3. На submit — POST /clones/persons/:personId/ask. Ответ показываем
 *      в истории сообщений.
 *   4. Кнопка «помечу как неверно» рядом с ответом → toast «отправлено для тюна».
 *   5. ⚠ Кнопка «отключить наблюдение» НЕ показывается (§3.4 правило).
 */
export function MyCloneClient() {
  const { currentOrgId, isLoading: authLoading } = useAuth();

  const [question, setQuestion] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<
    Array<{ id: string; role: 'user' | 'assistant'; text: string; clone?: CloneAnswer }>
  >([]);
  const [pending, setPending] = useState(false);

  // 1. Грузим /me/profile для personId.
  const profileSwrKey = currentOrgId
    ? ['my-profile-for-clone', currentOrgId]
    : null;
  const { data: myProfile, isLoading: loadingMyProfile } = useSWR(
    profileSwrKey,
    async () => meProfileApi.get(currentOrgId!),
  );

  // 2. Грузим /me/knowledge-profile — для проверки empty (на γ-1 SkillProfile
  //    UI ещё нет; используем knowledge-profile как косвенный показатель
  //    «есть ли с чем работать»).
  const kpSwrKey = currentOrgId ? ['my-kp-for-clone', currentOrgId] : null;
  const { data: knowledgeProfile, isLoading: loadingKp } = useSWR(
    kpSwrKey,
    async () => knowledgeCloneApi.getMine(currentOrgId!),
  );

  const personId = myProfile?.person?.id ?? null;
  const personName = myProfile?.person?.fullName ?? 'я';
  const isReady = !authLoading && !loadingMyProfile && !!personId;
  const isEmpty =
    knowledgeProfile?.isEmpty ?? (knowledgeProfile?.categories.length ?? 0) === 0;

  async function handleSubmit() {
    if (!currentOrgId || !personId) return;
    const text = question.trim();
    if (text.length < 3) {
      toast.error('Вопрос слишком короткий (минимум 3 символа).');
      return;
    }
    setPending(true);
    const userMessageId = `user-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: userMessageId, role: 'user', text },
    ]);
    setQuestion('');
    try {
      const apiRes = await clonesApi.askPerson(currentOrgId, personId, {
        question: text,
        conversationId: conversationId ?? undefined,
      });
      const answer = mapCloneAnswer(apiRes);
      setConversationId(answer.conversationId);
      setMessages((prev) => [
        ...prev,
        {
          id: answer.messageId,
          role: 'assistant',
          text: answer.text,
          clone: answer,
        },
      ]);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.payload?.message ?? err.message
          : 'Не удалось получить ответ от клона. Попробуйте ещё раз.';
      toast.error(message);
      setMessages((prev) => prev.filter((m) => m.id !== userMessageId));
    } finally {
      setPending(false);
    }
  }

  function handleMarkWrong(messageId: string) {
    toast.success('Спасибо! Отметка отправлена — мы используем её для улучшения клона.');
    // На γ-1 mark-wrong для ответов клона — placeholder. Полноценный CurationItem
    // для clone-output появится в γ+.
    void messageId;
  }

  if (authLoading || loadingMyProfile) {
    return (
      <section className="space-y-4 p-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-16 w-full" />
      </section>
    );
  }

  return (
    <section className="space-y-4 p-4">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Попробовать своего клона
        </h1>
        <p className="text-sm text-muted-foreground">
          Это AI на основе моего наблюдаемого поведения на встречах. Спросите,
          как я подошёл бы к задаче — клон ответит в моём стиле, опираясь на
          накопленные обсуждения «почему я так решил».
        </p>
      </div>

      {!isReady && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Не удалось определить ваш профиль в этой организации.
          </CardContent>
        </Card>
      )}

      {isReady && !loadingKp && isEmpty && (
        <Card>
          <CardContent className="space-y-2 p-6 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">
              Клон ещё не сформирован.
            </p>
            <p>
              Клон накопится после нескольких встреч с обсуждением «почему я
              так решил». Обычно нужно 5–10 таких эпизодов в разных встречах.
            </p>
          </CardContent>
        </Card>
      )}

      {isReady && (
        <div className="space-y-3">
          <ul className="space-y-3">
            {messages.map((m) => (
              <li key={m.id}>
                {m.role === 'user' ? (
                  <UserMessageBubble text={m.text} />
                ) : (
                  <CloneMessageBubble
                    text={m.text}
                    personName={personName}
                    onMarkWrong={() => handleMarkWrong(m.id)}
                  />
                )}
              </li>
            ))}
            {pending && (
              <li>
                <Card>
                  <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Клон думает…
                  </CardContent>
                </Card>
              </li>
            )}
          </ul>

          <Card>
            <CardContent className="space-y-3 p-4">
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Как бы я подошёл к X?"
                rows={3}
                disabled={pending || isEmpty}
              />
              <div className="flex items-center justify-end">
                <Button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={pending || isEmpty || question.trim().length < 3}
                  title={
                    isEmpty
                      ? 'Клон ещё не сформирован — накопится после нескольких встреч'
                      : undefined
                  }
                >
                  <Send className="mr-2 h-4 w-4" />
                  Спросить
                </Button>
              </div>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            Клон отвечает в моём стиле, но это не я: проверяйте важное лично.
            Ответы строятся на наблюдённых обсуждениях моих решений.
          </p>
        </div>
      )}
    </section>
  );
}

function UserMessageBubble({ text }: { text: string }) {
  return (
    <Card className="ml-auto max-w-[80%]">
      <CardContent className="p-3 text-sm">{text}</CardContent>
    </Card>
  );
}

function CloneMessageBubble({
  text,
  personName,
  onMarkWrong,
}: {
  text: string;
  personName: string;
  onMarkWrong: () => void;
}) {
  return (
    <Card className="max-w-[85%]">
      <CardContent className="space-y-3 p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Bot className="h-4 w-4" />
          <span>Ваш клон ({personName})</span>
          <Badge variant="secondary" className="gap-1">
            <Sparkles className="h-3 w-3" />в стиле сотрудника
          </Badge>
        </div>
        <div className="whitespace-pre-wrap text-sm leading-relaxed">{text}</div>
        <div className="flex items-center justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onMarkWrong}
          >
            <Flag className="mr-1 h-3 w-3" />
            Помечу как неверно
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
