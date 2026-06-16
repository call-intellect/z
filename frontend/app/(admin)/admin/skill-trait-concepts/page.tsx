import type { Metadata } from "next";

import { SkillTraitConceptsClient } from "./SkillTraitConceptsClient";

export const metadata: Metadata = {
  title: "Смысловые блоки навыка",
};

export default function AdminSkillTraitConceptsPage() {
  return <SkillTraitConceptsClient />;
}
