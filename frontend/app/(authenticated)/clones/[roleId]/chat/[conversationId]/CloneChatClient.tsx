'use client';

/**
 * `/clones/[roleId]/chat/[conversationId]` (ТЗ §3.8) — чат с клоном.
 *
 * Архитектура:
 *   - Sidebar (диалоги): на desktop sticky слева, на mobile — Sheet drawer.
 *   - Main: sticky header (клон + бейдж режима) + лента сообщений + composer.
 *   - Optimistic update для user-сообщения, чтобы UX был мгновенным.
 *   - При refused=true рисуем карточку отказа с человеко-читаемой причиной.
 *
 * Stream сообщений берётся через `chatV2Api.getConversation(id)` — diалоги
 * клонов хранятся в той же ChatV2Conversation/ChatV2Message (scope='card').
 */

import {
  Loader2,
  Menu,
  Send,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import useSWR from 'swr';

import { ApiError } from '@/api/api-error';
import { chatV2Api } from '@/api/chat-v2.api';
import { clonesApi } from '@/api/clones.api';
import { useAuth } from '@/contexts/auth-context';
import {
  cloneRefusalReasonRu,
  mapCloneAnswer,
  type CloneAnswer,
} from '@/domain/clone';
import {
  stripContextMarkers,
  toChatV2ConversationWithMessages,
} from '@/domain/chat-v2';
import {
  useCloneByRoleId,
  useCloneConversations,
  useMyCloneAccess,
} from '@/hooks/useClones';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { CloneAvatar } from '@/ui/clones/CloneAvatar';
import { CloneChatSidebar } from '@/ui/clones/CloneChatSidebar';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/ui/shadcn/sheet';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { Textarea } from '@/ui/shadcn/textarea';
import { toast } from '@/ui/shadcn/toast';
import { cn } from '@/ui/shadcn/lib/utils';

import { AdminForbidden } from '@app/(admin)/admin/AdminStateViews';

interface ChatMessageUi {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: Date;
  refused: boolean;
  refusalReason: string | null;
  citations: CloneAnswer['citations'];
  /** true — это локальное optimistic-сообщение, ещё не подтверждённое сервером. */
  optimistic?: boolean;
}

export function CloneChatClient({
  roleId,
  conversationId,
}: {
  roleId: string;
  conversationId: string;
}) {
  const { currentOrgId, isLoading } = useAuth();
  if (isLoading) return <ChatSkeleton />;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Раздел доступен только внутри Org."
      />
    );
  }
  return (
    <Content
      orgId={currentOrgId}
      roleId={roleId}
      conversationId={conversationId}
    />
  );
}

