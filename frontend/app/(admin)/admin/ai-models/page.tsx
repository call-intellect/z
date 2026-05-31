import { redirect } from 'next/navigation';

/**
 * Фаза 3 редизайна — старый URL `/admin/ai-models` мигрирован под
 * `/admin/ai/routing`. Сохраняем redirect для bookmark'ов и внутренних
 * ссылок (старые клиенты используют `Link href="/admin/ai-models/..."`).
 */
export default function AdminAiModelsRedirect() {
  redirect('/admin/ai/routing');
}
