import type {
  AddChecklistItemInput,
  AnswerChecklistItemInput,
  AttachmentDto,
  ChecklistRunDto,
  ChecklistRunSummaryDto,
  ChecklistSuggestionDto,
  AddIssueCommentInput,
  CreateChecklistInput,
  CreateDocumentInput,
  CreateLicenceInput,
  DocumentDto,
  LicenceDto,
  LicenceReadingDto,
  UpdateLicenceInput,
  CreateIssueInput,
  IssueDto,
  IssueStatus,
  IssueSummaryDto,
  SupportContactDto,
  CreateOrganizationInput,
  CreateOutletInput,
  CreateRestaurantUserInput,
  OrganizationDto,
  OrganizationOutletDto,
  OutletDashboardDto,
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
  UpdateChecklistItemInput,
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
 * A photo to upload. In a browser this is a Blob; in the mobile app it is an
 * Expo `File` (from expo-file-system), which behaves like one.
 */
export type UploadFile = Blob;

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

  const query = (params: Record<string, string | number>) => {
    const pairs = Object.entries(params).map(([key, value]) => `${key}=${encodeURIComponent(value)}`);
    return pairs.length > 0 ? "?" + pairs.join("&") : "";
  };

  const id = encodeURIComponent;

  return {
    /** Turns a photo path from the API into a full address an image can load. */
    fileUrl: (path: string) => `${baseUrl}${path}`,
    attachments: {
      /**
       * Uploads a proof photo. Pass an id generated on the device so that
       * retrying after a dropped connection does not store it twice.
       */
      upload(input: {
        outletId: string;
        file: UploadFile;
        /** "DOCUMENT" for licences and the vault (photo or PDF); a proof photo otherwise. */
        kind?: "PROOF" | "DOCUMENT";
        /** The file's name, so the server and viewers know what it is. */
        fileName?: string;
        id?: string;
        capturedAt?: string;
      }) {
        const form = new FormData();
        form.append("outletId", input.outletId);
        if (input.kind) form.append("kind", input.kind);
        if (input.id) form.append("id", input.id);
        if (input.capturedAt) form.append("capturedAt", input.capturedAt);
        form.append("file", input.file, input.fileName ?? "photo.jpg");
        // The content type is left unset so the boundary is filled in automatically.
        return send<AttachmentDto>("POST", "/attachments", form, undefined, true);
      },
    },
    licences: {
      /** Licences soonest expiry first. `attentionOnly` keeps those expired or expiring soon. */
      list: (filter: { outletId?: string; attentionOnly?: boolean } = {}) =>
        call<LicenceDto[]>(
          "GET",
          `/licences${query({ ...(filter.outletId && { outletId: filter.outletId }), ...(filter.attentionOnly && { attention: "1" }) })}`,
        ),
      /** Reads the licence number and dates off an uploaded document, to pre-fill the form. May take several seconds. */
      read: (attachmentId: string) => call<LicenceReadingDto>("POST", "/licences/read", { attachmentId }),
      create: (input: CreateLicenceInput) => call<LicenceDto>("POST", "/licences", input),
      update: (licenceId: string, input: UpdateLicenceInput) =>
        call<LicenceDto>("PATCH", `/licences/${id(licenceId)}`, input),
      remove: (licenceId: string) => call<void>("DELETE", `/licences/${id(licenceId)}`),
    },
    /** The document vault. Each call returns the outlet's documents, newest first. */
    documents: {
      list: (outletId: string) => call<DocumentDto[]>("GET", `/documents${query({ outletId })}`),
      create: (input: CreateDocumentInput) => call<DocumentDto[]>("POST", "/documents", input),
      remove: (documentId: string) => call<DocumentDto[]>("DELETE", `/documents/${id(documentId)}`),
    },
    support: {
      contact: () => call<SupportContactDto>("GET", "/support/contact"),
    },
    /** ECCS support issues. Checklist problems are not issues and never appear here. */
    issues: {
      list: (filter: { outletId?: string; openOnly?: boolean } = {}) =>
        call<IssueSummaryDto[]>(
          "GET",
          `/issues${query({ ...(filter.outletId && { outletId: filter.outletId }), ...(filter.openOnly && { status: "open" }) })}`,
        ),
      get: (issueId: string) => call<IssueDto>("GET", `/issues/${id(issueId)}`),
      create: (input: CreateIssueInput) => call<IssueDto>("POST", "/issues", input),
      comment: (issueId: string, input: AddIssueCommentInput) =>
        call<IssueDto>("POST", `/issues/${id(issueId)}/comments`, input),
      setStatus: (issueId: string, status: IssueStatus) =>
        call<IssueDto>("PATCH", `/issues/${id(issueId)}`, { status }),
    },
    checklists: {
      today: (outletId: string) => call<ChecklistRunDto[]>("GET", `/checklists/today${query({ outletId })}`),
      history: (outletId: string, days = 7) =>
        call<ChecklistRunSummaryDto[]>("GET", `/checklists/history${query({ outletId, days })}`),
      run: (runId: string) => call<ChecklistRunDto>("GET", `/checklists/runs/${id(runId)}`),
      answer: (runId: string, itemId: string, input: AnswerChecklistItemInput) =>
        call<ChecklistRunDto>("PUT", `/checklists/runs/${id(runId)}/items/${id(itemId)}`, input),
      /** Un-ticks a tick-only item that was marked by mistake. */
      clearAnswer: (runId: string, itemId: string) =>
        call<ChecklistRunDto>("DELETE", `/checklists/runs/${id(runId)}/items/${id(itemId)}`),
      submit: (runId: string) => call<ChecklistRunDto>("POST", `/checklists/runs/${id(runId)}/submit`),
      review: (runId: string) => call<ChecklistRunDto>("POST", `/checklists/runs/${id(runId)}/review`),
      setup: (outletId: string) => call<OutletChecklistDto[]>("GET", `/checklists/setup${query({ outletId })}`),
      /** Ready-made checks matching what was typed, leaving out ones already on the checklist. */
      suggestions: (outletChecklistId: string, search: string) =>
        call<ChecklistSuggestionDto[]>(
          "GET",
          `/checklists/setup/${id(outletChecklistId)}/suggestions${query({ q: search })}`,
        ),
      createList: (input: CreateChecklistInput) => call<OutletChecklistDto[]>("POST", "/checklists/setup", input),
      updateList: (outletChecklistId: string, input: UpdateChecklistInput) =>
        call<OutletChecklistDto[]>("PATCH", `/checklists/setup/${id(outletChecklistId)}`, input),
      removeList: (outletChecklistId: string) =>
        call<OutletChecklistDto[]>("DELETE", `/checklists/setup/${id(outletChecklistId)}`),
      addItem: (outletChecklistId: string, input: AddChecklistItemInput) =>
        call<OutletChecklistDto[]>("POST", `/checklists/setup/${id(outletChecklistId)}/items`, input),
      updateItem: (itemId: string, input: UpdateChecklistItemInput) =>
        call<OutletChecklistDto[]>("PATCH", `/checklists/setup/items/${id(itemId)}`, input),
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
    /** Today at each of the person's outlets, for the restaurant's home screen. */
    dashboard: {
      get: () => call<OutletDashboardDto[]>("GET", "/dashboard"),
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
