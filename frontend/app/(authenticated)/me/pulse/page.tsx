import { redirect } from 'next/navigation';

/**
 * `/me/pulse` — устаревший URL. Раздел переехал во вкладку «Пульс» кабинета
 * «Я» (ТЗ-E Фаза 1, R10). Серверный redirect сохраняет старые ссылки рабочими.
 */
export default function MyPulseRedirectPage() {
  redirect('/me?tab=pulse');
}
