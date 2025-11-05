import { randomBytes } from "node:crypto";

import {
  clearAliasStore,
  readAliasStore,
  type ManageLinkAliasRecord,
  writeAliasStore,
} from "./manage-link-alias-store";

const ALIAS_BYTE_LENGTH = 6; // Generates an 8 character base64url string
const MAX_GENERATION_ATTEMPTS = 5;

function generateAlias(): string {
  return randomBytes(ALIAS_BYTE_LENGTH).toString("base64url");
}

function isExpired(expiresAt: string, now: number): boolean {
  const timestamp = Date.parse(expiresAt);
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  return timestamp <= now;
}

export function registerManageLinkAlias(token: string, expiresAt: string): string | null {
  if (!token) {
    return null;
  }

  const now = Date.now();
  const records = readAliasStore();
  let storeChanged = false;
  let existingAlias: string | null = null;

  for (const [alias, record] of Object.entries(records)) {
    if (isExpired(record.expiresAt, now)) {
      delete records[alias];
      storeChanged = true;
      continue;
    }

    if (record.token === token) {
      existingAlias = alias;
      break;
    }
  }

  if (existingAlias) {
    if (storeChanged) {
      writeAliasStore(records);
    }
    return existingAlias;
  }

  let generatedAlias: string | null = null;

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const aliasCandidate = generateAlias();
    const record = records[aliasCandidate];

    if (record) {
      if (isExpired(record.expiresAt, now)) {
        delete records[aliasCandidate];
        storeChanged = true;
      }

      continue;
    }

    const newRecord: ManageLinkAliasRecord = {
      token,
      expiresAt,
      createdAt: now,
    };

    records[aliasCandidate] = newRecord;
    storeChanged = true;
    generatedAlias = aliasCandidate;
    break;
  }

  if (storeChanged) {
    writeAliasStore(records);
  }

  return generatedAlias;
}

export function resolveManageLinkAlias(alias: string): ManageLinkAliasRecord | null {
  if (!alias) {
    return null;
  }

  const now = Date.now();
  const records = readAliasStore();
  const record = records[alias];

  if (!record) {
    return null;
  }

  if (isExpired(record.expiresAt, now)) {
    delete records[alias];
    writeAliasStore(records);
    return null;
  }

  return record;
}

export function purgeExpiredManageAliases(now: number = Date.now()): number {
  const records = readAliasStore();
  let purged = 0;
  let storeChanged = false;

  for (const [alias, record] of Object.entries(records)) {
    if (isExpired(record.expiresAt, now)) {
      delete records[alias];
      storeChanged = true;
      purged += 1;
    }
  }

  if (storeChanged) {
    writeAliasStore(records);
  }

  return purged;
}

export function resetManageLinkAliasStoreForTests(): void {
  clearAliasStore();
}


