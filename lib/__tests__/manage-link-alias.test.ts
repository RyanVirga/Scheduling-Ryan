import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  registerManageLinkAlias,
  resolveManageLinkAlias,
  purgeExpiredManageAliases,
  resetManageLinkAliasStoreForTests,
} from "../manage-link-alias";

describe("manage-link-alias", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "manage-alias-test-"));
    const storePath = join(tempDir, "aliases.json");
    vi.stubEnv("MANAGE_ALIAS_STORE_PATH", storePath);

    resetManageLinkAliasStoreForTests();
    vi.useRealTimers();
  });

  afterEach(() => {
    resetManageLinkAliasStoreForTests();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns a stable alias for the same token", () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    const first = registerManageLinkAlias("token-123", expiresAt);
    const second = registerManageLinkAlias("token-123", expiresAt);

    expect(first).toBeTypeOf("string");
    expect(second).toBe(first);
  });

  it("resolves an alias back to the manage token", () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const alias = registerManageLinkAlias("token-abc", expiresAt);

    expect(alias).toBeTypeOf("string");

    if (!alias) {
      throw new Error("Expected alias to be defined");
    }

    const record = resolveManageLinkAlias(alias);
    expect(record).not.toBeNull();
    expect(record?.token).toBe("token-abc");
    expect(record?.expiresAt).toBe(expiresAt);
  });

  it("expires aliases once the TTL passes", () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const expiresAt = new Date(now + 1_000).toISOString();
    const alias = registerManageLinkAlias("token-expiring", expiresAt);

    expect(alias).toBeTypeOf("string");

    if (!alias) {
      throw new Error("Expected alias to be defined");
    }

    expect(resolveManageLinkAlias(alias)).not.toBeNull();

    vi.advanceTimersByTime(1_500);

    expect(purgeExpiredManageAliases()).toBe(1);
    expect(resolveManageLinkAlias(alias)).toBeNull();
  });
});


