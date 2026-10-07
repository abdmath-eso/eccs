import type {
  AddChecklistItemInput,
  AnswerChecklistItemInput,
  AnswerVisitTaskInput,
  AttachmentDto,
  BookingDto,
  ConfirmBookingInput,
  CreateBookingInput,
  CreateVisitInput,
  ServiceCatalogItemDto,
  ServiceTypeDto,
  SupervisorDto,
  UpdateVisitInput,
  UpdateVisitRecordInput,
  VisitDto,
  VisitPhotoKind,
  VisitSummaryDto,
  CalendarMonthDto,
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
  CreateSopInput,
  SopDto,
  SopLibraryItemDto,
  SopLibraryOverviewDto,
  UpdateSopInput,
  OrganizationDto,
  OrganizationOutletDto,
  OutletDashboardDto,
  OutletPlanDto,
  PlanDto,
  SetOutletPlanInput,
  OutletChecklistDto,
  CurrentUserDto,
  LinkDeviceInput,
  LinkedDeviceDto,
  OutletSummaryDto,
  PinLoginInput,
  ProfileDto,
  RestaurantUserDto,
  RestaurantUserWithPinDto,
  ReturnReportInput,
  SessionDto,
  SignOffVisitInput,
  UpdateChecklistInput,
  UpdateChecklistItemInput,
  UpdateProfileInput,
  UpdateRestaurantUserInput,
  VerifyOtpInput,
} from "@eccs/shared";

// notifications-types: the notifications worker imports its types from "@eccs/shared" on the next line
import type { NotificationPageDto, UnreadCountDto } from "@eccs/shared";
// inspections-types: the inspections worker imports its types from "@eccs/shared" on the next line
import type {
  AnswerInspectionCheckInput,
  InspectionAnswerResultDto,
  InspectionDto,
  InspectionOutletDto,
  InspectionSummaryDto,
  ReturnInspectionInput,
  StartInspectionInput,
  UpdateInspectionInput,
} from "@eccs/shared";

