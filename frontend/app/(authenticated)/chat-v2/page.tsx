import { redirect } from 'next/navigation';

/**
 * `/chat-v2` объединён с каноническим `/chat` (ТЗ C, Фаза 4).
 * Старый адрес сохраняем как редирект с переносом query (`conversationId`),
 * чтобы deep-link'и из CommandPalette и истории не ломались.
 * Компонент `./ChatV2Client` теперь рендерится из `/chat`.
 */
export default async function ChatV2Redirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  const cid = sp?.conversationId;
  if (typeof cid === 'string' && cid) qs.set('conversationId', cid);
  const q = qs.toString();
  redirect(q ? `/chat?${q}` : '/chat');
}
