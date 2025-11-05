import { NextResponse } from "next/server";

import {
  createManagementLinks,
  decodeSignedLinkPayload,
  describeManagementLinks,
  verifySignedLink,
  type ManagementLinkCollection,
} from "@/lib/sign";
import { HOST_TIMEZONE, getMeetingTypeById, type MeetingType } from "@/lib/slots";
import { getGoogleCalendarIds } from "@/lib/google";

type ManageSuccessResponse = {
  status: "ok";
  meetingType: MeetingType;
  hostTimezone: string;
  currentSlot: { start: string; end: string } | null;
  guest: { name?: string; email: string };
  calendarId: string;
  managementLinks: ManagementLinkCollection;
};

type ManageErrorStatus = "invalid_token" | "expired" | "unknown_meeting_type" | "error";

type ManageErrorResponse = {
  status: ManageErrorStatus;
  message: string;
};

type ManageResponse = ManageSuccessResponse | ManageErrorResponse;

function buildErrorResponse(response: ManageErrorResponse, init?: ResponseInit) {
  return NextResponse.json<ManageErrorResponse>(response, init);
}

function isLinkExpired(expiresAt: string): boolean {
  const expiresAtMs = Date.parse(expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs < Date.now();
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
    return buildErrorResponse(
      {
        status: "invalid_token",
        message: "Missing manage token.",
      },
      { status: 400 },
    );
  }

  const decoded = decodeSignedLinkPayload(token);
  if (!decoded || decoded.action !== "manage") {
    return buildErrorResponse(
      {
        status: "invalid_token",
        message: "Manage token is malformed.",
      },
      { status: 400 },
    );
  }

  const verified = verifySignedLink(token);
  if (!verified) {
    if (isLinkExpired(decoded.expiresAt)) {
      return buildErrorResponse(
        {
          status: "expired",
          message: "This manage link has expired.",
        },
        { status: 410 },
      );
    }

    return buildErrorResponse(
      {
        status: "invalid_token",
        message: "Manage token could not be verified.",
      },
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
        status: "error",
        message: error instanceof Error ? error.message : "Unable to determine calendar ID.",
      },
      { status: 500 },
    );
  }

  const managementLinksRaw = createManagementLinks({
    meetingTypeId: meetingType.id,
    eventId: verified.eventId,
    guestEmail: decoded.guestEmail,
    guestName: decoded.guestName,
    calendarId,
    slotStart: decoded.slotStart,
    slotEnd: decoded.slotEnd,
  });

  const managementLinks = describeManagementLinks(managementLinksRaw, { source: request });

  const currentSlot =
    decoded.slotStart && decoded.slotEnd ? { start: decoded.slotStart, end: decoded.slotEnd } : null;

  return NextResponse.json<ManageSuccessResponse>({
    status: "ok",
    meetingType,
    hostTimezone: HOST_TIMEZONE,
    currentSlot,
    guest: {
      name: decoded.guestName,
      email: decoded.guestEmail,
    },
    calendarId,
    managementLinks,
  });
}

export function POST() {
  return buildErrorResponse(
    {
      status: "invalid_token",
      message: "Use GET with a signed token to view meeting management.",
    },
    {
      status: 405,
      headers: {
        Allow: "GET",
      },
    },
  );
}


