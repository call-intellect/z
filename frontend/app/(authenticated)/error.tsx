'use client';

import { AppErrorView } from '@/ui/components/AppErrorView';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <AppErrorView error={error} reset={reset} />;
}
