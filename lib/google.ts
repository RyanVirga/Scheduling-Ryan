import { randomUUID } from "node:crypto";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_FREEBUSY_ENDPOINT = "https://www.googleapis.com/calendar/v3/freeBusy";
const GOOGLE_EVENTS_BASE = "https://www.googleapis.com/calendar/v3/calendars";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type GoogleHealthStatus = {
  status: "ok" | "degraded" | "error";
  detail: string;
  source: "mock" | "live";
};

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

export type GoogleAccessToken = {
  accessToken: string;
  expiresIn: number;
  expiresAt: number;
  tokenType: string;
  scope?: string;
  idToken?: string;
  raw: Record<string, unknown>;
};

export class GoogleAuthConfigError extends Error {
  constructor(message: string, public readonly missingEnv: string[]) {
    super(message);
    this.name = "GoogleAuthConfigError";
  }
}

export class GoogleAuthError extends Error {
  constructor(message: string, public readonly status: number, public readonly responseBody?: unknown) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

export class GoogleCalendarConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleCalendarConfigError";
  }
}

export class GoogleApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly responseBody?: unknown) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export function getGoogleOAuthConfig(): GoogleOAuthConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    const missing: string[] = [];
    if (!clientId) missing.push("GOOGLE_CLIENT_ID");
    if (!clientSecret) missing.push("GOOGLE_CLIENT_SECRET");
    if (!refreshToken) missing.push("GOOGLE_REFRESH_TOKEN");

    throw new GoogleAuthConfigError(
      `Missing required Google OAuth environment variables: ${missing.join(", ")}`,
      missing,
    );
  }

  return {
    clientId,
    clientSecret,
    refreshToken,
  };
}

export async function getGoogleAccessToken(fetchImpl: FetchLike = fetch): Promise<GoogleAccessToken> {
  const { clientId, clientSecret, refreshToken } = getGoogleOAuthConfig();

  const requestBody = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: requestBody.toString(),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorCode = typeof payload.error === "string" ? payload.error : "unknown_error";
    const errorDescription =
      typeof payload.error_description === "string"
        ? payload.error_description
        : "Failed to exchange Google refresh token.";

    throw new GoogleAuthError(`${errorCode}: ${errorDescription}`, response.status, payload);
  }

  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  const tokenType = typeof payload.token_type === "string" ? payload.token_type : "Bearer";
  const expiresInRaw = typeof payload.expires_in === "number" ? payload.expires_in : Number(payload.expires_in);
  const expiresIn = Number.isFinite(expiresInRaw) ? expiresInRaw : 0;
  const expiresAt = Date.now() + expiresIn * 1000;

  if (!accessToken) {
    throw new GoogleAuthError("Received empty access token from Google.", response.status, payload);
  }

  const scope = typeof payload.scope === "string" ? payload.scope : undefined;
  const idToken = typeof payload.id_token === "string" ? payload.id_token : undefined;

  return {
    accessToken,
    tokenType,
    expiresIn,
    expiresAt,
    scope,
    idToken,
    raw: payload as Record<string, unknown>,
  };
}

export type GoogleBusyTimeRange = {
  start: string;
  end: string;
};

export type GoogleFreeBusyResult = Record<string, GoogleBusyTimeRange[]>;

export type GoogleFreeBusyOptions = {
  timeMin: Date | string;
  timeMax: Date | string;
  calendarIds?: string[];
  fetchImpl?: FetchLike;
};

export type GoogleCalendarAttendee = {
  email: string;
  displayName?: string;
};

export type CreateCalendarEventOptions = {
  calendarId: string;
  summary: string;
  description?: string;
  start: Date | string;
  end: Date | string;
  attendees?: GoogleCalendarAttendee[];
  sendUpdates?: "all" | "externalOnly" | "none";
  fetchImpl?: FetchLike;
};

export type UpdateCalendarEventOptions = {
  calendarId: string;
  eventId: string;
  start: Date | string;
  end: Date | string;
  summary?: string;
  description?: string;
  attendees?: GoogleCalendarAttendee[];
  sendUpdates?: "all" | "externalOnly" | "none";
  fetchImpl?: FetchLike;
};

export type GoogleCalendarEvent = {
  id: string;
  htmlLink?: string;
  hangoutLink?: string;
  start: string;
  end: string;
  attendees?: { email?: string; responseStatus?: string }[];
  raw: Record<string, unknown>;
};

