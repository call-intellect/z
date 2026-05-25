import { redirect } from 'next/navigation';

/**
 * Фаза 3 редизайна — страница A/B-экспериментов моделей пока не имеет
 * самостоятельного URL внутри `/admin/ai/routing` (есть только вкладка
 * под конкретный taskType). Редиректим на список агентов; полная страница
 * экспериментов будет добавлена в одной из следующих фаз.
 */
export default function AdminAiModelsExperimentsRedirect() {
  redirect('/admin/ai/routing');
}
