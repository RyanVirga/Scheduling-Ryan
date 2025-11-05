import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getAvailabilityByDate,
  getAvailabilityWithFallback,
  getMeetingTypeById,
  HOST_TIMEZONE,
  type MeetingType,
} from "@/lib/slots";
import {
  createManagementLinks,
  decodeSignedLinkPayload,
  describeManagementLinks,
  upsertManageLinkInDescription,
  verifySignedLink,
  type ManagementLinkCollection,
} from "@/lib/sign";
import {
  GoogleApiError,
  getGoogleCalendarIds,
  updateCalendarEvent,
  type GoogleCalendarEvent,
} from "@/lib/google";

const rescheduleRequestSchema = z.object({
  token: z.string().min(1, "Token is required"),
  slot: z.object({
    start: z.string().datetime(),
    end: z.string().datetime(),
  }),
});

type RescheduleErrorStatus =
  | "invalid_token"
  | "expired"
  | "unknown_meeting_type"
  | "unavailable"
  | "google_error"
  | "not_found"
  | "unchanged"
  | "error";

type RescheduleSuccess = {
  status: "ok";
  meetingType: MeetingType;
  hostTimezone: string;
  slotsByDate: Awaited<ReturnType<typeof getAvailabilityByDate>>;
  source: "google" | "mock";
  fallback: boolean;
  message?: string;
  currentSlot: { start: string; end: string } | null;
  calendarId: string;
  guest: { name?: string; email: string };
};

type RescheduleError = {
  status: RescheduleErrorStatus;
  message: string;
};

type RescheduleUpdateResponse = {
  status: "rescheduled";
  event: GoogleCalendarEvent;
  calendarId: string;
  managementLinks: ManagementLinkCollection;
};

function buildErrorResponse(error: RescheduleError, init?: ResponseInit) {
  return NextResponse.json<RescheduleError>(error, init);
}

