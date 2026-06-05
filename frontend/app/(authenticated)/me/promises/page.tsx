import { redirect } from 'next/navigation';

/**
 * `/me/promises` — устаревший URL. Раздел переехал во вкладку «Мои обещания»
 * кабинета «Я» (ТЗ-E Фаза 1, R10). Серверный redirect сохраняет старые
 * ссылки рабочими.
 */
export default function MyPromisesRedirectPage() {
  redirect('/me?tab=promises');
}