function Content({
  orgId,
  roleId,
  conversationId,
}: {
  orgId: string;
  roleId: string;
  conversationId: string;
}) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const { item: cloneItem, isLoading: cloneLoading } = useCloneByRoleId(
    orgId,
    roleId,
  );
  const { access, isLoading: accessLoading } = useMyCloneAccess(orgId);
  const conversations = useCloneConversations(orgId, roleId);

  const hasGrant = access?.has('role', roleId) ?? false;

  // Защита: нет grant'а → редирект на карточку клона.
  useEffect(() => {
    if (accessLoading) return;
    if (access && !hasGrant) {
      toast.message('Доступ к клону отозван.', {
        description: 'Запросите доступ заново у администратора.',
      });
      router.replace(`/clones/${encodeURIComponent(roleId)}`);
    }
  }, [accessLoading, access, hasGrant, roleId, router]);

  // Лента сообщений из БД.
  const messagesSwr = useSWR(
    ['clones:conversation', conversationId],
    async () => {
      const dto = await chatV2Api.getConversation(conversationId);
      return toChatV2ConversationWithMessages(dto);
    },
    { revalidateOnFocus: false },
  );

  // Если backend вернул 404 на conversation → редирект.
  useEffect(() => {
    if (!messagesSwr.error) return;
    const err = messagesSwr.error as unknown;
    const isNotFound =
      err instanceof ApiError &&
      (err.code === 'not_found' ||
        err.code === 'forbidden' ||
        err.code === 'http_404');
    if (isNotFound) {
      toast.message('Диалог не найден.');
      router.replace(`/clones/${encodeURIComponent(roleId)}`);
    }
  }, [messagesSwr.error, roleId, router]);

  // Локальные optimistic-сообщения (user + pending assistant placeholder).
  const [localMessages, setLocalMessages] = useState<ChatMessageUi[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [creatingConv, setCreatingConv] = useState(false);

  // При смене conversationId — сбрасываем локалку.
  useEffect(() => {
    setLocalMessages([]);
  }, [conversationId]);

  const serverMessages: ChatMessageUi[] = useMemo(() => {
    const msgs = messagesSwr.data?.messages ?? [];
    return msgs.map((m) => {
      // refused/refusalReason приходят только из askRole-ответа;
      // в ChatV2Message их нет, поэтому при загрузке истории всегда false.
      const llmMeta = (m.llmMeta ?? {}) as Record<string, unknown>;
      const refused = Boolean(llmMeta['refused']);
      const refusalReason =
        typeof llmMeta['refusalReason'] === 'string'
          ? (llmMeta['refusalReason'] as string)
          : null;
      return {
        id: m.id,
        role: m.role,
        text: m.text,
        createdAt: m.createdAt,
        refused,
        refusalReason,
        citations: (m.citations ?? []).map((c) => ({
          blockId: '',
          meetingId: c.meetingId,
          meetingTitle: c.meetingTitle,
          startMs: c.startMs,
          endMs: c.endMs,
          snippet: c.snippet,
        })),
      };
    });
  }, [messagesSwr.data]);

  // Финальный список: серверные + локальные (без дублирования по id).
  const allMessages: ChatMessageUi[] = useMemo(() => {
    const seen = new Set(serverMessages.map((m) => m.id));
    const extras = localMessages.filter((m) => !seen.has(m.id));
    return [...serverMessages, ...extras];
  }, [serverMessages, localMessages]);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [allMessages.length, sending]);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const question = input.trim();
      if (!question || sending) return;
      if (question.length < 3) {
        toast.error('Слишком короткий вопрос (минимум 3 символа).');
        return;
      }
      const optimisticId = `local-user-${Date.now()}`;
      setLocalMessages((prev) => [
        ...prev,
        {
          id: optimisticId,
          role: 'user',
          text: question,
          createdAt: new Date(),
          refused: false,
          refusalReason: null,
          citations: [],
          optimistic: true,
        },
      ]);
      setInput('');
      setSending(true);
      try {
        const apiRes = await clonesApi.askRole(orgId, roleId, {
          question,
          conversationId,
        });
        const answer = mapCloneAnswer(apiRes);
        // Дополняем ленту локально (потом refetch заберёт всё из БД).
        setLocalMessages((prev) => [
          ...prev,
          {
            id: answer.messageId,
            role: 'assistant',
            text: answer.text,
            createdAt: new Date(),
            refused: answer.refused,
            refusalReason: answer.refusalReason,
            citations: answer.citations,
          },
        ]);
        // Refetch ленту + список диалогов (обновится updatedAt).
        void messagesSwr.mutate();
        void conversations.mutate();
      } catch (err) {
        // Откатим optimistic — пусть пользователь увидит ошибку и
        // сможет перепечатать вопрос.
        setLocalMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        const message =
          err instanceof ApiError
            ? err.message
            : 'Не удалось получить ответ клона.';
        toast.error(message);
      } finally {
        setSending(false);
      }
    },
    [
      input,
      sending,
      orgId,
      roleId,
      conversationId,
      messagesSwr,
      conversations,
    ],
  );

  const handleCreateConversation = useCallback(async () => {
    if (creatingConv) return;
    setCreatingConv(true);
    try {
      const res = await clonesApi.createRoleConversation(orgId, roleId);
      router.push(
        `/clones/${encodeURIComponent(roleId)}/chat/${encodeURIComponent(
          res.conversationId,
        )}`,
      );
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Не удалось создать диалог.';
      toast.error(message);
    } finally {
      setCreatingConv(false);
    }
  }, [creatingConv, orgId, roleId, router]);

  const publicName = cloneItem?.publicName ?? 'Клон должности';
  const departmentId = cloneItem?.departmentId ?? null;

  if (accessLoading || cloneLoading) return <ChatSkeleton />;

  const sidebar = (
    <CloneChatSidebar
      roleId={roleId}
      publicName={publicName}
      departmentId={departmentId}
      activeConversationId={conversationId}
      conversations={conversations.items}
      isLoading={conversations.isLoading}
      error={conversations.error}
      onCreateConversation={handleCreateConversation}
      onSelectConversation={(id) =>
        router.push(
          `/clones/${encodeURIComponent(roleId)}/chat/${encodeURIComponent(
            id,
          )}`,
        )
      }
      creating={creatingConv}
      onClose={() => setSidebarOpen(false)}
    />
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)] md:h-screen">
      {/* Desktop sidebar */}
      <div className="hidden w-80 flex-none lg:block xl:w-[22rem]">
        {sidebar}
      </div>

      {/* Mobile drawer */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-[85%] max-w-sm p-0 sm:max-w-md">
          <SheetTitle className="sr-only">Диалоги с клоном</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>

      {/* Main */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border-subtle bg-bg-base px-3 py-2 sm:px-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Открыть список диалогов"
          >
            <Menu size={18} />
          </Button>
          <CloneAvatar
            roleName={publicName}
            departmentId={departmentId}
            size={36}
          />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{publicName}</h1>
            <p className="truncate text-xs text-fg-tertiary">
              {messagesSwr.data?.title ?? 'Без названия'}
            </p>
          </div>
          <Badge variant="secondary" className="hidden gap-1 sm:inline-flex">
            <Sparkles size={11} />
            в стиле роли
          </Badge>
        </header>

        {/* Messages */}
        <div className="flex-1 space-y-3 overflow-y-auto bg-bg-base px-3 py-4 sm:px-6">
          {messagesSwr.isLoading ? (
            <MessageListSkeleton />
          ) : allMessages.length === 0 ? (
            <EmptyChatHint publicName={publicName} />
          ) : (
            allMessages.map((m) => <MessageBubble key={m.id} message={m} />)
          )}
          {sending ? (
            <div className="flex items-center gap-2 text-sm text-fg-tertiary">
              <Loader2 className="h-4 w-4 animate-spin" />
              Клон думает…
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>

        {/* Composer */}
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="sticky bottom-0 border-t border-border-subtle bg-bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4"
        >
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={isMobile ? 2 : 3}
              placeholder="Задайте вопрос клону должности…"
              disabled={sending}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  // Триггерим submit через replicating form submit:
                  const form = (e.target as HTMLTextAreaElement).form;
                  form?.requestSubmit();
                }
              }}
              className="min-h-[44px] flex-1 resize-none"
            />
            <Button
              type="submit"
              size="sm"
              disabled={sending || input.trim().length < 3}
              aria-label="Отправить"
            >
              <Send size={14} />
            </Button>
          </div>
          <p className="mt-1 hidden text-xs text-fg-tertiary sm:block">
            Ctrl/Cmd + Enter — отправить
          </p>
        </form>
      </main>
    </div>
  );
}

