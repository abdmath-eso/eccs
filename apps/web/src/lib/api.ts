import { createApiClient } from "@eccs/api-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/v1";
const TOKEN_KEY = "eccs.console.token";

// The session token is kept in this browser's storage and sent as a header.
// Hardening to do before real client data: move it to an httpOnly cookie
// behind a same-site proxy so page scripts cannot read it (docs/STATUS.md).
let unauthorizedHandler: (() => void) | null = null;

export const getStoredToken = () => (typeof localStorage === "undefined" ? null : localStorage.getItem(TOKEN_KEY));

export function storeToken(token: string | null) {
  if (typeof localStorage === "undefined") return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/** Registers what to do when the server says the session has ended. */
export const setUnauthorizedHandler = (handler: (() => void) | null) => {
  unauthorizedHandler = handler;
};

export const api = createApiClient({
  baseUrl: API_URL,
  getToken: getStoredToken,
  // The console is in English, so whatever the server words or translates for it is English too.
  getLanguage: () => "EN",
  // Tells the server's activity log that requests come from the console. The console has no
  // release numbers of its own yet, so its version is fixed.
  client: { name: "console", version: "console-1" },
  onUnauthorized: () => unauthorizedHandler?.(),
});
