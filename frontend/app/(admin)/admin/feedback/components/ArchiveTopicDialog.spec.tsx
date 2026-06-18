import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/api/admin-feedback.api", () => ({
  adminFeedbackApi: {
    archiveTopic: vi.fn(),
    unarchiveTopic: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { adminFeedbackApi } from "@/api/admin-feedback.api";
import { toast } from "sonner";

import { ArchiveTopicDialog } from "./ArchiveTopicDialog";

const archiveMock = () =>
  adminFeedbackApi.archiveTopic as unknown as ReturnType<typeof vi.fn>;
const unarchiveMock = () =>
  adminFeedbackApi.unarchiveTopic as unknown as ReturnType<typeof vi.fn>;

describe("ArchiveTopicDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("archive mode → вызывает archiveTopic", async () => {
    archiveMock().mockResolvedValue({});
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();

    render(
      <ArchiveTopicDialog
        open
        onOpenChange={onOpenChange}
        topicId="ftp_1"
        topicTitle="Тёмная тема"
        mode="archive"
        onSaved={onSaved}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /архивировать/i }));

    await vi.waitFor(() => {
      expect(archiveMock()).toHaveBeenCalledWith("ftp_1");
    });
    expect(toast.success).toHaveBeenCalledWith("Готово");
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("unarchive mode → вызывает unarchiveTopic", async () => {
    unarchiveMock().mockResolvedValue({});
    const onSaved = vi.fn();

    render(
      <ArchiveTopicDialog
        open
        onOpenChange={vi.fn()}
        topicId="ftp_1"
        topicTitle="Тёмная тема"
        mode="unarchive"
        onSaved={onSaved}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /восстановить/i }));

    await vi.waitFor(() => {
      expect(unarchiveMock()).toHaveBeenCalledWith("ftp_1");
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("ошибка API → toast.error, диалог не закрывается", async () => {
    archiveMock().mockRejectedValue(new Error("boom"));
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();

    render(
      <ArchiveTopicDialog
        open
        onOpenChange={onOpenChange}
        topicId="ftp_1"
        topicTitle="Тёмная тема"
        mode="archive"
        onSaved={onSaved}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /архивировать/i }));

    await vi.waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
