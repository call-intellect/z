import { ShareClipClient } from './ShareClipClient';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ token: string }> };

/**
 * Публичный плеер клипа. Авто-плей включён (ваня смотрит — сразу хочет увидеть).
 * 404/410 обрабатываются клиентом единым флоу.
 */
export default async function PublicShareClipPage({ params }: Props) {
  const { token } = await params;
  return <ShareClipClient token={token} />;
}
