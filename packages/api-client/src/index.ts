import type {
  AddChecklistItemInput,
  AnswerChecklistItemInput,
  AttachmentDto,
  ChecklistRunDto,
  ChecklistRunSummaryDto,
  CreateChecklistInput,
  CreateOrganizationInput,
  CreateOutletInput,
  CreateRestaurantUserInput,
  OrganizationDto,
  OrganizationOutletDto,
  OutletChecklistDto,
  CurrentUserDto,
  LinkDeviceInput,
  LinkedDeviceDto,
  OutletSummaryDto,
  PinLoginInput,
  RestaurantUserDto,
  RestaurantUserWithPinDto,
  SessionDto,
  UpdateChecklistInput,
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

/**
 * A photo to upload. In a browser this is a Blob; in the mobile app it is
 * the local file the camera wrote, described by its uri.
 */
export type UploadFile = Blob | { uri: string; name: string; type: string };

export type ApiClient = ReturnType<typeof createApiClient>;

/** The one way web and mobile talk to the API. */
export function createApiClient(options: ApiClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");

  async function send<T>(
    method: string,
    path: string,
    body: BodyInit | undefined,
    contentType: string | undefined,
    authenticated: boolean,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (contentType) headers["Content-Type"] = contentType;
    const token = authenticated ? options.getToken?.() : null;
    if (token) headers["Authorization"] = `Bearer ${token}`;

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, { method, headers, ...(body !== undefined && { body }) });
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

  const call = <T>(method: string, path: string, body?: unknown, authenticated = true) =>
    send<T>(
      method,
      path,
      body === undefined ? undefined : JSON.stringify(body),
      body === undefined ? undefined : "application/json",
      authenticated,
    );

  const query = (params: Record<string, string | number>) =>
    "?" + Object.entries(params).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");

  const id = encodeURIComponent;

  return {
    /** Turns a photo path from the API into a full address an image can load. */
    fileUrl: (path: string) => `${baseUrl}${path}`,
    attachments: {
      /**
       * Uploads a proof photo. Pass an id generated on the device so that
       * retrying after a dropped connection does not store it twice.
       */
      upload(input: { outletId: string; file: UploadFile; id?: string; capturedAt?: string }) {
        const form = new FormData();
        form.append("outletId", input.outletId);
        if (input.id) form.append("id", input.id);
        if (input.capturedAt) form.append("capturedAt", input.capturedAt);
        // React Native's FormData accepts a { uri, name, type } object where a browser takes a Blob.
        form.append("file", input.file as Blob, "name" in input.file ? input.file.name : "photo.jpg");
        // The content type is left unset so the boundary is filled in automatically.
        return send<AttachmentDto>("POST", "/attachments", form, undefined, true);
      },
    },
    checklists: {
      today: (outletId: string) => call<ChecklistRunDto[]>("GET", `/checklists/today${query({ outletId })}`),
      history: (outletId: string, days = 7) =>
        call<ChecklistRunSummaryDto[]>("GET", `/checklists/history${query({ outletId, days })}`),
      run: (runId: string) => call<ChecklistRunDto>("GET", `/checklists/runs/${id(runId)}`),
      answer: (runId: string, itemId: string, input: AnswerChecklistItemInput) =>
        call<ChecklistRunDto>("PUT", `/checklists/runs/${id(runId)}/items/${id(itemId)}`, input),
      submit: (runId: string) => call<ChecklistRunDto>("POST", `/checklists/runs/${id(runId)}/submit`),
      review: (runId: string) => call<ChecklistRunDto>("POST", `/checklists/runs/${id(runId)}/review`),
      setup: (outletId: string) => call<OutletChecklistDto[]>("GET", `/checklists/setup${query({ outletId })}`),
      createList: (input: CreateChecklistInput) => call<OutletChecklistDto[]>("POST", "/checklists/setup", input),
      updateList: (outletChecklistId: string, input: UpdateChecklistInput) =>
        call<OutletChecklistDto[]>("PATCH", `/checklists/setup/${id(outletChecklistId)}`, input),
      removeList: (outletChecklistId: string) =>
        call<OutletChecklistDto[]>("DELETE", `/checklists/setup/${id(outletChecklistId)}`),
      addItem: (outletChecklistId: string, input: AddChecklistItemInput) =>
        call<OutletChecklistDto[]>("POST", `/checklists/setup/${id(outletChecklistId)}/items`, input),
      removeItem: (itemId: string) => call<OutletChecklistDto[]>("DELETE", `/checklists/setup/items/${id(itemId)}`),
    },
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
