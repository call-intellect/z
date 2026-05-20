import { redirect } from 'next/navigation';

import { ExchangeAndRender } from './ExchangeAndRender';

type Props = {
  // Next 15+/16: params и searchParams теперь Promise — их нужно await'ить.
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string | string[] }>;
};

/**
 * Server component страницы встречи.
 *
 * Подход к exchange (deep-link → cookie):
 *   - На сервере НЕ делаем exchange — это требует пробросить Set-Cookie
 *     обратно в браузер через next/headers, что в RSC ограничено.
 *     Вместо этого client-shell `<ExchangeAndRender />` сам делает
 *     `authApi.exchange(token, meetingId)` (с `credentials: 'include'`) —
 *     backend ставит cookie на ответе, браузер её сохраняет.
 *   - После успеха client делает `router.replace('/m/<id>')` — `?t=` уходит
 *     из адресной строки и истории.
 *   - На fail (например 401 — токен битый/просрочен) рендерим guest-flow.
 */
export default async function MeetingPage({ params, searchParams }: Props) {
  const { id } = await params;
  if (!id || id.length < 5) {
    redirect('/');
  }
  const sp = await searchParams;
  const tokenParam = Array.isArray(sp.t) ? sp.t[0] : sp.t;

  return (
    <ExchangeAndRender
      meetingId={id}
      deepLinkToken={tokenParam ?? null}
    />
  );
}
