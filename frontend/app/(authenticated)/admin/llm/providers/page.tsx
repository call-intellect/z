import { redirect } from 'next/navigation';

/**
 * Фаза 3 редизайна — провайдеры LLM перешли в `/admin/ai/catalog` под
 * вкладку `?tab=providers`.
 */
export default function AdminLlmProvidersRedirect() {
  redirect('/admin/ai/catalog?tab=providers');
}
