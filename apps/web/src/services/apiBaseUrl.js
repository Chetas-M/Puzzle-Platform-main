const DEFAULT_API_PORT = import.meta.env.VITE_API_PORT || "4100";

function isLoopbackHost(hostname) {
  const normalized = `${hostname || ""}`.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function detectBrowserApiBaseUrl() {
  if (typeof window === "undefined") {
    return `http://localhost:${DEFAULT_API_PORT}`;
  }

  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  const hostname = window.location.hostname || "localhost";
  return `${protocol}//${hostname}:${DEFAULT_API_PORT}`;
}

export function getApiBaseUrl() {
  const configured = `${import.meta.env.VITE_API_BASE_URL || ""}`.trim();
  if (!configured) {
    return detectBrowserApiBaseUrl();
  }

  if (typeof window === "undefined") {
    return configured;
  }

  try {
    const parsed = new URL(configured);
    const browserHost = window.location.hostname || "localhost";

    if (!isLoopbackHost(browserHost) && isLoopbackHost(parsed.hostname)) {
      parsed.hostname = browserHost;
    }

    if (import.meta.env.VITE_API_PORT) {
      parsed.port = `${import.meta.env.VITE_API_PORT}`;
    }

    return parsed.toString().replace(/\/$/, "");
  } catch {
    return detectBrowserApiBaseUrl();
  }
}
