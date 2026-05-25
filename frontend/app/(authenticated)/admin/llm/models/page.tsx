import { redirect } from 'next/navigation';

/**
 * Фаза 3 редизайна — модели LLM перешли в `/admin/ai/catalog` под
 * вкладку `?tab=models`.
 */
export default function AdminLlmModelsRedirect() {
  redirect('/admin/ai/catalog?tab=models');
}
