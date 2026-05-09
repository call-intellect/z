import { redirect } from 'next/navigation';

import { ExchangeAndRender } from './ExchangeAndRender';

type Props = {
  params: { id: string };
  searchParams: { t?: string | string[] };
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
export default function MeetingPage({ params, searchParams }: Props) {
  const id = params.id;
  if (!id || id.length < 5) {
    redirect('/');
  }
  const tokenParam = Array.isArray(searchParams.t) ? searchParams.t[0] : searchParams.t;

  return (
    <ExchangeAndRender
      meetingId={id}
      deepLinkToken={tokenParam ?? null}
    />
  );
}
