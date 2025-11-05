import { NextResponse } from "next/server";
import { z } from "zod";

import { createCalendarEvent, getGoogleCalendarIds, updateCalendarEvent } from "@/lib/google";
import { createManagementLinks, describeManagementLinks, upsertManageLinkInDescription } from "@/lib/sign";
import { HOST_TIMEZONE, getAvailabilityByDate, getMeetingTypeById } from "@/lib/slots";

const bookingRequestSchema = z.object({
  meetingTypeId: z.string().min(1, "Meeting type is required"),
  slot: z.object({
    start: z.string().datetime(),
    end: z.string().datetime(),
  }),
  guest: z.object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Provide a valid email address"),
  }),
  guestTimezone: z.string().optional(),
  notes: z.string().max(1000).optional(),
});

type BookingRequestPayload = z.infer<typeof bookingRequestSchema>;

function buildEventDescription(payload: BookingRequestPayload): string {
  const lines = [
    `Guest: ${payload.guest.name} <${payload.guest.email}>`,
    `Guest timezone: ${payload.guestTimezone ?? "Not provided"}`,
    `Host timezone: ${HOST_TIMEZONE}`,
  ];

  if (payload.notes?.trim()) {
    lines.push("", "Notes:", payload.notes.trim());
  }

  return lines.join("\n");
}

export async function POST(request: Request) {
  const rawPayload = await request.json().catch(() => null);

  const parseResult = bookingRequestSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    return NextResponse.json(
      {
        status: "invalid",
        message: "The booking payload is invalid.",
        issues: parseResult.error.flatten(),
      },
      { status: 400 },
    );
  }

  const payload = parseResult.data;
  const meetingType = getMeetingTypeById(payload.meetingTypeId);

  if (!meetingType) {
    return NextResponse.json(
      {
        status: "unknown_meeting_type",
        message: `Meeting type ${payload.meetingTypeId} is not enabled.`,
      },
      { status: 404 },
    );
  }

  try {
    const availabilityByDate = await getAvailabilityByDate(payload.meetingTypeId);
    const dateKey = payload.slot.start.slice(0, 10);
    const slotsForDate = availabilityByDate[dateKey] ?? [];
    const isSlotStillAvailable = slotsForDate.some(
      (slot) => slot.start === payload.slot.start && slot.end === payload.slot.end,
    );

    if (!isSlotStillAvailable) {
      return NextResponse.json(
        {
          status: "conflict",
          message: "Selected slot is no longer available. Please choose another time.",
        },
        { status: 409 },
      );
    }

    const [calendarId] = getGoogleCalendarIds();
    const eventSummary = `${meetingType.title} with ${payload.guest.name}`;

    const baseDescription = buildEventDescription(payload);

    const event = await createCalendarEvent({
      calendarId,
      summary: eventSummary,
      description: baseDescription,
      start: payload.slot.start,
      end: payload.slot.end,
      attendees: [{ email: payload.guest.email, displayName: payload.guest.name }],
      sendUpdates: "none",
    });

    const managementLinksRaw = createManagementLinks({
      meetingTypeId: meetingType.id,
      eventId: event.id,
      guestEmail: payload.guest.email,
      guestName: payload.guest.name,
      calendarId,
      slotStart: event.start,
      slotEnd: event.end,
    });

    const managementLinks = describeManagementLinks(managementLinksRaw, { source: request });

    const descriptionWithManageLink = upsertManageLinkInDescription(baseDescription, managementLinks.manage.url);

    let eventForResponse = event;

    try {
      eventForResponse = await updateCalendarEvent({
        calendarId,
        eventId: event.id,
        start: event.start,
        end: event.end,
        summary: eventSummary,
        attendees: [{ email: payload.guest.email, displayName: payload.guest.name }],
        description: descriptionWithManageLink,
        sendUpdates: "all",
      });
    } catch (error) {
      console.error("[api/book] Failed to append manage link to calendar event", error);
    }

    return NextResponse.json(
      {
        status: "confirmed",
        eventId: eventForResponse.id,
        calendarId,
        htmlLink: eventForResponse.htmlLink,
        hangoutLink: eventForResponse.hangoutLink,
        start: eventForResponse.start,
        end: eventForResponse.end,
        managementLinks,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[api/book] Failed to create calendar event", error);

    return NextResponse.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : "Unexpected error creating booking.",
      },
      { status: 502 },
    );
  }
}

