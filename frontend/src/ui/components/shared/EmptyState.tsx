import type { ReactNode } from 'react';

type Props = {
  title: string;
  description?: string;
  action?: ReactNode;
};

export function EmptyState({ title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border-subtle bg-bg-subtle px-6 py-12 text-center">
      <svg
        aria-hidden="true"
        className="mb-4 h-10 w-10 text-fg-tertiary"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 17l3-3m0 0l3 3m-3-3v6m6-12V7a4 4 0 00-8 0v0M5 11h14a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2z"
        />
      </svg>
      <h3 className="mb-1 text-base font-semibold text-fg-primary">{title}</h3>
      {description ? (
        <p className="mb-4 max-w-md text-sm text-fg-secondary">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
