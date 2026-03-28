const DEFAULT_API_PORT = "4100";

function detectBrowserApiBaseUrl() {
  if (typeof window === "undefined") {
    return `http://localhost:${DEFAULT_API_PORT}`;
  }

  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  const hostname = window.location.hostname || "localhost";
  return `${protocol}//${hostname}:${DEFAULT_API_PORT}`;
}

export function getApiBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL || detectBrowserApiBaseUrl();
}
