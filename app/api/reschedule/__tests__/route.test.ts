import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/slots", () => ({
  getAvailabilityByDate: vi.fn(),
  getMeetingTypeById: vi.fn(),
}));

vi.mock("@/lib/sign", () => ({
  decodeSignedLinkPayload: vi.fn(),
  verifySignedLink: vi.fn(),
  createManagementLinks: vi.fn(),
  describeManagementLinks: vi.fn(),
  upsertManageLinkInDescription: vi.fn(),
}));

vi.mock("@/lib/google", async () => {
  const actual = await vi.importActual<typeof import("@/lib/google")>("@/lib/google");
  return {
    ...actual,
    updateCalendarEvent: vi.fn(),
  };
});

import { PATCH } from "@/app/api/reschedule/route";
import { getAvailabilityByDate, getMeetingTypeById, type MeetingType } from "@/lib/slots";
import {
  createManagementLinks,
  decodeSignedLinkPayload,
  describeManagementLinks,
  upsertManageLinkInDescription,
  verifySignedLink,
  type ManagementLinkCollection,
  type SignedLinkPayload,
} from "@/lib/sign";
import { updateCalendarEvent, type GoogleCalendarEvent } from "@/lib/google";

describe("PATCH /api/reschedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends guest update emails when the meeting is rescheduled", async () => {
    const requestedSlot = {
      start: "2025-01-15T16:00:00.000Z",
      end: "2025-01-15T16:30:00.000Z",
    };
    const requestedSlotDateKey = requestedSlot.start.slice(0, 10);

    const meetingType: MeetingType = {
      id: "intro-30",
      title: "Introductory Call",
      description: "Meet and greet",
      durationMinutes: 30,
      isActive: true,
    };

    const decodedPayload: SignedLinkPayload = {
      action: "reschedule",
      meetingTypeId: meetingType.id,
      eventId: "evt-123",
      guestEmail: "guest@example.com",
      guestName: "Guest Name",
      expiresAt: "2025-02-01T00:00:00.000Z",
      calendarId: "primary",
      slotStart: "2025-01-10T15:00:00.000Z",
      slotEnd: "2025-01-10T15:30:00.000Z",
    };

    const managementLinksRaw = {
      cancel: { token: "cancel-token", expiresAt: "2025-02-01T00:00:00.000Z" },
      reschedule: { token: "reschedule-token", expiresAt: "2025-02-01T00:00:00.000Z" },
      manage: { token: "manage-token", expiresAt: "2025-02-01T00:00:00.000Z" },
    } as const;

    const managementLinks: ManagementLinkCollection = {
      cancel: {
        ...managementLinksRaw.cancel,
        path: "/cancel/cancel-token",
        url: "https://app.example.com/cancel/cancel-token",
      },
      reschedule: {
        ...managementLinksRaw.reschedule,
        path: "/reschedule/reschedule-token",
        url: "https://app.example.com/reschedule/reschedule-token",
      },
      manage: {
        ...managementLinksRaw.manage,
        path: "/manage/manage-token",
        url: "https://app.example.com/manage/manage-token",
      },
    };

    const calendarEventInitial: GoogleCalendarEvent = {
      id: decodedPayload.eventId,
      start: requestedSlot.start,
      end: requestedSlot.end,
      attendees: [{ email: decodedPayload.guestEmail }],
      raw: { description: "Existing description" },
    };

    const calendarEventFinal: GoogleCalendarEvent = {
      ...calendarEventInitial,
      raw: { description: "Updated description" },
    };

    vi.mocked(decodeSignedLinkPayload).mockReturnValue(decodedPayload);
    vi.mocked(verifySignedLink).mockReturnValue(decodedPayload);
    vi.mocked(getMeetingTypeById).mockReturnValue(meetingType);
    vi.mocked(getAvailabilityByDate).mockResolvedValue({
      [requestedSlotDateKey]: [requestedSlot],
    });
    vi.mocked(createManagementLinks).mockReturnValue(managementLinksRaw);
    vi.mocked(describeManagementLinks).mockReturnValue(managementLinks);
    vi.mocked(upsertManageLinkInDescription).mockReturnValue("Updated description");

    const updateCalendarEventMock = vi.mocked(updateCalendarEvent);
    updateCalendarEventMock.mockResolvedValueOnce(calendarEventInitial);
    updateCalendarEventMock.mockResolvedValueOnce(calendarEventFinal);

    const response = await PATCH(
      new Request("http://localhost/api/reschedule", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "signed-token", slot: requestedSlot }),
      }),
    );

    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json).toMatchObject({
      status: "rescheduled",
      event: calendarEventFinal,
      calendarId: decodedPayload.calendarId,
      managementLinks,
    });

    expect(createManagementLinks).toHaveBeenCalledWith({
      meetingTypeId: meetingType.id,
      eventId: decodedPayload.eventId,
      guestEmail: decodedPayload.guestEmail,
      guestName: decodedPayload.guestName,
      calendarId: decodedPayload.calendarId,
      slotStart: requestedSlot.start,
      slotEnd: requestedSlot.end,
    });

    expect(updateCalendarEventMock).toHaveBeenCalledTimes(2);

    const firstCall = updateCalendarEventMock.mock.calls[0]?.[0];
    expect(firstCall).toMatchObject({
      calendarId: decodedPayload.calendarId,
      eventId: decodedPayload.eventId,
      start: requestedSlot.start,
      end: requestedSlot.end,
      sendUpdates: "none",
      attendees: [{ email: decodedPayload.guestEmail }],
    });

    const secondCall = updateCalendarEventMock.mock.calls[1]?.[0];
    expect(secondCall).toMatchObject({
      calendarId: decodedPayload.calendarId,
      eventId: decodedPayload.eventId,
      start: requestedSlot.start,
      end: requestedSlot.end,
      sendUpdates: "all",
      attendees: [{ email: decodedPayload.guestEmail }],
      description: "Updated description",
    });

    expect(upsertManageLinkInDescription).toHaveBeenCalledWith(
      "Existing description",
      managementLinks.manage.url,
    );
  });
});

