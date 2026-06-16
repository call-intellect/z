import type { Metadata } from "next";
import { Monitor } from "lucide-react";

import { ValueRecapDashboardClient } from "../dashboard/value-recap/ValueRecapDashboardClient";

export const metadata: Metadata = {
  title: "Итоги месяца",
};

export default function MonthPage() {
  return (
    <>
      <div className="mb-4 flex items-start gap-3 rounded-xl bg-chip-info-bg px-4 py-3 text-chip-info-fg md:hidden">
        <Monitor size={20} strokeWidth={1.75} className="mt-0.5 shrink-0" />
        <p className="text-sm">
          Откройте на компьютере для полного отчёта. «Итоги месяца» — плотная
          витрина с графиками, на телефоне она показывается урезанно.
        </p>
      </div>
      <ValueRecapDashboardClient />
    </>
  );
}
