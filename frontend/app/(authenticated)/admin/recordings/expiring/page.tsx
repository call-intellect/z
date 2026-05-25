import { permanentRedirect } from 'next/navigation';

/**
 * Фаза 7 редизайна — старый URL `/admin/recordings/expiring` редиректит
 * на новый `/admin/media/expiring` (308 Permanent Redirect).
 */
export default function ExpiringRecordingsRedirectPage() {
  permanentRedirect('/admin/media/expiring');
}
