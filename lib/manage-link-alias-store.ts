import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

export type ManageLinkAliasRecord = {
  token: string;
  expiresAt: string;
  createdAt: number;
};

type StoredAliasRecords = Record<string, ManageLinkAliasRecord>;

const DEFAULT_STORE_PATH = join(process.cwd(), ".cache", "manage-aliases.json");

function getStorePath(): string {
  return process.env.MANAGE_ALIAS_STORE_PATH?.trim() || DEFAULT_STORE_PATH;
}

function ensureDirectoryExists(filePath: string): void {
  const directory = dirname(filePath);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }
}

function normalizeRecords(candidate: unknown): StoredAliasRecords {
  if (!candidate || typeof candidate !== "object") {
    return {};
  }

  const normalized: StoredAliasRecords = {};

  for (const [alias, rawRecord] of Object.entries(candidate)) {
    if (!rawRecord || typeof rawRecord !== "object") {
      continue;
    }

    const record = rawRecord as Partial<ManageLinkAliasRecord>;
    if (typeof record.token !== "string" || typeof record.expiresAt !== "string") {
      continue;
    }

    const createdAt = typeof record.createdAt === "number" ? record.createdAt : Date.now();
    normalized[alias] = {
      token: record.token,
      expiresAt: record.expiresAt,
      createdAt,
    };
  }

  return normalized;
}

export function readAliasStore(): StoredAliasRecords {
  const storePath = getStorePath();

  try {
    const fileContents = readFileSync(storePath, "utf8");
    return normalizeRecords(JSON.parse(fileContents));
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export function writeAliasStore(records: StoredAliasRecords): void {
  const storePath = getStorePath();
  ensureDirectoryExists(storePath);

  const serialized = JSON.stringify(records, null, 2);
  const tempPath = `${storePath}.tmp`;

  writeFileSync(tempPath, serialized, "utf8");
  renameSync(tempPath, storePath);
}

export function clearAliasStore(): void {
  const storePath = getStorePath();

  try {
    unlinkSync(storePath);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
}


