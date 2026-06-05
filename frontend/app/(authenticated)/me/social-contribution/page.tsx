import { redirect } from 'next/navigation';

/**
 * `/me/social-contribution` — устаревший URL. Раздел переехал во вкладку «Чем
 * я помогаю коллегам» кабинета «Я» (ТЗ-E Фаза 1, R10). Серверный redirect
 * сохраняет старые ссылки рабочими.
 */
export default function MySocialContributionRedirectPage() {
  redirect('/me?tab=social');
}
