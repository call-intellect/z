import { useLocalSearchParams } from "expo-router";
import React from "react";

import { IssueScreen } from "@/screens/IssueScreen";

export default function IssueRoute() {
  const params = useLocalSearchParams<{ id: string }>();
  const issueId = Array.isArray(params.id) ? params.id[0] : params.id;
  return <IssueScreen issueId={issueId ?? ""} />;
}
