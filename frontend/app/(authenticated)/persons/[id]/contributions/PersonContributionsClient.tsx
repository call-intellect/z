"use client";

import { PersonSubpagesNav } from "@/ui/components/persons/PersonSubpagesNav";

import { ContributionsView } from "../../../me/contributions/ContributionsView";

export function PersonContributionsClient({ personId }: { personId: string }) {
  return (
    <div>
      <div className="mx-auto w-full max-w-5xl px-6 pt-6">
        <PersonSubpagesNav entityId={personId} />
      </div>
      <ContributionsView
        personId={personId}
        title="Профиль вклада сотрудника"
      />
    </div>
  );
}