/** A failed API call. `message` is safe to show to the user. */
export class ApiError extends Error {
  /** Machine-readable reason, e.g. "DEVICE_NOT_LINKED". */
  readonly code?: string;
  /** How long to wait before trying again, where the server says so (a locked PIN pad). */
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    readonly status: number,
    code?: string,
  ) {
    super(message);
    this.name = "ApiError";
    // The server writes a wait after the reason, e.g. "PIN_LOCKED:540"; split the two apart here.
    const wait = code?.match(/^(.+):(\d+)$/);
    this.code = wait ? wait[1] : code;
    this.retryAfterSeconds = wait ? Number(wait[2]) : undefined;
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
  /**
   * Returns the language the screen is in, as a code such as "TE". Sent with every
   * request so what the server words itself matches what the person is reading.
   */
  getLanguage?: () => string | null | undefined;
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
    const language = options.getLanguage?.();
    if (language) headers["X-App-Language"] = language;

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
    /** The logged-in person's own profile. Their name and language are changed with `auth.updateProfile`. */
    profile: {
      get: () => call<ProfileDto>("GET", "/profile"),
      /** Sets or replaces the profile photo. */
      setPhoto(file: UploadFile) {
        const form = new FormData();
        form.append("file", file, "photo.jpg");
        // The content type is left unset so the boundary is filled in automatically.
        return send<ProfileDto>("POST", "/profile/photo", form, undefined, true);
      },
      removePhoto: () => call<ProfileDto>("DELETE", "/profile/photo"),
    },
    /** The SOP library: ECCS's standard SOPs and each outlet's own. */
    sops: {
      /** With an outlet: what its staff see. Without: ECCS's standard SOPs, for the console. */
      list: (outletId?: string) => call<SopDto[]>("GET", `/sops${query(outletId ? { outletId } : {})}`),
      get: (sopId: string) => call<SopDto>("GET", `/sops/${id(sopId)}`),
      create: (input: CreateSopInput) => call<SopDto>("POST", "/sops", input),
      /** The title and steps are saved for one language at a time. */
      update: (sopId: string, input: UpdateSopInput) => call<SopDto>("PATCH", `/sops/${id(sopId)}`, input),
      remove: (sopId: string) => call<void>("DELETE", `/sops/${id(sopId)}`),
      /** Ready-made SOPs to search, browse and copy into an outlet's own. */
      library: {
        overview: (outletId: string) => call<SopLibraryOverviewDto>("GET", `/sops/library/overview${query({ outletId })}`),
        /** Give a search, a category, a section, or a mix; with none of them the answer is empty. */
        search: (outletId: string, filter: { search?: string; category?: string; section?: string }) =>
          call<SopLibraryItemDto[]>(
            "GET",
            `/sops/library${query({
              outletId,
              ...(filter.search && { q: filter.search }),
              ...(filter.category && { category: filter.category }),
              ...(filter.section && { section: filter.section }),
            })}`,
          ),
        get: (outletId: string, itemId: string) =>
          call<SopLibraryItemDto>("GET", `/sops/library/${id(itemId)}${query({ outletId })}`),
        /** Copies it into the outlet's own SOPs and returns the copy. */
        add: (outletId: string, itemId: string) => call<SopDto>("POST", `/sops/library/${id(itemId)}/add`, { outletId }),
      },
    },
    /** What ECCS offers, and who can be sent. */
    services: {
      /** One-time services a restaurant can book, with prices. */
      catalog: () => call<ServiceCatalogItemDto[]>("GET", "/services/catalog"),
      types: () => call<ServiceTypeDto[]>("GET", "/services/types"),
      /** ECCS admins only: the Supervisors a visit can be given to. */
      supervisors: () => call<SupervisorDto[]>("GET", "/services/supervisors"),
    },
    /** Plans: bundles of services repeated at set intervals, whose visits are put in the diary automatically. */
    plans: {
      list: () => call<PlanDto[]>("GET", "/plans"),
      /** The plan an outlet is on, with the next date of each of its services. */
      forOutlet: (outletId: string) => call<OutletPlanDto>("GET", `/outlets/${id(outletId)}/plan`),
      /** ECCS puts an outlet on a plan; any earlier plan is stopped first. */
      set: (outletId: string, input: SetOutletPlanInput) =>
        call<OutletPlanDto>("PUT", `/outlets/${id(outletId)}/plan`, input),
      /** ECCS takes an outlet off its plan; plan visits not yet started are cancelled. */
      stop: (outletId: string) => call<OutletPlanDto>("DELETE", `/outlets/${id(outletId)}/plan`),
      /** Adds any plan visits that have fallen due to the diary now. */
      fillDiary: () => call<{ created: number }>("POST", "/visits/from-plans"),
    },
    /** A restaurant's requests for one-time services. */
    bookings: {
      /** Requests waiting for ECCS come first. `requestedOnly` keeps only those. */
      list: (filter: { outletId?: string; requestedOnly?: boolean } = {}) =>
        call<BookingDto[]>(
          "GET",
          `/bookings${query({ ...(filter.outletId && { outletId: filter.outletId }), ...(filter.requestedOnly && { status: "requested" }) })}`,
        ),
      create: (input: CreateBookingInput) => call<BookingDto>("POST", "/bookings", input),
      /** ECCS accepts a request and puts the visit in the diary. */
      confirm: (bookingId: string, input: ConfirmBookingInput) =>
        call<BookingDto>("POST", `/bookings/${id(bookingId)}/confirm`, input),
      cancel: (bookingId: string) => call<BookingDto>("POST", `/bookings/${id(bookingId)}/cancel`),
    },
    /** Service visits: the diary, the record made on site, the sign-off and the report. */
    visits: {
      /** "open": to come, under way or waiting for sign-off. "closed": signed off or cancelled. */
      list: (filter: { outletId?: string; state?: "open" | "closed" } = {}) =>
        call<VisitSummaryDto[]>(
          "GET",
          `/visits${query({ ...(filter.outletId && { outletId: filter.outletId }), state: filter.state ?? "open" })}`,
        ),
      get: (visitId: string) => call<VisitDto>("GET", `/visits/${id(visitId)}`),
      create: (input: CreateVisitInput) => call<VisitDto>("POST", "/visits", input),
      update: (visitId: string, input: UpdateVisitInput) => call<VisitDto>("PATCH", `/visits/${id(visitId)}`, input),
      cancel: (visitId: string) => call<VisitDto>("POST", `/visits/${id(visitId)}/cancel`),
      /** The Supervisor arrives at the outlet. */
      checkIn: (visitId: string) => call<VisitDto>("POST", `/visits/${id(visitId)}/check-in`, {}),
      answerTask: (visitId: string, itemId: string, input: AnswerVisitTaskInput) =>
        call<VisitDto>("PUT", `/visits/${id(visitId)}/tasks/${id(itemId)}`, input),
      updateRecord: (visitId: string, input: UpdateVisitRecordInput) =>
        call<VisitDto>("PATCH", `/visits/${id(visitId)}/record`, input),
      addPhoto(visitId: string, kind: VisitPhotoKind, file: UploadFile) {
        const form = new FormData();
        form.append("kind", kind);
        form.append("file", file, "photo.jpg");
        // The content type is left unset so the boundary is filled in automatically.
        return send<VisitDto>("POST", `/visits/${id(visitId)}/photos`, form, undefined, true);
      },
      removePhoto: (visitId: string, photoId: string) =>
        call<VisitDto>("DELETE", `/visits/${id(visitId)}/photos/${id(photoId)}`),
      /** The Supervisor finishes; the visit then waits for the restaurant's sign-off. */
      complete: (visitId: string) => call<VisitDto>("POST", `/visits/${id(visitId)}/complete`),
      /**
       * A link to the signed-off visit's report as a PDF (relative to the API base URL, valid
       * for a limited time). May take a few seconds the first time, while the PDF is made.
       */
      reportPdf: (visitId: string) => call<{ path: string }>("POST", `/visits/${id(visitId)}/report-pdf`),
      /** ECCS has checked the report and releases it to the restaurant. */
      approveReport: (visitId: string) => call<VisitDto>("POST", `/visits/${id(visitId)}/approve-report`),
      /** ECCS gives the visit back to the Supervisor, saying what to correct in the report. */
      returnReport: (visitId: string, input: ReturnReportInput) =>
        call<VisitDto>("POST", `/visits/${id(visitId)}/return-report`, input),
      /** The restaurant's Owner or Manager confirms the work was done and rates it out of five. */
      signOff: (visitId: string, input: SignOffVisitInput) =>
        call<VisitDto>("POST", `/visits/${id(visitId)}/sign-off`, input),
    },
    // notifications-api: the notifications worker adds `notifications: { ... },` on the next line
    /** The person's own notifications: the list behind the bell. */
    notifications: {
      /** Newest first, a page at a time. `before` is the `nextCursor` of the page before. */
      list: (page: { before?: string; limit?: number } = {}) =>
        call<NotificationPageDto>(
          "GET",
          `/notifications${query({ ...(page.before && { before: page.before }), ...(page.limit && { limit: page.limit }) })}`,
        ),
      /** The number for the badge on the bell. */
      unreadCount: () => call<UnreadCountDto>("GET", "/notifications/unread-count"),
      markRead: (notificationId: string) => call<UnreadCountDto>("POST", `/notifications/${id(notificationId)}/read`),
      markAllRead: () => call<UnreadCountDto>("POST", "/notifications/read-all"),
    },
    // inspections-api: the inspections worker adds `inspections: { ... },` on the next line
    /** Scored inspections: ECCS's audit of an outlet, its scored report and the approval. */
    inspections: {
      /** Newest first. A restaurant gets only the approved reports of its outlets. */
      list: (filter: { outletId?: string } = {}) =>
        call<InspectionSummaryDto[]>("GET", `/inspections${query(filter.outletId ? { outletId: filter.outletId } : {})}`),
      /** The outlets the person may start an inspection for. */
      outlets: () => call<InspectionOutletDto[]>("GET", "/inspections/outlets"),
      get: (inspectionId: string) => call<InspectionDto>("GET", `/inspections/${id(inspectionId)}`),
      start: (input: StartInspectionInput) => call<InspectionDto>("POST", "/inspections", input),
      /** ECCS moves or reassigns an inspection nobody has started. */
      update: (inspectionId: string, input: UpdateInspectionInput) =>
        call<InspectionDto>("PATCH", `/inspections/${id(inspectionId)}`, input),
      /** ECCS removes an inspection nobody has started. */
      remove: (inspectionId: string) => call<void>("DELETE", `/inspections/${id(inspectionId)}`),
      /** Saves one answer and returns just that check and the progress counts. */
      answer: (inspectionId: string, itemId: string, input: AnswerInspectionCheckInput) =>
        call<InspectionAnswerResultDto>("PUT", `/inspections/${id(inspectionId)}/checks/${id(itemId)}`, input),
      /** Adds a photo to a check answered "not compliant". */
      addPhoto(inspectionId: string, itemId: string, file: UploadFile) {
        const form = new FormData();
        form.append("file", file, "photo.jpg");
        // The content type is left unset so the boundary is filled in automatically.
        return send<InspectionAnswerResultDto>(
          "POST",
          `/inspections/${id(inspectionId)}/checks/${id(itemId)}/photos`,
          form,
          undefined,
          true,
        );
      },
      removePhoto: (inspectionId: string, photoId: string) =>
        call<InspectionAnswerResultDto>("DELETE", `/inspections/${id(inspectionId)}/photos/${id(photoId)}`),
      /** The Supervisor finishes: the scores are worked out and the report waits for ECCS. */
      finish: (inspectionId: string) => call<InspectionDto>("POST", `/inspections/${id(inspectionId)}/finish`),
      /** ECCS approves the report; the restaurant can read it from then on. */
      approve: (inspectionId: string) => call<InspectionDto>("POST", `/inspections/${id(inspectionId)}/approve`),
      /** ECCS gives it back to the Supervisor, saying what to correct. */
      sendBack: (inspectionId: string, input: ReturnInspectionInput) =>
        call<InspectionDto>("POST", `/inspections/${id(inspectionId)}/send-back`, input),
    },
    /** One month ("2026-10") of an outlet's history calendar. */
    calendar: {
      month: (outletId: string, month: string) => call<CalendarMonthDto>("GET", `/calendar${query({ outletId, month })}`),
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
