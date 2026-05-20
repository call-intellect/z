import { ShareMeetingClient } from './ShareMeetingClient';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ token: string }> };

/**
 * Публичная страница встречи. AppShell не используется (это «extranet» —
 * получатель ссылки не залогинен).
 *
 * Логика рендера и обработки 404/410 — в client-компоненте, чтобы единым
 * способом ходить через `apiClient`.
 */
export default async function PublicShareMeetingPage({ params }: Props) {
  const { token } = await params;
  return <ShareMeetingClient token={token} />;
}
