import { redirect } from 'next/navigation';

/**
 * Старый путь `/settings/admin/knowledge-core` («Ядро знаний») удалён из
 * клиента — это была инженерная отладка + утечка себестоимости LLM,
 * владельцу Org не нужна (ТЗ 2026-06-02). Редиректим на «Админку компании».
 */
export default function KnowledgeCoreRedirectPage(): never {
  redirect('/company-admin');
}