// ─────────── small components ───────────

function MessageBubble({ message }: { message: ChatMessageUi }) {
  const isUser = message.role === 'user';

  if (message.refused) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] rounded-lg border border-warning/40 bg-warning/5 p-3">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium text-warning">
            <ShieldAlert size={14} />
            Клон отказался отвечать
          </div>
          <p className="text-sm text-fg-secondary">
            {cloneRefusalReasonRu(message.refusalReason)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap sm:max-w-[80%]',
          isUser
            ? 'bg-accent text-accent-fg'
            : 'border border-border-subtle bg-bg-card text-fg-primary',
        )}
      >
        {isUser ? message.text : stripContextMarkers(message.text)}
        {!isUser && message.citations.length > 0 ? (
          <div className="mt-2 space-y-1.5 border-t border-border-subtle pt-2">
            <div className="text-xs font-medium text-fg-tertiary">
              Источники:
            </div>
            {message.citations.slice(0, 5).map((c, i) => (
              <div
                key={`${c.blockId}-${i}`}
                className="rounded bg-bg-base px-2 py-1.5 text-xs"
              >
                <div className="font-medium">
                  {c.meetingTitle ?? 'Источник'}
                </div>
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
    </div>
  );
}

function EmptyChatHint({ publicName }: { publicName: string }) {
  return (
    <div className="mx-auto max-w-md py-12 text-center">
      <p className="text-sm text-fg-secondary">
        Задайте первый вопрос — {publicName} ответит, опираясь на накопленные
        обсуждения подхода к решениям этой должности.
      </p>
    </div>
  );
}

function MessageListSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-16 w-3/4" />
      <Skeleton className="ml-auto h-12 w-1/2" />
      <Skeleton className="h-20 w-2/3" />
    </div>
  );
}

function ChatSkeleton() {
  return (
    <div className="flex h-screen">
      <div className="hidden w-80 flex-none border-r border-border-subtle bg-bg-card p-3 lg:block">
        <Skeleton className="h-8 w-full" />
        <div className="mt-3 space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
      <div className="flex-1 p-6">
        <Skeleton className="h-8 w-1/3" />
        <div className="mt-6 space-y-3">
          <Skeleton className="h-16 w-3/4" />
          <Skeleton className="ml-auto h-12 w-1/2" />
        </div>
      </div>
    </div>
  );
}
