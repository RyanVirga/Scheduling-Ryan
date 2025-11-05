import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createCalendarEvent,
  deleteCalendarEvent,
  getGoogleAccessToken,
  getGoogleCalendarIds,
  getGoogleFreeBusy,
  getGoogleHealth,
  getGoogleOAuthConfig,
  GoogleAuthConfigError,
  GoogleApiError,
  GoogleCalendarConfigError,
  updateCalendarEvent,
} from "@/lib/google";

const originalEnv = { ...process.env };

describe("Google OAuth helper", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("reads OAuth config from environment variables", () => {
    process.env.GOOGLE_CLIENT_ID = "client";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.GOOGLE_REFRESH_TOKEN = "refresh";

    const config = getGoogleOAuthConfig();

    expect(config).toEqual({
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh",
    });
  });

  it("throws when OAuth credentials are missing", () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REFRESH_TOKEN;

    expect(() => getGoogleOAuthConfig()).toThrowError(GoogleAuthConfigError);
  });

  it("reads calendar IDs from environment", () => {
    process.env.GOOGLE_CALENDAR_ID = "calendar-one, calendar-two";

    const ids = getGoogleCalendarIds();

    expect(ids).toEqual(["calendar-one", "calendar-two"]);
  });

  it("throws when calendar ID is not provided", () => {
    delete process.env.GOOGLE_CALENDAR_ID;
    delete process.env.GOOGLE_CALENDAR_IDS;

    expect(() => getGoogleCalendarIds()).toThrowError(GoogleCalendarConfigError);
  });

  it("exchanges refresh token for access token", async () => {
    process.env.GOOGLE_CLIENT_ID = "client";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.GOOGLE_REFRESH_TOKEN = "refresh";

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          access_token: "access-token",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/calendar",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const token = await getGoogleAccessToken(fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "Content-Type": "application/x-www-form-urlencoded" });

    const params = new URLSearchParams((init?.body as string) ?? "");
    expect(params.get("client_id")).toBe("client");
    expect(params.get("client_secret")).toBe("secret");
    expect(params.get("refresh_token")).toBe("refresh");
    expect(params.get("grant_type")).toBe("refresh_token");

    expect(token.accessToken).toBe("access-token");
    expect(token.tokenType).toBe("Bearer");
    expect(token.expiresIn).toBe(3600);
    expect(token.expiresAt).toBeGreaterThan(Date.now());
    expect(token.scope).toBe("https://www.googleapis.com/auth/calendar");
  });

  it("fetches FreeBusy data with UTC boundaries", async () => {
    process.env.GOOGLE_CLIENT_ID = "client";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.GOOGLE_REFRESH_TOKEN = "refresh";
    process.env.GOOGLE_CALENDAR_ID = "primary";

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(
          JSON.stringify({ access_token: "access", token_type: "Bearer", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url === "https://www.googleapis.com/calendar/v3/freeBusy") {
        return new Response(
          JSON.stringify({
            calendars: {
              primary: {
                busy: [
                  { start: "2025-01-01T12:00:00.000Z", end: "2025-01-01T13:00:00.000Z" },
                  { start: "2025-01-01T15:30:00.000Z", end: "2025-01-01T16:15:00.000Z" },
                ],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      throw new Error(`Unexpected fetch call to ${url}`);
    });

    const result = await getGoogleFreeBusy({
      timeMin: new Date("2025-01-01T00:00:00Z"),
      timeMax: "2025-01-02T00:00:00Z",
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, init] = fetchMock.mock.calls[1] ?? [];
    const body = JSON.parse((init?.body as string) ?? "{}");

    expect(body.timeMin).toBe("2025-01-01T00:00:00.000Z");
    expect(body.timeMax).toBe("2025-01-02T00:00:00.000Z");
    expect(body.items).toEqual([{ id: "primary" }]);
    expect(init?.headers).toMatchObject({ Authorization: "Bearer access" });

    expect(result.primary).toEqual([
      { start: "2025-01-01T12:00:00.000Z", end: "2025-01-01T13:00:00.000Z" },
      { start: "2025-01-01T15:30:00.000Z", end: "2025-01-01T16:15:00.000Z" },
    ]);
  });

  it("creates calendar events with sendUpdates", async () => {
    process.env.GOOGLE_CLIENT_ID = "client";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.GOOGLE_REFRESH_TOKEN = "refresh";

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(
          JSON.stringify({ access_token: "access", token_type: "Bearer", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/primary/events")) {
        const parsedUrl = new URL(url);
        expect(parsedUrl.searchParams.get("sendUpdates")).toBe("all");
        expect(parsedUrl.searchParams.get("conferenceDataVersion")).toBe("1");

        const body = JSON.parse((init?.body as string) ?? "{}");
        expect(body.summary).toBe("30-Minute Intro with Jane Doe");
        expect(body.start.timeZone).toBe("UTC");
        expect(body.attendees).toEqual([{ email: "jane@example.com", displayName: "Jane Doe" }]);
        expect(body.conferenceData).toBeDefined();
        expect(body.conferenceData.createRequest).toBeDefined();
        expect(body.conferenceData.createRequest.conferenceSolutionKey).toEqual({ type: "hangoutsMeet" });
        expect(typeof body.conferenceData.createRequest.requestId).toBe("string");
        expect(body.conferenceData.createRequest.requestId.length).toBeGreaterThan(0);

        return new Response(
          JSON.stringify({
            id: "event-123",
            start: { dateTime: body.start.dateTime },
            end: { dateTime: body.end.dateTime },
            attendees: body.attendees,
            hangoutLink: "https://meet.google.com/test-link",
            conferenceData: {
              entryPoints: [
                {
                  entryPointType: "video",
                  uri: "https://meet.google.com/test-link",
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      throw new Error(`Unexpected fetch call to ${url}`);
    }) as unknown as typeof fetch;

    const event = await createCalendarEvent({
      calendarId: "primary",
      summary: "30-Minute Intro with Jane Doe",
      description: "Discovery call",
      start: "2025-01-01T18:00:00Z",
      end: "2025-01-01T18:30:00Z",
      attendees: [{ email: "jane@example.com", displayName: "Jane Doe" }],
      fetchImpl: fetchMock,
    });

    expect(event.id).toBe("event-123");
    expect(event.hangoutLink).toBe("https://meet.google.com/test-link");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("deletes calendar events with sendUpdates", async () => {
    process.env.GOOGLE_CLIENT_ID = "client";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.GOOGLE_REFRESH_TOKEN = "refresh";

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(
          JSON.stringify({ access_token: "access", token_type: "Bearer", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url === "https://www.googleapis.com/calendar/v3/calendars/primary/events/event-123?sendUpdates=all") {
        expect(init?.method).toBe("DELETE");
        expect(init?.headers).toMatchObject({ Authorization: "Bearer access" });
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected fetch call to ${url}`);
    }) as unknown as typeof fetch;

    await expect(
      deleteCalendarEvent({
        calendarId: "primary",
        eventId: "event-123",
        fetchImpl: fetchMock,
      }),
    ).resolves.toEqual({ status: "deleted" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns not_found when Google reports missing event", async () => {
    process.env.GOOGLE_CLIENT_ID = "client";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.GOOGLE_REFRESH_TOKEN = "refresh";

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(
          JSON.stringify({ access_token: "access", token_type: "Bearer", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url === "https://www.googleapis.com/calendar/v3/calendars/primary/events/event-123?sendUpdates=all") {
        return new Response("", { status: 404 });
      }

      throw new Error(`Unexpected fetch call to ${url}`);
    }) as unknown as typeof fetch;

    await expect(
      deleteCalendarEvent({
        calendarId: "primary",
        eventId: "event-123",
        fetchImpl: fetchMock,
      }),
    ).resolves.toEqual({ status: "not_found" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("bubbles up delete failures", async () => {
    process.env.GOOGLE_CLIENT_ID = "client";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.GOOGLE_REFRESH_TOKEN = "refresh";

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(
          JSON.stringify({ access_token: "access", token_type: "Bearer", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url === "https://www.googleapis.com/calendar/v3/calendars/primary/events/event-123?sendUpdates=all") {
        return new Response(JSON.stringify({ error: { message: "Rate limit" } }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`Unexpected fetch call to ${url}`);
    }) as unknown as typeof fetch;

    await expect(
      deleteCalendarEvent({
        calendarId: "primary",
        eventId: "event-123",
        fetchImpl: fetchMock,
      }),
    ).rejects.toBeInstanceOf(GoogleApiError);
  });

  it("updates calendar events with sendUpdates", async () => {
    process.env.GOOGLE_CLIENT_ID = "client";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.GOOGLE_REFRESH_TOKEN = "refresh";

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(
          JSON.stringify({ access_token: "access", token_type: "Bearer", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/primary/events/event-123")) {
        const parsedUrl = new URL(url);
        expect(parsedUrl.searchParams.get("sendUpdates")).toBe("all");
        expect(parsedUrl.searchParams.get("conferenceDataVersion")).toBe("1");
        expect(init?.method).toBe("PATCH");
        expect(init?.headers).toMatchObject({ Authorization: "Bearer access" });

        const body = JSON.parse((init?.body as string) ?? "{}");
        expect(body.start.timeZone).toBe("UTC");
        expect(body.end.timeZone).toBe("UTC");

        return new Response(
          JSON.stringify({
            id: "event-123",
            start: { dateTime: body.start.dateTime },
            end: { dateTime: body.end.dateTime },
            hangoutLink: "https://meet.google.com/updated-link",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      throw new Error(`Unexpected fetch call to ${url}`);
    }) as unknown as typeof fetch;

    const event = await updateCalendarEvent({
      calendarId: "primary",
      eventId: "event-123",
      start: "2025-01-01T18:00:00Z",
      end: "2025-01-01T18:30:00Z",
      fetchImpl: fetchMock,
    });

    expect(event.id).toBe("event-123");
    expect(event.hangoutLink).toBe("https://meet.google.com/updated-link");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("bubbles up update failures", async () => {
    process.env.GOOGLE_CLIENT_ID = "client";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.GOOGLE_REFRESH_TOKEN = "refresh";

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(
          JSON.stringify({ access_token: "access", token_type: "Bearer", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/primary/events/event-123")) {
        const parsedUrl = new URL(url);
        expect(parsedUrl.searchParams.get("sendUpdates")).toBe("all");
        expect(parsedUrl.searchParams.get("conferenceDataVersion")).toBe("1");
        return new Response(JSON.stringify({ error: { message: "Conflict" } }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`Unexpected fetch call to ${url}`);
    }) as unknown as typeof fetch;

    await expect(
      updateCalendarEvent({
        calendarId: "primary",
        eventId: "event-123",
        start: "2025-01-01T18:00:00Z",
        end: "2025-01-01T18:30:00Z",
        fetchImpl: fetchMock,
      }),
    ).rejects.toBeInstanceOf(GoogleApiError);
  });

  it("performs a live-style health check", async () => {
    process.env.GOOGLE_CLIENT_ID = "client";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.GOOGLE_REFRESH_TOKEN = "refresh";
    process.env.GOOGLE_CALENDAR_ID = "primary";

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(
          JSON.stringify({ access_token: "access", token_type: "Bearer", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url === "https://www.googleapis.com/calendar/v3/freeBusy") {
        return new Response(JSON.stringify({ calendars: { primary: { busy: [] } } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`Unexpected fetch call to ${url}`);
    }) as unknown as typeof fetch;

    const health = await getGoogleHealth(fetchMock);

    expect(health.status).toBe("ok");
    expect(health.source).toBe("live");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("bubbles up calendar API failures", async () => {
    process.env.GOOGLE_CLIENT_ID = "client";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.GOOGLE_REFRESH_TOKEN = "refresh";

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(
          JSON.stringify({ access_token: "access", token_type: "Bearer", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(JSON.stringify({ error: { message: "calendar error" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await expect(
      createCalendarEvent({
        calendarId: "primary",
        summary: "Intro",
        start: new Date(),
        end: new Date(Date.now() + 30 * 60 * 1000),
        fetchImpl: fetchMock,
      }),
    ).rejects.toBeInstanceOf(GoogleApiError);
  });
});