export type DeleteCalendarEventOptions = {
  calendarId: string;
  eventId: string;
  sendUpdates?: "all" | "externalOnly" | "none";
  fetchImpl?: FetchLike;
};

export type DeleteCalendarEventResult =
  | { status: "deleted" }
  | { status: "not_found" };

export function getGoogleCalendarIds(): string[] {
  const envValue = process.env.GOOGLE_CALENDAR_ID ?? process.env.GOOGLE_CALENDAR_IDS;
  if (!envValue) {
    throw new GoogleCalendarConfigError(
      "Missing GOOGLE_CALENDAR_ID environment variable. Provide a calendar ID or comma-separated IDs.",
    );
  }

  const ids = envValue
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (ids.length === 0) {
    throw new GoogleCalendarConfigError(
      "GOOGLE_CALENDAR_ID environment variable is defined but empty. Provide at least one calendar ID.",
    );
  }

  return ids;
}

function toUtcISOString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Invalid date provided to Google API request.");
  }

  return date.toISOString();
}

export async function getGoogleFreeBusy(options: GoogleFreeBusyOptions): Promise<GoogleFreeBusyResult> {
  const { timeMin, timeMax, calendarIds = getGoogleCalendarIds(), fetchImpl = fetch } = options;

  const token = await getGoogleAccessToken(fetchImpl);

  const body = {
    timeMin: toUtcISOString(timeMin),
    timeMax: toUtcISOString(timeMax),
    items: calendarIds.map((id) => ({ id })),
  };

  const response = await fetchImpl(GOOGLE_FREEBUSY_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `${token.tokenType} ${token.accessToken}`.trim(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      typeof payload.error?.message === "string"
        ? payload.error.message
        : "Failed to fetch Google Calendar FreeBusy data.";
    throw new GoogleApiError(message, response.status, payload);
  }

  const calendarsPayload = (payload?.calendars ?? {}) as Record<string, { busy?: GoogleBusyTimeRange[] }>;
  const result: GoogleFreeBusyResult = {};

  for (const calendarId of calendarIds) {
    const busyEntries = calendarsPayload[calendarId]?.busy ?? [];
    result[calendarId] = busyEntries.map((entry) => ({ start: entry.start, end: entry.end }));
  }

  return result;
}

export async function createCalendarEvent(options: CreateCalendarEventOptions): Promise<GoogleCalendarEvent> {
  const {
    calendarId,
    summary,
    description,
    start,
    end,
    attendees = [],
    sendUpdates = "all",
    fetchImpl = fetch,
  } = options;

  const token = await getGoogleAccessToken(fetchImpl);

  const endpoint = new URL(`${GOOGLE_EVENTS_BASE}/${encodeURIComponent(calendarId)}/events`);
  endpoint.searchParams.set("sendUpdates", sendUpdates);
  endpoint.searchParams.set("conferenceDataVersion", "1");

  const startIso = toUtcISOString(start);
  const endIso = toUtcISOString(end);

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Authorization: `${token.tokenType} ${token.accessToken}`.trim(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summary,
      description,
      start: {
        dateTime: startIso,
        timeZone: "UTC",
      },
      end: {
        dateTime: endIso,
        timeZone: "UTC",
      },
      attendees: attendees.map((attendee) => ({
        email: attendee.email,
        displayName: attendee.displayName,
      })),
      conferenceData: {
        createRequest: {
          conferenceSolutionKey: {
            type: "hangoutsMeet",
          },
          requestId: randomUUID(),
        },
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      typeof payload.error?.message === "string"
        ? payload.error.message
        : "Failed to create Google Calendar event.";
    throw new GoogleApiError(message, response.status, payload);
  }

  return mapGoogleEventPayload(payload, startIso, endIso);
}

export async function deleteCalendarEvent(options: DeleteCalendarEventOptions): Promise<DeleteCalendarEventResult> {
  const { calendarId, eventId, sendUpdates = "all", fetchImpl = fetch } = options;

  const token = await getGoogleAccessToken(fetchImpl);
  const endpoint = new URL(
    `${GOOGLE_EVENTS_BASE}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
  );
  endpoint.searchParams.set("sendUpdates", sendUpdates);

  const response = await fetchImpl(endpoint, {
    method: "DELETE",
    headers: {
      Authorization: `${token.tokenType} ${token.accessToken}`.trim(),
    },
  });

  if (response.status === 404 || response.status === 410) {
    return { status: "not_found" };
  }

  if (response.status === 204 || response.status === 200) {
    return { status: "deleted" };
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      typeof payload.error?.message === "string"
        ? payload.error.message
        : "Failed to delete Google Calendar event.";
    throw new GoogleApiError(message, response.status, payload);
  }

  return { status: "deleted" };
}

export async function updateCalendarEvent(options: UpdateCalendarEventOptions): Promise<GoogleCalendarEvent> {
  const {
    calendarId,
    eventId,
    start,
    end,
    summary,
    description,
    attendees,
    sendUpdates = "all",
    fetchImpl = fetch,
  } = options;

  const token = await getGoogleAccessToken(fetchImpl);
  const endpoint = new URL(
    `${GOOGLE_EVENTS_BASE}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
  );
  endpoint.searchParams.set("sendUpdates", sendUpdates);
  endpoint.searchParams.set("conferenceDataVersion", "1");

  const startIso = toUtcISOString(start);
  const endIso = toUtcISOString(end);

  const body: Record<string, unknown> = {
    start: {
      dateTime: startIso,
      timeZone: "UTC",
    },
    end: {
      dateTime: endIso,
      timeZone: "UTC",
    },
  };

  if (typeof summary === "string") {
    body.summary = summary;
  }

  if (typeof description === "string") {
    body.description = description;
  }

  if (Array.isArray(attendees) && attendees.length > 0) {
    body.attendees = attendees.map((attendee) => ({
      email: attendee.email,
      displayName: attendee.displayName,
    }));
  }

  const response = await fetchImpl(endpoint, {
    method: "PATCH",
    headers: {
      Authorization: `${token.tokenType} ${token.accessToken}`.trim(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      typeof payload.error?.message === "string"
        ? payload.error.message
        : "Failed to update Google Calendar event.";
    throw new GoogleApiError(message, response.status, payload);
  }

  return mapGoogleEventPayload(payload, startIso, endIso);
}

function mapGoogleEventPayload(payload: unknown, fallbackStartIso: string, fallbackEndIso: string): GoogleCalendarEvent {
  const eventPayload = (payload ?? {}) as Record<string, unknown>;
  const conferenceData = eventPayload.conferenceData as
    | {
        entryPoints?: { entryPointType?: string; uri?: string }[];
      }
    | undefined;

  const hangoutLink =
    typeof eventPayload.hangoutLink === "string"
      ? (eventPayload.hangoutLink as string)
      : conferenceData?.entryPoints?.find(
          (entry) => entry?.entryPointType === "video" && typeof entry?.uri === "string",
        )?.uri;

  const startObj = (eventPayload.start as { dateTime?: string }) ?? {};
  const endObj = (eventPayload.end as { dateTime?: string }) ?? {};

  return {
    id: typeof eventPayload.id === "string" ? (eventPayload.id as string) : "",
    htmlLink: typeof eventPayload.htmlLink === "string" ? (eventPayload.htmlLink as string) : undefined,
    hangoutLink,
    start: typeof startObj.dateTime === "string" ? startObj.dateTime : fallbackStartIso,
    end: typeof endObj.dateTime === "string" ? endObj.dateTime : fallbackEndIso,
    attendees: Array.isArray(eventPayload.attendees)
      ? (eventPayload.attendees as { email?: string; responseStatus?: string }[])
      : undefined,
    raw: eventPayload,
  };
}

export async function getGoogleHealth(fetchImpl: FetchLike = fetch): Promise<GoogleHealthStatus> {
  try {
    const calendars = getGoogleCalendarIds();
    const now = new Date();
    const horizon = new Date(now.getTime() + 60 * 60 * 1000);

    await getGoogleFreeBusy({
      timeMin: now,
      timeMax: horizon,
      calendarIds: calendars,
      fetchImpl,
    });

    return {
      status: "ok",
      detail: `Google Calendar reachable (${calendars.join(", ")})`,
      source: "live",
    };
  } catch (error) {
    if (error instanceof GoogleAuthConfigError || error instanceof GoogleCalendarConfigError) {
      return {
        status: "degraded",
        detail: error.message,
        source: "live",
      };
    }

    if (error instanceof GoogleAuthError) {
      return {
        status: "error",
        detail: error.message,
        source: "live",
      };
    }

    if (error instanceof GoogleApiError) {
      return {
        status: "degraded",
        detail: error.message,
        source: "live",
      };
    }

    return {
      status: "error",
      detail: "Unexpected error while checking Google Calendar health.",
      source: "live",
    };
  }
}

export async function listCalendarEventsMock() {
  // TODO: Replace with Google Calendar Events list when API integration lands.
  return [] as const;
}

