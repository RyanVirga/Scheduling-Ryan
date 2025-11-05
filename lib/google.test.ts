import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GoogleAuthConfigError,
  GoogleAuthError,
  getGoogleAccessToken,
} from "./google";

const ORIGINAL_ENV = process.env;

describe("getGoogleAccessToken", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.GOOGLE_CLIENT_ID = "test-client";
    process.env.GOOGLE_CLIENT_SECRET = "test-secret";
    process.env.GOOGLE_REFRESH_TOKEN = "test-refresh";
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("throws GoogleAuthConfigError when required env vars are missing", async () => {
    delete process.env.GOOGLE_CLIENT_ID;

    await expect(getGoogleAccessToken).rejects.toBeInstanceOf(GoogleAuthConfigError);
  });

  it("exchanges refresh token for an access token", async () => {
    const fetchMock = vi.fn(async (_input, init): Promise<Response> => {
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        "Content-Type": "application/x-www-form-urlencoded",
      });
      expect(init?.body).toBe(
        "client_id=test-client&client_secret=test-secret&refresh_token=test-refresh&grant_type=refresh_token",
      );

      return {
        ok: true,
        json: async () => ({
          access_token: "access-token",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "scope-value",
        }),
      } as unknown as Response;
    });

    const token = await getGoogleAccessToken(fetchMock);

    expect(token).toEqual({
      accessToken: "access-token",
      tokenType: "Bearer",
      expiresIn: 3600,
      expiresAt: expect.any(Number),
      scope: "scope-value",
      idToken: undefined,
      raw: {
        access_token: "access-token",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "scope-value",
      },
    });

    expect(token.expiresAt).toBeGreaterThan(Date.now());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://oauth2.googleapis.com/token", expect.any(Object));
  });

  it("throws GoogleAuthError when Google rejects the token exchange", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          error: "invalid_grant",
          error_description: "Bad refresh token",
        }),
      } as unknown as Response;
    });

    await expect(getGoogleAccessToken(fetchMock)).rejects.toMatchObject({
      name: "GoogleAuthError",
      message: "invalid_grant: Bad refresh token",
      status: 400,
    });
  });
});

