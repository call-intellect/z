import { permanentRedirect } from 'next/navigation';

/**
 * Фаза 7 редизайна — старый URL `/admin/meetings` редиректит на новый
 * `/admin/media/meetings` (308 Permanent Redirect).
 *
 * Drill-down `/admin/meetings/[id]` остаётся работать самостоятельно
 * (см. соседний `[id]/page.tsx`).
 */
export default function AdminMeetingsRedirectPage() {
  permanentRedirect('/admin/media/meetings');
}
