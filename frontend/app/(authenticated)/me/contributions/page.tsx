import { redirect } from 'next/navigation';

/**
 * `/me/contributions` — устаревший URL. Раздел переехал во вкладку «Чем я
 * полезен компании» кабинета «Я» (ТЗ-E Фаза 1, R10). Серверный redirect
 * сохраняет старые ссылки рабочими.
 */
export default function MyContributionsRedirectPage() {
  redirect('/me?tab=contributions');
}
