type HeaderLike = {
  get(name: string): string | null;
};

export type HeaderSource = HeaderLike | null | undefined;

function toHeaderSource(source?: Request | HeaderSource): HeaderSource {
  if (!source) {
    return undefined;
  }

  if (typeof Request !== "undefined" && source instanceof Request) {
    return source.headers;
  }

  return source as HeaderSource;
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    return url.origin;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

function resolveFromHeaders(headers?: HeaderSource): string | null {
  if (!headers || typeof headers.get !== "function") {
    return null;
  }

  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) {
    return null;
  }

  const proto = headers.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export function resolveAppBaseUrl(source?: Request | HeaderSource): string {
  const envUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? process.env.APP_URL ?? null;

  if (typeof envUrl === "string" && envUrl.trim().length > 0) {
    return normalizeBaseUrl(envUrl);
  }

  const headers = toHeaderSource(source);
  const headerUrl = resolveFromHeaders(headers);
  if (headerUrl) {
    return normalizeBaseUrl(headerUrl);
  }

  return "http://localhost:3000";
}

export function buildAbsoluteUrl(path: string, source?: Request | HeaderSource): string {
  const base = resolveAppBaseUrl(source);
  if (!path.startsWith("/")) {
    return new URL(path, `${base}/`).toString();
  }

  return `${base}${path}`;
}


