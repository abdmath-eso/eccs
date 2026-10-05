import type {
  CreateOrganizationInput,
  CreateOutletInput,
  CreateRestaurantUserInput,
  OrganizationDto,
  OrganizationOutletDto,
  CurrentUserDto,
  LinkDeviceInput,
  LinkedDeviceDto,
  OutletSummaryDto,
  PinLoginInput,
  RestaurantUserDto,
  RestaurantUserWithPinDto,
  SessionDto,
  UpdateProfileInput,
  UpdateRestaurantUserInput,
  VerifyOtpInput,
} from "@eccs/shared";

/** A failed API call. `message` is safe to show to the user. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Machine-readable reason, e.g. "DEVICE_NOT_LINKED". */
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** True when the server could not be reached at all. */
  get isNetworkError() {
    return this.status === 0;
  }
}

export interface ApiClientOptions {
  /** e.g. "http://localhost:4000/v1" */
  baseUrl: string;
  /** Returns the current session token, if logged in. */
  getToken?: () => string | null | undefined;
  /** Called when the server says the session is no longer valid. */
  onUnauthorized?: () => void;
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** The one way web and mobile talk to the API. */
export function createApiClient(options: ApiClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");

  async function call<T>(method: string, path: string, body?: unknown, authenticated = true): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const token = authenticated ? options.getToken?.() : null;
    if (token) headers["Authorization"] = `Bearer ${token}`;

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiError("Could not reach the server. Check your connection.", 0);
    }

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = undefined;
    }

    if (!response.ok) {
      const details = (data ?? {}) as { message?: unknown; code?: unknown };
      const message = typeof details.message === "string" ? details.message : "Something went wrong. Try again.";
      const code = typeof details.code === "string" ? details.code : undefined;
      if (response.status === 401 && authenticated && token) options.onUnauthorized?.();
      throw new ApiError(message, response.status, code);
    }
    return data as T;
  }

  return {
    auth: {
      requestOtp: (phone: string) =>
        call<{ expiresInSeconds: number }>("POST", "/auth/otp/request", { phone }, false),
      verifyOtp: (input: VerifyOtpInput) => call<SessionDto>("POST", "/auth/otp/verify", input, false),
      linkDevice: (input: LinkDeviceInput) => call<LinkedDeviceDto>("POST", "/auth/device/link", input, false),
      pinLogin: (input: PinLoginInput) => call<SessionDto>("POST", "/auth/pin/login", input, false),
      me: () => call<CurrentUserDto>("GET", "/auth/me"),
      updateProfile: (input: UpdateProfileInput) => call<CurrentUserDto>("PATCH", "/auth/me", input),
      logout: () => call<void>("POST", "/auth/logout"),
    },
    outlets: {
      list: () => call<OutletSummaryDto[]>("GET", "/outlets"),
    },
    organizations: {
      list: () => call<OrganizationDto[]>("GET", "/organizations"),
      create: (input: CreateOrganizationInput) => call<OrganizationDto>("POST", "/organizations", input),
      addOutlet: (organizationId: string, input: CreateOutletInput) =>
        call<OrganizationOutletDto>("POST", `/organizations/${encodeURIComponent(organizationId)}/outlets`, input),
    },
    restaurantUsers: {
      list: () => call<RestaurantUserDto[]>("GET", "/restaurant-users"),
      create: (input: CreateRestaurantUserInput) =>
        call<RestaurantUserWithPinDto>("POST", "/restaurant-users", input),
      resetPin: (userId: string) =>
        call<RestaurantUserWithPinDto>("POST", `/restaurant-users/${encodeURIComponent(userId)}/reset-pin`),
      update: (userId: string, input: UpdateRestaurantUserInput) =>
        call<RestaurantUserDto>("PATCH", `/restaurant-users/${encodeURIComponent(userId)}`, input),
    },
  };
}
