import { createApiClient } from '@eccs/api-client';

// Set EXPO_PUBLIC_API_URL when the API is not on this machine, for example
// http://192.168.1.20:4000/v1 to test from a real phone on the same Wi-Fi.
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/v1';

// The session token lives here, outside React, so every request can read
// the current value. SessionProvider keeps it in step with stored state.
let sessionToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export const setSessionToken = (token: string | null) => {
  sessionToken = token;
};

/** Registers what to do when the server says the session has ended. */
export const setUnauthorizedHandler = (handler: (() => void) | null) => {
  unauthorizedHandler = handler;
};

export const api = createApiClient({
  baseUrl: API_URL,
  getToken: () => sessionToken,
  onUnauthorized: () => unauthorizedHandler?.(),
});
