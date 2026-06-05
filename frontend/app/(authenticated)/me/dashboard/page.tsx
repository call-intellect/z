import { redirect } from 'next/navigation';

export default function MeDashboardRedirectPage() {
  redirect('/me');
}
