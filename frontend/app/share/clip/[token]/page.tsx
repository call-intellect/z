import { ShareClipClient } from './ShareClipClient';

export const dynamic = 'force-dynamic';

type Props = { params: { token: string } };

/**
 * Публичный плеер клипа. Авто-плей включён (ваня смотрит — сразу хочет увидеть).
 * 404/410 обрабатываются клиентом единым флоу.
 */
export default function PublicShareClipPage({ params }: Props) {
  return <ShareClipClient token={params.token} />;
}
