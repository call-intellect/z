import type { Metadata } from "next";

import { FeedbackTopicDetailClient } from "./FeedbackTopicDetailClient";

export const metadata: Metadata = {
  title: "Блок обратной связи",
};

export default async function AdminFeedbackTopicPage({
  params,
}: {
  params: Promise<{ topicId: string }>;
}) {
  const { topicId } = await params;
  return <FeedbackTopicDetailClient topicId={topicId} />;
}
