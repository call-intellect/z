import type { ReactNode } from 'react';

export default function WelcomeLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg-base flex flex-col">
      {children}
    </div>
  );
}
