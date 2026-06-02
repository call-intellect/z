import { redirect } from 'next/navigation';

/**
 * `/company-admin` → стартовая вкладка «Доступ к памяти».
 */
export default function CompanyAdminIndexPage(): never {
  redirect('/company-admin/memory-access');
}
