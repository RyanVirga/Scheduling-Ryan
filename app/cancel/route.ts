import { NextResponse } from "next/server";

import { deleteCalendarEvent, getGoogleCalendarIds, GoogleApiError } from "@/lib/google";
import { decodeSignedLinkPayload, verifySignedLink } from "@/lib/sign";

type CancelResponse = {
  status:
    | "cancelled"
    | "invalid_token"
    | "expired"
    | "not_found"
    | "google_error"
    | "error";
  message?: string;
  eventId?: string;
  meetingTypeId?: string;
  guestEmail?: string;
  calendarId?: string;
};

async function extractToken(request: Request): Promise<string | null> {
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  if (typeof queryToken === "string" && queryToken.length > 0) {
    return queryToken;
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return null;
  }

  const body = await request
    .json()
    .catch(() => null) as { token?: unknown } | null;

  const tokenFromBody = body?.token;
  return typeof tokenFromBody === "string" && tokenFromBody.length > 0 ? tokenFromBody : null;
}

export async function POST(request: Request) {
  const token = await extractToken(request);

  if (!token) {
    return NextResponse.json<CancelResponse>(
      {
        status: "invalid_token",
        message: "A cancellation token is required.",
      },
      { status: 400 },
    );
  }

  const decoded = decodeSignedLinkPayload(token);
  if (!decoded) {
    return NextResponse.json<CancelResponse>(
      {
        status: "invalid_token",
        message: "The cancellation link is malformed.",
      },
      { status: 400 },
    );
  }

  const verified = verifySignedLink(token);
  if (!verified) {
    const expiresAtMs = Date.parse(decoded.expiresAt);
    if (Number.isFinite(expiresAtMs) && expiresAtMs < Date.now()) {
      return NextResponse.json<CancelResponse>(
        {
          status: "expired",
          message: "This cancellation link has expired.",
          meetingTypeId: decoded.meetingTypeId,
          guestEmail: decoded.guestEmail,
        },
        { status: 410 },
      );
    }

    return NextResponse.json<CancelResponse>(
      {
        status: "invalid_token",
        message: "The cancellation link is invalid.",
      },
      { status: 400 },
    );
  }

  const calendarId = decoded.calendarId ?? getGoogleCalendarIds()[0];

  try {
    const deleteResult = await deleteCalendarEvent({
      calendarId,
      eventId: verified.eventId,
      sendUpdates: "all",
    });

    if (deleteResult.status === "not_found") {
      return NextResponse.json<CancelResponse>(
        {
          status: "not_found",
          message: "This meeting was already cancelled or cannot be found.",
          eventId: verified.eventId,
          meetingTypeId: verified.meetingTypeId,
          guestEmail: verified.guestEmail,
          calendarId,
        },
        { status: 410 },
      );
    }

    return NextResponse.json<CancelResponse>({
      status: "cancelled",
      eventId: verified.eventId,
      meetingTypeId: verified.meetingTypeId,
      guestEmail: verified.guestEmail,
      calendarId,
    });
  } catch (error) {
    if (error instanceof GoogleApiError) {
      return NextResponse.json<CancelResponse>(
        {
          status: "google_error",
          message: error.message,
        },
        { status: 502 },
      );
    }

    console.error("[cancel] Unexpected error while cancelling meeting", error);

    return NextResponse.json<CancelResponse>(
      {
        status: "error",
        message: "Unexpected error cancelling the meeting.",
      },
      { status: 500 },
    );
  }
}

export function GET() {
  return NextResponse.json<CancelResponse>(
    {
      status: "invalid_token",
      message: "Use POST with a signed token to cancel a meeting.",
    },
    {
      status: 405,
      headers: {
        Allow: "POST",
      },
    },
  );
}

