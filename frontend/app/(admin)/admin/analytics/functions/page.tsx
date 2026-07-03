import { redirect } from 'next/navigation';

export default function FunctionsAnalyticsPage() {
  redirect('/admin/analytics/llm-cost?view=module');
}
