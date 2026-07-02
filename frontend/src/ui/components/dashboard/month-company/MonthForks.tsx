"use client";

import { GitFork } from "lucide-react";

import { CHART, GRAD, glass } from "@/ui/components/dashboard/modern";
import { CardTitle } from "@/ui/components/dashboard/modern";

export function MonthForks({
  ownerForks,
}: {
  ownerForks: Array<{ title: string; why: string }> | null | undefined;
}) {
  if (!ownerForks || ownerForks.length === 0) return null;

  return (
    <div style={glass()} className="p-6">
      <CardTitle icon={<GitFork size={17} />} grad={GRAD.amber}>
        Развилки месяца
      </CardTitle>
      <ul className="mt-4 flex flex-col gap-3.5">
        {ownerForks.map((item, i) => (
          <li
            key={`fork-${i}`}
            className="flex gap-3 border-b pb-3.5 last:border-0 last:pb-0"
            style={{ borderColor: "var(--glass-border)" }}
          >
            <span
              className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
              style={{ background: CHART.amber, boxShadow: `0 0 8px ${CHART.amber}` }}
              aria-hidden
            />
            <div className="min-w-0">
              <div
                className="text-[14px] font-bold leading-snug"
                style={{ color: CHART.text }}
              >
                {item.title}
              </div>
              {item.why ? (
                <div
                  className="mt-1 text-[13px] leading-relaxed"
                  style={{ color: CHART.dim }}
                >
                  {item.why}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
