import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createManagementLinks,
  generateSignedLink,
  signLinkPayload,
  upsertManageLinkInDescription,
  verifySignedLink,
  type SignedLinkPayload,
} from "@/lib/sign";

const ORIGINAL_ENV = { ...process.env };

describe("link signing", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.SIGNING_SECRET = "test-signing-secret";
  });

  it("upserts manage link section into descriptions", () => {
    const original = "Guest: Jane\nNotes:\nBring questions.\n\nManage this meeting:\nhttps://old.example.com";
    const nextUrl = "https://app.example.com/manage/new-token";

    const updated = upsertManageLinkInDescription(original, nextUrl);
    expect(updated).toContain("Manage this meeting:\nhttps://app.example.com/manage/new-token");
    expect(updated.includes("old.example.com")).toBe(false);

    const withoutSection = "Guest: Jane";
    const appended = upsertManageLinkInDescription(withoutSection, nextUrl);
    expect(appended).toBe(`Guest: Jane\n\nManage this meeting:\n${nextUrl}`);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("signs and verifies link payloads", () => {
    const payload: SignedLinkPayload = {
      action: "cancel",
      meetingTypeId: "intro-30",
      eventId: "evt-123",
      guestEmail: "guest@example.com",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      calendarId: "primary",
    };

    const token = signLinkPayload(payload);
    const verified = verifySignedLink(token);

    expect(token).toMatch(/\./);
    expect(verified).toEqual(payload);
  });

  it("rejects tampered payloads", () => {
    const payload: SignedLinkPayload = {
      action: "reschedule",
      meetingTypeId: "intro-30",
      eventId: "evt-456",
      guestEmail: "guest@example.com",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };

    const token = signLinkPayload(payload);
    const [payloadPart, signature] = token.split(".");
    const alteredPayload = `${payloadPart.slice(0, -1)}${payloadPart.slice(-1) === "A" ? "B" : "A"}`;
    const tamperedToken = `${alteredPayload}.${signature}`;

    expect(verifySignedLink(tamperedToken)).toBeNull();
  });

  it("rejects expired payloads", () => {
    const payload: SignedLinkPayload = {
      action: "cancel",
      meetingTypeId: "intro-30",
      eventId: "evt-789",
      guestEmail: "guest@example.com",
      expiresAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    };

    const token = signLinkPayload(payload);

    expect(verifySignedLink(token)).toBeNull();
  });

  it("generates management links with matching expirations", () => {
    const now = new Date();
    const slotStart = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    const slotEnd = new Date(now.getTime() + 90 * 60 * 1000).toISOString();

    const links = createManagementLinks({
      meetingTypeId: "intro-30",
      eventId: "evt-123",
      guestEmail: "guest@example.com",
      guestName: "Guest McGuest",
      calendarId: "primary",
      slotStart,
      slotEnd,
    });

    const cancelPayload = verifySignedLink(links.cancel.token);
    const reschedulePayload = verifySignedLink(links.reschedule.token);
    const managePayload = verifySignedLink(links.manage.token);

    expect(cancelPayload).not.toBeNull();
    expect(reschedulePayload).not.toBeNull();
    expect(managePayload).not.toBeNull();
    expect(cancelPayload?.expiresAt).toBe(links.cancel.expiresAt);
    expect(reschedulePayload?.expiresAt).toBe(links.reschedule.expiresAt);
    expect(managePayload?.expiresAt).toBe(links.manage.expiresAt);
    expect(links.cancel.expiresAt).toBe(links.reschedule.expiresAt);
    expect(links.manage.expiresAt).toBe(links.cancel.expiresAt);
    expect(new Date(links.cancel.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("supports custom TTL when generating a signed link", () => {
    const ttlMs = 10 * 60 * 1000;
    const { token, expiresAt } = generateSignedLink(
      "cancel",
      {
        meetingTypeId: "intro-30",
        eventId: "evt-ttl",
        guestEmail: "guest@example.com",
      },
      ttlMs,
    );

    const payload = verifySignedLink(token);
    expect(payload).not.toBeNull();
    expect(payload?.expiresAt).toBe(expiresAt);
  });
});

