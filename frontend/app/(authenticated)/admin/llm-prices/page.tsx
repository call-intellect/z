import { redirect } from 'next/navigation';

/**
 * Фаза 3 редизайна — страница прайса вошла в `/admin/ai/catalog` под
 * вкладку `?tab=prices`. Сохраняем redirect для bookmark'ов.
 */
export default function AdminLlmPricesRedirect() {
  redirect('/admin/ai/catalog?tab=prices');
}