function isLinkExpired(expiresAt: string): boolean {
  const expiresAtMs = Date.parse(expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs < Date.now();
}

function removeExistingSlot(
  slotsByDate: Awaited<ReturnType<typeof getAvailabilityByDate>>,
  existingSlotStart?: string,
) {
  if (!existingSlotStart) {
    return slotsByDate;
  }

  const dateKey = existingSlotStart.slice(0, 10);
  const slotsForDate = slotsByDate[dateKey] ?? [];

  if (!slotsForDate.some((slot) => slot.start === existingSlotStart)) {
    return slotsByDate;
  }

  return {
    ...slotsByDate,
    [dateKey]: slotsForDate.filter((slot) => slot.start !== existingSlotStart),
  };
}

function getCalendarIdFromToken(tokenCalendarId?: string): string {
  if (tokenCalendarId) {
    return tokenCalendarId;
  }

  const [calendarId] = getGoogleCalendarIds();
  return calendarId;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";

  if (!token) {
    return buildErrorResponse({ status: "invalid_token", message: "Missing reschedule token." }, { status: 400 });
  }

  const decoded = decodeSignedLinkPayload(token);
  if (!decoded || decoded.action !== "reschedule") {
    return buildErrorResponse({ status: "invalid_token", message: "Reschedule token is malformed." }, { status: 400 });
  }

  const verified = verifySignedLink(token);
  if (!verified) {
    if (isLinkExpired(decoded.expiresAt)) {
      return buildErrorResponse(
        { status: "expired", message: "This reschedule link has expired." },
        { status: 410 },
      );
    }

    return buildErrorResponse(
      { status: "invalid_token", message: "Reschedule token could not be verified." },
      { status: 400 },
    );
  }

  const meetingType = getMeetingTypeById(verified.meetingTypeId);

  if (!meetingType) {
    return buildErrorResponse(
      {
        status: "unknown_meeting_type",
        message: `Meeting type ${verified.meetingTypeId} is not enabled.`,
      },
      { status: 404 },
    );
  }

  let calendarId: string;
  try {
    calendarId = getCalendarIdFromToken(decoded.calendarId);
  } catch (error) {
    return buildErrorResponse(
      {
        status: "google_error",
        message: error instanceof Error ? error.message : "Unable to determine calendar ID.",
      },
      { status: 500 },
    );
  }

  try {
    const availability = await getAvailabilityWithFallback(meetingType.id);
    const sanitized = removeExistingSlot(availability.slotsByDate, decoded.slotStart);

    const currentSlot = decoded.slotStart && decoded.slotEnd ? { start: decoded.slotStart, end: decoded.slotEnd } : null;

    return NextResponse.json<RescheduleSuccess>({
      status: "ok",
      meetingType,
      hostTimezone: HOST_TIMEZONE,
      slotsByDate: sanitized,
      source: availability.source,
      fallback: availability.fallback,
      message: availability.message,
      currentSlot,
      calendarId,
      guest: {
        name: decoded.guestName,
        email: decoded.guestEmail,
      },
    });
  } catch (error) {
    if (error instanceof GoogleApiError) {
      return buildErrorResponse(
        {
          status: "google_error",
          message: error.message,
        },
        { status: 502 },
      );
    }

    return buildErrorResponse(
      {
        status: "error",
        message: "Unable to load availability for rescheduling.",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const payload = await request.json().catch(() => null);

  const parseResult = rescheduleRequestSchema.safeParse(payload);
  if (!parseResult.success) {
    return buildErrorResponse(
      {
        status: "invalid_token",
        message: "Reschedule request payload is invalid.",
      },
      { status: 400 },
    );
  }

  const { token, slot } = parseResult.data;
  const decoded = decodeSignedLinkPayload(token);

  if (!decoded || decoded.action !== "reschedule") {
    return buildErrorResponse(
      {
        status: "invalid_token",
        message: "Reschedule token is malformed.",
      },
      { status: 400 },
    );
  }

  const verified = verifySignedLink(token);
  if (!verified) {
    if (isLinkExpired(decoded.expiresAt)) {
      return buildErrorResponse(
        { status: "expired", message: "This reschedule link has expired." },
        { status: 410 },
      );
    }

    return buildErrorResponse(
      { status: "invalid_token", message: "Reschedule token could not be verified." },
      { status: 400 },
    );
  }

  const meetingType = getMeetingTypeById(verified.meetingTypeId);

  if (!meetingType) {
    return buildErrorResponse(
      {
        status: "unknown_meeting_type",
        message: `Meeting type ${verified.meetingTypeId} is not enabled.`,
      },
      { status: 404 },
    );
  }

  if (decoded.slotStart && decoded.slotStart === slot.start) {
    return buildErrorResponse(
      {
        status: "unchanged",
        message: "Select a different time to reschedule this meeting.",
      },
      { status: 400 },
    );
  }

  let calendarId: string;
  try {
    calendarId = getCalendarIdFromToken(decoded.calendarId);
  } catch (error) {
    return buildErrorResponse(
      {
        status: "google_error",
        message: error instanceof Error ? error.message : "Unable to determine calendar ID.",
      },
      { status: 500 },
    );
  }

  try {
    const availability = await getAvailabilityByDate(meetingType.id);
    const dateKey = slot.start.slice(0, 10);
    const slotsForDate = availability[dateKey] ?? [];
    const slotAvailable = slotsForDate.some(
      (candidate) => candidate.start === slot.start && candidate.end === slot.end,
    );

    if (!slotAvailable) {
      return buildErrorResponse(
        {
          status: "unavailable",
          message: "That time was just booked. Please choose another slot.",
        },
        { status: 409 },
      );
    }

    const managementLinksRaw = createManagementLinks({
      meetingTypeId: meetingType.id,
      eventId: verified.eventId,
      guestEmail: decoded.guestEmail,
      guestName: decoded.guestName,
      calendarId,
      slotStart: slot.start,
      slotEnd: slot.end,
    });

    const managementLinks = describeManagementLinks(managementLinksRaw, { source: request });

    const updatedEvent = await updateCalendarEvent({
      calendarId,
      eventId: verified.eventId,
      start: slot.start,
      end: slot.end,
      summary:
        typeof decoded.guestName === "string" && decoded.guestName.length > 0
          ? `${meetingType.title} with ${decoded.guestName}`
          : undefined,
      attendees: [{ email: decoded.guestEmail }],
      sendUpdates: "none",
    });

    let finalEvent = updatedEvent;

    try {
      const descriptionWithManage = upsertManageLinkInDescription(
        typeof updatedEvent.raw.description === "string" ? updatedEvent.raw.description : "",
        managementLinks.manage.url,
      );

      finalEvent = await updateCalendarEvent({
        calendarId,
        eventId: verified.eventId,
        start: updatedEvent.start,
        end: updatedEvent.end,
        summary:
          typeof decoded.guestName === "string" && decoded.guestName.length > 0
            ? `${meetingType.title} with ${decoded.guestName}`
            : undefined,
        attendees: [{ email: decoded.guestEmail }],
        description: descriptionWithManage,
        sendUpdates: "all",
      });
    } catch (error) {
      console.error("[reschedule] Failed to refresh manage link in calendar event", error);
    }

    return NextResponse.json<RescheduleUpdateResponse>({
      status: "rescheduled",
      event: finalEvent,
      calendarId,
      managementLinks,
    });
  } catch (error) {
    if (error instanceof GoogleApiError) {
      if (error.status === 404 || error.status === 410) {
        return buildErrorResponse(
          {
            status: "not_found",
            message: "We could not find an active event to reschedule.",
          },
          { status: 410 },
        );
      }

      if (error.status === 409) {
        return buildErrorResponse(
          {
            status: "unavailable",
            message: error.message,
          },
          { status: 409 },
        );
      }

      return buildErrorResponse(
        {
          status: "google_error",
          message: error.message,
        },
        { status: 502 },
      );
    }

    console.error("[reschedule] Unexpected error while updating meeting", error);

    return buildErrorResponse(
      {
        status: "error",
        message: "Unexpected error while rescheduling.",
      },
      { status: 500 },
    );
  }
}

