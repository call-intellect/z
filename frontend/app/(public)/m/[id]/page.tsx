// Заглушка страницы встречи. Реальная логика (exchange-token, lobby, room) — Фаза 7.

type Props = {
  params: { id: string };
};

export default function MeetingPage({ params }: Props) {
  return <MeetingPageShell meetingId={params.id} />;
}

function MeetingPageShell({ meetingId }: { meetingId: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-start justify-center gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold text-slate-900">Встреча</h1>
      <p className="text-sm text-slate-600">
        ID встречи: <code className="rounded bg-slate-100 px-1.5 py-0.5">{meetingId}</code>
      </p>
      <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Эта страница появится в Фазе 7 — обмен deep-link токена, lobby, комната LiveKit.
      </p>
    </main>
  );
}
