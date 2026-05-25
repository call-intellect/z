import { redirect } from 'next/navigation';

/**
 * Фаза 3 редизайна — список промптов вошёл в `/admin/ai/prompts`.
 * Старые URL `/admin/prompts/[id]`, `/admin/prompts/new`,
 * `/admin/prompts/experiments` сохраняются — туда ведут ссылки из новой
 * страницы.
 */
export default function AdminPromptsRedirect() {
  redirect('/admin/ai/prompts');
}
