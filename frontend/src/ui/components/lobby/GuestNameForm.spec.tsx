import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { GuestNameForm } from "./GuestNameForm";

vi.mock("@/api/meetings.api", () => ({
  meetingsApi: {
    join: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { meetingsApi } from "@/api/meetings.api";

describe("GuestNameForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("с inviteToken — submit зовёт join с guest_name + invite_token", async () => {
    const joinMock = meetingsApi.join as unknown as ReturnType<typeof vi.fn>;
    joinMock.mockResolvedValue({
      participant_id: "p1",
      role: "guest",
      livekit_identity: "guest:p1",
      livekit: { url: "wss://x", token: "tok", identity: "guest:p1" },
    });

    render(
      <GuestNameForm meetingId="m_1" inviteToken="tok" onJoined={vi.fn()} />,
    );

    const input = screen.getByPlaceholderText(/.+/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Иван" } });
    fireEvent.submit(input.closest("form")!);

    await vi.waitFor(() => {
      expect(joinMock).toHaveBeenCalledWith(
        "m_1",
        expect.objectContaining({ guest_name: "Иван", invite_token: "tok" }),
      );
    });
  });

  it("без inviteToken — submit зовёт join БЕЗ invite_token", async () => {
    const joinMock = meetingsApi.join as unknown as ReturnType<typeof vi.fn>;
    joinMock.mockResolvedValue({
      participant_id: "p2",
      role: "guest",
      livekit_identity: "guest:p2",
      livekit: { url: "wss://x", token: "tok", identity: "guest:p2" },
    });

    render(<GuestNameForm meetingId="m_2" onJoined={vi.fn()} />);

    const input = screen.getByPlaceholderText(/.+/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Пётр" } });
    fireEvent.submit(input.closest("form")!);

    await vi.waitFor(() => {
      expect(joinMock).toHaveBeenCalledTimes(1);
    });
    const callArg = joinMock.mock.calls[0][1];
    expect(callArg).toEqual({ guest_name: "Пётр" });
    expect(callArg).not.toHaveProperty("invite_token");
  });
});
