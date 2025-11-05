import { createHmac, timingSafeEqual } from "node:crypto";

import { buildAbsoluteUrl, type HeaderSource } from "./url";
import { registerManageLinkAlias } from "./manage-link-alias";

export type SignedLinkPayload = {
  action: "cancel" | "reschedule" | "manage";
  meetingTypeId: string;
  eventId: string;
  guestEmail: string;
  expiresAt: string;
  calendarId?: string;
  guestName?: string;
  slotStart?: string;
  slotEnd?: string;
};

const HMAC_ALGORITHM = "sha256";

export const DEFAULT_MANAGEMENT_LINK_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

type LinkPayloadInput = Omit<SignedLinkPayload, "action" | "expiresAt">;

export type SignedLinkToken = {
  token: string;
  expiresAt: string;
};

export function generateSignedLink(
  action: SignedLinkPayload["action"],
  payload: LinkPayloadInput,
  ttlMs: number = DEFAULT_MANAGEMENT_LINK_TTL_MS,
): SignedLinkToken {
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  return {
    token: signLinkPayload({
      action,
      expiresAt,
      ...payload,
    }),
    expiresAt,
  };
}

export function createManagementLinks(
  payload: LinkPayloadInput,
  ttlMs: number = DEFAULT_MANAGEMENT_LINK_TTL_MS,
): { cancel: SignedLinkToken; reschedule: SignedLinkToken; manage: SignedLinkToken } {
  return {
    cancel: generateSignedLink("cancel", payload, ttlMs),
    reschedule: generateSignedLink("reschedule", payload, ttlMs),
    manage: generateSignedLink("manage", payload, ttlMs),
  };
}

export type ManagementLinkDescriptor = SignedLinkToken & {
  path: string;
  url: string;
};

export type ManagementLinkCollection = {
  cancel: ManagementLinkDescriptor;
  reschedule: ManagementLinkDescriptor;
  manage: ManagementLinkDescriptor;
};

type ManagementLinkOptions = {
  source?: Request | HeaderSource;
};

export function describeManagementLinks(
  links: { cancel: SignedLinkToken; reschedule: SignedLinkToken; manage: SignedLinkToken },
  options: ManagementLinkOptions = {},
): ManagementLinkCollection {
  const { source } = options;

  const cancelPath = `/cancel/${links.cancel.token}`;
  const reschedulePath = `/reschedule/${links.reschedule.token}`;
  const manageAlias = registerManageLinkAlias(links.manage.token, links.manage.expiresAt);
  const managePath = manageAlias ? `/m/${manageAlias}` : `/manage/${links.manage.token}`;

  return {
    cancel: {
      ...links.cancel,
      path: cancelPath,
      url: buildAbsoluteUrl(cancelPath, source),
    },
    reschedule: {
      ...links.reschedule,
      path: reschedulePath,
      url: buildAbsoluteUrl(reschedulePath, source),
    },
    manage: {
      ...links.manage,
      path: managePath,
      url: buildAbsoluteUrl(managePath, source),
    },
  };
}

export function upsertManageLinkInDescription(
  description: string | null | undefined,
  manageUrl: string,
): string {
  const normalizedDescription = typeof description === "string" ? description.replace(/\r\n/g, "\n") : "";
  const manageLabel = "Manage this meeting:";
  const manageLabelLower = manageLabel.toLowerCase();

  const lines = normalizedDescription.length > 0 ? normalizedDescription.split("\n") : [];
  const filteredLines: string[] = [];
  let skipNext = false;

  for (const line of lines) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    if (line.trim().toLowerCase() === manageLabelLower) {
      skipNext = true;
      continue;
    }

    filteredLines.push(line);
  }

  const trimmedUrl = manageUrl.trim();
  if (!trimmedUrl) {
    return filteredLines.join("\n");
  }

  while (filteredLines.length > 0 && filteredLines[filteredLines.length - 1].trim() === "") {
    filteredLines.pop();
  }

  if (filteredLines.length > 0) {
    filteredLines.push("");
  }

  filteredLines.push(manageLabel);
  filteredLines.push(trimmedUrl);

  return filteredLines.join("\n");
}

function getSigningSecret(): string {
  const secret = process.env.SIGNING_SECRET;
  if (!secret) {
    throw new Error("Missing SIGNING_SECRET environment variable for link signing.");
  }
  return secret;
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export function signLinkPayload(payload: SignedLinkPayload): string {
  const secret = getSigningSecret();
  const payloadJson = JSON.stringify(payload);
  const payloadEncoded = base64UrlEncode(Buffer.from(payloadJson, "utf8"));

  const signature = createHmac(HMAC_ALGORITHM, secret).update(payloadEncoded).digest();
  const signatureEncoded = base64UrlEncode(signature);

  return `${payloadEncoded}.${signatureEncoded}`;
}

export function decodeSignedLinkPayload(token: string): SignedLinkPayload | null {
  if (!token) {
    return null;
  }

  const [payloadEncoded] = token.split(".");
  if (!payloadEncoded) {
    return null;
  }

  try {
    const payloadJson = base64UrlDecode(payloadEncoded).toString("utf8");
    return JSON.parse(payloadJson) as SignedLinkPayload;
  } catch {
    return null;
  }
}

export function verifySignedLink(token: string): SignedLinkPayload | null {
  if (!token) {
    return null;
  }

  const [payloadEncoded, signatureEncoded] = token.split(".");
  if (!payloadEncoded || !signatureEncoded) {
    return null;
  }

  const secret = getSigningSecret();
  const expectedSignature = createHmac(HMAC_ALGORITHM, secret).update(payloadEncoded).digest();
  const providedSignature = base64UrlDecode(signatureEncoded);

  if (expectedSignature.length !== providedSignature.length) {
    return null;
  }

  try {
    if (!timingSafeEqual(expectedSignature, providedSignature)) {
      return null;
    }
  } catch {
    return null;
  }

  const payload = decodeSignedLinkPayload(token);
  if (!payload) {
    return null;
  }

  const expiresAt = Date.parse(payload.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return null;
  }

  if (!payload.action || !payload.meetingTypeId || !payload.eventId || !payload.guestEmail) {
    return null;
  }

  return payload;
}

