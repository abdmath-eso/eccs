import type {
  AddChecklistItemInput,
  AnswerChecklistItemInput,
  AnswerVisitTaskInput,
  AttachmentDto,
  OutletLocationInput,
  PhotoPlace,
  PhotoSource,
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
import type { NotificationNewsDto, NotificationPageDto, UnreadCountDto } from "@eccs/shared";
// push-types: the push worker imports its types from "@eccs/shared" on the next line
import type {
  PushDeviceDto,
  PushRecipientsDto,
  PushTestResultDto,
  RegisterPushDeviceInput,
  SendTestPushInput,
} from "@eccs/shared";
// staff-types: the staff worker imports its types from "@eccs/shared" on the next line
import type {
  AddPayEntryInput,
  AttendanceDayDto,
  AttendanceMonthDto,
  CreateStaffMemberInput,
  MarkAttendanceInput,
  SalaryMonthDto,
  SalaryOutletMonthDto,
  SaveSalaryInput,
  StaffMemberDto,
  StaffMonthDto,
  UpdateStaffMemberInput,
} from "@eccs/shared";
// Attendance by face: clocking in and out, the Owner's corrections, and face enrolment.
import type {
  AddPunchInput,
  AttendanceReviewDto,
  AttendanceSettingsDto,
  AttendanceSettingsInput,
  ClockAssistedInput,
  ClockConfirmInput,
  ClockIdentifyDto,
  ClockPunchResultDto,
  ClockRosterDto,
  CorrectDayInput,
  FaceConsentInput,
  FaceStatusDto,
  PunchDto,
  StaffPunchesDto,
} from "@eccs/shared";
// food-labels-types: the labels worker imports its types from "@eccs/shared" on the next line
import type {
  CreateFoodItemInput,
  CreateFoodLabelInput,
  FoodItemDto,
  FoodItemRemovalDto,
  FoodLabelDto,
  LabelImageDto,
  RenderLabelInput,
  UpdateFoodItemInput,
} from "@eccs/shared";
// public-page-types: the public-page worker imports its types from "@eccs/shared" on the next line
import type {
  PublicCheckPhotosDto,
  PublicPageSettingsDto,
  PublicPhotoCaption,
  PublicPhotoDto,
  PublicPhotoStatus,
} from "@eccs/shared";
// subscriptions-types: the subscriptions worker imports its types from "@eccs/shared" on the next line
import type {
  CancelSubscriptionInput,
  CreatePlanInput,
  OutletSubscriptionDto,
  PlanOfferDto,
  PlansAdminDto,
  StartSubscriptionInput,
  UpdatePlanInput,
} from "@eccs/shared";
// billing-types: the billing worker imports its types from "@eccs/shared" on the next line
import type {
  BillingTotalsDto,
  ConfirmPaymentInput,
  DuesDto,
  InvoiceDto,
  InvoiceStatus,
  InvoiceSummaryDto,
  PaymentResultDto,
  PaymentSessionDto,
  RecordPaymentInput,
  StartPaymentInput,
  VoidInvoiceInput,
} from "@eccs/shared";
// certificates-types: the certificates worker imports its types from "@eccs/shared" on the next line
import type { CertificateDto } from "@eccs/shared";
// vendors-types: the vendor directory (13 Oct 2026)
import type { VendorDirectoryDto, VendorDto } from "@eccs/shared";
// legal-types: terms and privacy acceptance (14 Oct 2026)
import type { AcceptLegalInput, LegalDocumentDto, LegalDocumentKey, LegalStatusDto } from "@eccs/shared";
import { LEGAL_ERROR } from "@eccs/shared";
// offline-visits-types: the offline worker imports any new types from "@eccs/shared" on the next line
// scores-types: the hygiene score worker imports its types from "@eccs/shared" on the next line
import type { HygieneScoreDto } from "@eccs/shared";
// monitoring-types: the monitoring worker imports its types from "@eccs/shared" on the next line
import type { MonitoringBoardDto } from "@eccs/shared";
// catalog-types: the console-editing worker imports its types from "@eccs/shared" on the next line
// new-services-types: result documents on a visit, and adding a kind of service
import type { AddVisitDocumentInput, CreateServiceKindInput } from "@eccs/shared";
import type {
  AddServiceTaskInput,
  CatalogAdminDto,
  CatalogItemChangeDto,
  CreateCatalogItemInput,
  LinkedPhoneDto,
  MoveServiceTaskInput,
  UpdateCatalogItemInput,
  UpdateOrganizationInput,
  UpdateOutletInput,
  UpdateOwnerInput,
  UpdateServiceKindInput,
  UpdateServiceTaskInput,
} from "@eccs/shared";
// ai-types: the AI features (14 Oct 2026)
import type { AiOutcome, AiStatusDto, AiUsageDto, ScoreExplanationDto } from "@eccs/shared";
// ai-usage-types: the console's AI usage page and the AI settings (19 Oct 2026)
import type { AiAlertsDto, AiOverviewDto, AiRequestPageDto, AiSettingsDto, AiSettingsPatch, AiUsageQueryInput } from "@eccs/shared";
import type {
  InspectionSummaryDraftDto,
  MonitoringDigestDto,
  PhotoCheckDto,
  SaveInspectionSummaryInput,
} from "@eccs/shared";
// activity-log-types: the console's Logs page (15 Oct 2026)
import type {
  ActivityLogEventDto,
  ActivityLogFacetsDto,
  ActivityLogPageDto,
  ActivityLogQueryInput,
  ActivityLogSummaryDto,
} from "@eccs/shared";
// finance-types: the console's Finance page (15 Oct 2026)
import type {
  BudgetDto,
  BudgetInput,
  CashDayDetailDto,
  CashOpeningDto,
  ExpenseDto,
  ExpenseInput,
  ExpenseListDto,
  ExportRegister,
  FinanceOverviewDto,
  FinanceSettingsDto,
  FinanceSettingsInput,
  FinanceVisitOptionDto,
  FounderMoneyDto,
  FounderMoneyInput,
  MarkPaidInput,
  OpeningBalanceInput,
} from "@eccs/shared";
// sales-types: the console's Sales page and the CRM (15 Oct 2026)
import type {
  BdeDayDto,
  SalesPhotoDto,
  ShopBoardReadingDto,
  ShopBoardReadInput,
  DoTodayItemDto,
  LeadDetailDto,
  LeadInput,
  LeadListDto,
  LeadListState,
  LeadSource,
  LeadStage,
  LeadUpdateInput,
  LinkClientInput,
  LoseInput,
  ParkInput,
  QuoteDto,
  QuoteInput,
  QuoteOptionDto,
  QuoteSentDto,
  SalesOverviewDto,
  StepInput,
  TargetFigures,
  TargetFloorsInput,
  TargetInput,
} from "@eccs/shared";
// team-types: the console's Team page (16 Oct 2026)
import type { LeaveInput, MarkLeftInput, TeamChangeInput, TeamListDto, TeamMemberDto, TeamMemberInput, TeamSettingsInput } from "@eccs/shared";
// onboarding-types: onboarding a new team member (16 Oct 2026)
import type {
  AcceptLetterInput,
  JoiningDetails,
  JoiningDetailsInput,
  JoiningDocumentKind,
  JoiningPageDto,
  LetterSettings,
  LetterSettingsInput,
  OnboardingTemplatesDto,
  PersonOnboardingDto,
  PersonTaskInput,
  StaffHandbookDto,
  HandbookInput,
  DocumentAsked,
  TeamRole,
  TemplateTaskInput,
  TickInput,
} from "@eccs/shared";
// buddy-types: ECCS Buddy, the helper in the restaurant app (16 Oct 2026)
import type {
  BuddyCardDto,
  BuddyCardResultDto,
  BuddyChatDto,
  BuddyChatSummaryDto,
  BuddyFeedbackInput,
  BuddyMessageInput,
  BuddyReplyDto,
  BuddyScreen,
  BuddyStartDto,
  BuddyStatsDto,
} from "@eccs/shared";
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
  /**
   * Everything else the server sent with the error, as it came. Some answers carry
   * more than a reason: which photo to take again (`photo`), or who a face is
   * already enrolled as (`staff`). Absent when the server sent nothing readable.
   */
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    message: string,
    readonly status: number,
    code?: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "ApiError";
    // The server writes a wait after the reason, e.g. "PIN_LOCKED:540"; split the two apart here.
    const wait = code?.match(/^(.+):(\d+)$/);
    this.code = wait ? wait[1] : code;
    this.retryAfterSeconds = wait ? Number(wait[2]) : undefined;
    this.details = details;
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
  /**
   * Which app this is and its version, sent with every request (X-ECCS-Client and
   * X-ECCS-App-Version) so the server's activity log can tell the phone app from the
   * console. Never anything about the person.
   */
  client?: { name: "mobile" | "console"; version?: string | null };
  /** Called when the server says the session is no longer valid. */
  onUnauthorized?: () => void;
  /**
   * Called when the server refuses a request because the person has not agreed to the
   * current Terms of Service and Privacy Policy (403, TERMS_NOT_ACCEPTED). The app
   * opens its acceptance screen. The call still fails with that ApiError.
   */
  onTermsNotAccepted?: () => void;
}

/**
 * A photo to upload. In a browser this is a Blob; in the mobile app it is an
 * Expo `File` (from expo-file-system), which behaves like one.
 */
export type UploadFile = Blob;

/**
 * What the phone knows about a proof photo besides the picture: where the phone was
 * (only if the person allowed it) and whether the app's camera took it. All optional.
 */
export interface PhotoFactsInput {
  place?: PhotoPlace | null;
  source?: PhotoSource;
}

/** Adds those facts to an upload form. The server ignores anything missing. */
function appendPhotoFacts(form: FormData, facts: PhotoFactsInput | undefined) {
  if (facts?.source) form.append("source", facts.source);
  if (!facts?.place) return;
  form.append("latitude", String(facts.place.latitude));
  form.append("longitude", String(facts.place.longitude));
  if (facts.place.accuracy !== null) form.append("accuracy", String(facts.place.accuracy));
  if (facts.place.mocked !== null) form.append("mocked", String(facts.place.mocked));
}

/**
 * The filters of the console's Logs page as the API takes them (see the activity-log
 * reading API). A list may hold several values; empty values are left out.
 */
export type ActivityLogFilters = Omit<ActivityLogQueryInput, "cursor" | "limit">;

/** A CSV export of the activity log, ready to save. */
export interface ActivityLogExport {
  blob: Blob;
  fileName: string;
  /** Rows in the file, when the server says so (a browser on another address may not be allowed to read it). */
  rows: number | null;
  /** True when the file stopped at the most one export may hold; null when the server's answer could not be read. */
  truncated: boolean | null;
}

/** The AI usage page's filters as the API takes them (see aiUsageQuerySchema). */
export type AiUsageFilters = Omit<AiUsageQueryInput, "cursor" | "limit">;

/** The filters as query parameters: lists joined with commas, true flags as "1", empty values left out. */
function activityLogParams(filters: (ActivityLogFilters | AiUsageFilters) & { cursor?: string; limit?: number }): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(filters) as [string, unknown][]) {
    if (Array.isArray(value)) {
      if (value.length > 0) params[key] = value.join(",");
    } else if (typeof value === "number" || (typeof value === "string" && value !== "")) params[key] = value;
  }
  return params;
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** The one way web and mobile talk to the API. */
export function createApiClient(options: ApiClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");

  /** The headers every request carries: the session, the language on screen, and which app this is. */
  function commonHeaders(authenticated: boolean) {
    const headers: Record<string, string> = {};
    const token = authenticated ? options.getToken?.() : null;
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const language = options.getLanguage?.();
    if (language) headers["X-App-Language"] = language;
    if (options.client) {
      headers["X-ECCS-Client"] = options.client.name;
      if (options.client.version) headers["X-ECCS-App-Version"] = options.client.version;
    }
    return { headers, token };
  }

  async function send<T>(
    method: string,
    path: string,
    body: BodyInit | undefined,
    contentType: string | undefined,
    authenticated: boolean,
    /** Lets the caller give up on a request that is held open (see `notifications.wait`). */
    signal?: AbortSignal,
  ): Promise<T> {
    const common = commonHeaders(authenticated);
    const headers: Record<string, string> = { Accept: "application/json", ...common.headers };
    if (contentType) headers["Content-Type"] = contentType;
    const token = common.token;

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, { method, headers, ...(body !== undefined && { body }), ...(signal && { signal }) });
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
      if (response.status === 403 && code === LEGAL_ERROR.notAccepted) options.onTermsNotAccepted?.();
      const body = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : undefined;
      throw new ApiError(message, response.status, code, body);
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

  /**
   * Fetches a file the server makes (a CSV export) rather than JSON: the same
   * headers and the same errors as every other call, with the file as a Blob.
   */
  async function download(path: string): Promise<{ blob: Blob; headers: Headers }> {
    const { headers, token } = commonHeaders(true);
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, { method: "GET", headers });
    } catch {
      throw new ApiError("Could not reach the server. Check your connection.", 0);
    }
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { message?: unknown; code?: unknown } | null;
      if (response.status === 401 && token) options.onUnauthorized?.();
      const message = typeof data?.message === "string" ? data.message : "Something went wrong. Try again.";
      throw new ApiError(message, response.status, typeof data?.code === "string" ? data.code : undefined);
    }
    return { blob: await response.blob(), headers: response.headers };
  }

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
        /** For a proof photo: where the phone was and how the picture was made. */
        facts?: PhotoFactsInput;
      }) {
        const form = new FormData();
        form.append("outletId", input.outletId);
        if (input.kind) form.append("kind", input.kind);
        if (input.id) form.append("id", input.id);
        if (input.capturedAt) form.append("capturedAt", input.capturedAt);
        appendPhotoFacts(form, input.facts);
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
      /** Translates the thread into the reader's language (AI). Call once when `translationPending` is set. */
      translate: (issueId: string) => call<IssueDto>("POST", `/issues/${id(issueId)}/translate`),
    },
    /** The AI features: which are on, what the person did with an answer, and what AI has cost (ECCS). */
    ai: {
      status: () => call<AiStatusDto>("GET", "/ai/status"),
      outcome: (requestId: string, outcome: AiOutcome) =>
        call<void>("POST", `/ai/requests/${id(requestId)}/outcome`, { outcome }),
      usage: () => call<AiUsageDto>("GET", "/ai/usage"),
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
      /**
       * The nudge at the camera (AI): is this small copy of a proof photo usable as proof
       * for the check, and does it clearly show the check not done (with a reason in the
       * language on screen)? Fails with code AI_OFF, AI_LIMIT or AI_FAILED when AI steps aside.
       * `signal` lets the phone give up after a few seconds.
       */
      checkPhoto(runId: string, itemId: string, file: UploadFile, signal?: AbortSignal) {
        const form = new FormData();
        form.append("file", file, "photo.jpg");
        return send<PhotoCheckDto>(
          "POST",
          `/checklists/runs/${id(runId)}/items/${id(itemId)}/photo-check`,
          form,
          undefined,
          true,
          signal,
        );
      },
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
      /**
       * `at` is when the Supervisor checked in on the phone (it may be sent later, when the signal
       * is back). Sending the same check-in twice with the same `at` is harmless.
       */
      checkIn: (visitId: string, input: { at?: string } = {}) =>
        call<VisitDto>("POST", `/visits/${id(visitId)}/check-in`, input),
      answerTask: (visitId: string, itemId: string, input: AnswerVisitTaskInput) =>
        call<VisitDto>("PUT", `/visits/${id(visitId)}/tasks/${id(itemId)}`, input),
      updateRecord: (visitId: string, input: UpdateVisitRecordInput) =>
        call<VisitDto>("PATCH", `/visits/${id(visitId)}/record`, input),
      /** Pass an `id` generated on the phone so that sending the same photo twice stores it once. */
      addPhoto(
        visitId: string,
        kind: VisitPhotoKind,
        file: UploadFile,
        phone: { id?: string; capturedAt?: string; facts?: PhotoFactsInput } = {},
      ) {
        const form = new FormData();
        form.append("kind", kind);
        if (phone.id) form.append("id", phone.id);
        if (phone.capturedAt) form.append("capturedAt", phone.capturedAt);
        appendPhotoFacts(form, phone.facts);
        form.append("file", file, "photo.jpg");
        // The content type is left unset so the boundary is filled in automatically.
        return send<VisitDto>("POST", `/visits/${id(visitId)}/photos`, form, undefined, true);
      },
      removePhoto: (visitId: string, photoId: string) =>
        call<VisitDto>("DELETE", `/visits/${id(visitId)}/photos/${id(photoId)}`),
      /** Saves where the kitchen is, read by the phone during a visit there. Only when ECCS has not set it yet. */
      setOutletLocation: (visitId: string, input: OutletLocationInput) =>
        call<VisitDto>("POST", `/visits/${id(visitId)}/outlet-location`, input),
      /**
       * Attaches a result document (a lab report, an attendance sheet…) to the visit: a PDF or a
       * picture. It is also filed in the outlet's documents. `fileName` only helps the upload along.
       */
      addDocument(visitId: string, input: AddVisitDocumentInput, file: UploadFile, fileName = "document") {
        const form = new FormData();
        form.append("title", input.title);
        if (input.partnerName) form.append("partnerName", input.partnerName);
        form.append("file", file, fileName);
        return send<VisitDto>("POST", `/visits/${id(visitId)}/documents`, form, undefined, true);
      },
      /** ECCS's office takes a wrongly attached document off the visit and out of the outlet's documents. */
      removeDocument: (visitId: string, documentId: string) =>
        call<VisitDto>("DELETE", `/visits/${id(visitId)}/documents/${id(documentId)}`),
      /** The Supervisor finishes; the visit then waits for the restaurant's sign-off. */
      /** `at` is when Finish was pressed on the phone; the same Finish sent twice is harmless. */
      complete: (visitId: string, input?: { at?: string }) =>
        call<VisitDto>("POST", `/visits/${id(visitId)}/complete`, input),
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
      /**
       * "Anything new?" The server holds the request open (up to about 25 seconds) until the
       * person's newest notification is no longer `latest`, or something of theirs is marked
       * read, and then answers with the newest few. Ask again as soon as it answers.
       */
      wait: (latest: string | null, signal?: AbortSignal) =>
        send<NotificationNewsDto>("GET", `/notifications/wait${query(latest ? { latest } : {})}`, undefined, undefined, true, signal),
    },
    // push-api: the push worker adds `push: { ... },` on the next line
    /** Push notifications: which phone is whose, and the console's test push. */
    push: {
      /** After login: send this person's notifications to this phone. */
      register: (input: RegisterPushDeviceInput) => call<PushDeviceDto>("POST", "/push/devices", input),
      /** Before Lock or logout: stop sending them to this phone. */
      unregister: (token: string) => call<PushDeviceDto>("POST", "/push/devices/unregister", { token }),
      /** ECCS admins: everyone with a phone registered. */
      recipients: () => call<PushRecipientsDto>("GET", "/push/recipients"),
      /** ECCS admins: send a test push, to themselves unless a person is named. */
      sendTest: (input: SendTestPushInput = {}) => call<PushTestResultDto>("POST", "/push/test", input),
    },
    // staff-api: the staff worker adds its calls on the next line
    /** The restaurant's own staff: the people, their attendance and the salary tracker. Not for ECCS roles. */
    team: {
      /** Everyone on the outlet's staff; with `left`, people who have left as well. Pay is hidden from the Head Chef. */
      people: (outletId: string, left = false) =>
        call<StaffMemberDto[]>("GET", `/staff/people${query({ outletId, ...(left && { left: 1 }) })}`),
      addPerson: (input: CreateStaffMemberInput) => call<StaffMemberDto>("POST", "/staff/people", input),
      /** Also how a person is marked as having left (`leftOn`) or brought back (`leftOn: null`). */
      updatePerson: (staffId: string, input: UpdateStaffMemberInput) =>
        call<StaffMemberDto>("PATCH", `/staff/people/${id(staffId)}`, input),
      /** Only for someone with no records at all; otherwise the server refuses (409). */
      removePerson: (staffId: string) => call<void>("DELETE", `/staff/people/${id(staffId)}`),
      /** One day's attendance sheet; today when no date is given. */
      day: (outletId: string, date?: string) =>
        call<AttendanceDayDto>("GET", `/staff/attendance/day${query({ outletId, ...(date && { date }) })}`),
      /**
       * The Owner's correction of a day for several people at once; `reason` (at least five
       * characters) is required. A null status takes the Owner's entry away. Since face
       * attendance the Manager and the Head Chef are refused (403).
       */
      mark: (input: MarkAttendanceInput) => call<AttendanceDayDto>("PUT", "/staff/attendance/day", input),
      /** Each person's totals for a month ("2026-10"). */
      month: (outletId: string, month: string) =>
        call<AttendanceMonthDto>("GET", `/staff/attendance/month${query({ outletId, month })}`),
      /** One person's month, day by day. */
      personMonth: (staffId: string, month: string) =>
        call<StaffMonthDto>("GET", `/staff/people/${id(staffId)}/attendance${query({ month })}`),
      /** The outlet's pay for a month, a row per person. */
      salaryMonth: (outletId: string, month: string) =>
        call<SalaryOutletMonthDto>("GET", `/staff/salary${query({ outletId, month })}`),
      personSalary: (staffId: string, month: string) =>
        call<SalaryMonthDto>("GET", `/staff/people/${id(staffId)}/salary${query({ month })}`),
      /** Overtime, bonus, deductions, the Owner's own figures and a note for a person's month. */
      saveSalary: (staffId: string, month: string, input: SaveSalaryInput) =>
        call<SalaryMonthDto>("PUT", `/staff/people/${id(staffId)}/salary/${id(month)}`, input),
      /** An advance given, or a payment of the month's pay. */
      addPayEntry: (staffId: string, input: AddPayEntryInput) =>
        call<SalaryMonthDto>("POST", `/staff/people/${id(staffId)}/pay-entries`, input),
      removePayEntry: (entryId: string) => call<SalaryMonthDto>("DELETE", `/staff/pay-entries/${id(entryId)}`),
      /** Whether a person's face is enrolled, and on which consent. For the Owner and the Manager. */
      faceStatus: (staffId: string) => call<FaceStatusDto>("GET", `/staff/${id(staffId)}/face`),
      /**
       * Enrols a person's face from 3 to 5 photos taken now, with the employee's own consent.
       * Owner only. The photos are not kept. Errors carry a `code` (NO_FACE, FACES_DIFFER,
       * FACE_ALREADY_ENROLLED, CONSENT_REQUIRED, FACE_ENGINE_UNAVAILABLE...).
       */
      faceEnrol(staffId: string, input: { photos: UploadFile[]; consent: FaceConsentInput }) {
        const form = new FormData();
        form.append("consent", JSON.stringify(input.consent));
        input.photos.forEach((photo, index) => form.append("photos", photo, `face-${index + 1}.jpg`));
        return send<FaceStatusDto>("POST", `/staff/${id(staffId)}/face`, form, undefined, true);
      },
      /** The employee withdraws consent: every template is deleted. Owner only. */
      faceWithdraw: (staffId: string) => call<FaceStatusDto>("DELETE", `/staff/${id(staffId)}/face`),
    },
    /**
     * Attendance by face. The `clock` calls are made from the PIN screen of a phone linked
     * to an outlet, with nobody logged in: they carry the phone's device token, not a session.
     * The rest need a login: reading for the Owner and the Manager, correcting for the Owner.
     */
    attendance: {
      clock: {
        /**
         * Who is in this photo? Marks nothing; answers a ticket to hand to `confirm`.
         * `secondPhoto`, taken after "turn your head a little", is the liveness check.
         */
        identify(input: { deviceToken: string; photo: UploadFile; secondPhoto?: UploadFile }) {
          const form = new FormData();
          form.append("deviceToken", input.deviceToken);
          form.append("photo", input.photo, "face.jpg");
          if (input.secondPhoto) form.append("photo2", input.secondPhoto, "face-turned.jpg");
          return send<ClockIdentifyDto>("POST", "/attendance/clock/identify", form, undefined, false);
        },
        /** "Yes, that's me": records the clock-in or clock-out. */
        confirm: (input: ClockConfirmInput) => call<ClockPunchResultDto>("POST", "/attendance/clock/confirm", input, false),
        /** The Owner or a Manager vouches with their PIN, for someone the camera cannot recognise. */
        assisted(input: ClockAssistedInput & { photo?: UploadFile }) {
          const form = new FormData();
          form.append("deviceToken", input.deviceToken);
          form.append("approverPin", input.approverPin);
          form.append("staffId", input.staffId);
          if (input.photo) form.append("photo", input.photo, "person.jpg");
          return send<ClockPunchResultDto>("POST", "/attendance/clock/assisted", form, undefined, false);
        },
        /** The outlet's staff by name, for the assisted route's picker, and whether faces can be recognised just now. */
        roster: (deviceToken: string) =>
          send<ClockRosterDto>("GET", `/attendance/clock/roster${query({ deviceToken })}`, undefined, undefined, false),
      },
      /** One person's punches for a month ("2026-10"; this month when left out), day by day. */
      punches: (staffId: string, month?: string) =>
        call<StaffPunchesDto>("GET", `/attendance/punches${query({ staffId, ...(month && { month }) })}`),
      /** What is waiting for the Owner: marked punches and days whose status is a stand-in. */
      review: (outletId: string) => call<AttendanceReviewDto>("GET", `/attendance/review${query({ outletId })}`),
      settings: (outletId: string) => call<AttendanceSettingsDto>("GET", `/attendance/settings/${id(outletId)}`),
      /** Owner only: what counts as a full day and a half day. */
      saveSettings: (outletId: string, input: AttendanceSettingsInput) =>
        call<AttendanceSettingsDto>("PUT", `/attendance/settings/${id(outletId)}`, input),
      /** Owner only: sets one person's status for a day, with a reason; a null status takes the Owner's entry away. */
      correctDay: (input: CorrectDayInput) => call<void>("PUT", "/attendance/day", input),
      /** Owner only: adds a punch the camera never recorded, with a reason. */
      addPunch: (input: AddPunchInput) => call<PunchDto>("POST", "/attendance/punches", input),
      /** Owner only: strikes a wrong punch out, with a reason. */
      voidPunch: (punchId: string, reason: string) =>
        call<PunchDto>("POST", `/attendance/punches/${id(punchId)}/void`, { reason }),
      /** Owner only: a marked punch has been looked at and stands. */
      reviewPunch: (punchId: string) => call<PunchDto>("POST", `/attendance/punches/${id(punchId)}/review`),
    },
    // food-labels-api: the labels worker adds its calls on the next line
    /** Food items, the labels made for them, and what is in the fridge now. */
    foodLabels: {
      /** The outlet's items, most recently used first. `all` includes retired ones. */
      items: (outletId: string, options: { all?: boolean } = {}) =>
        call<FoodItemDto[]>("GET", `/food-labels/items${query({ outletId, ...(options.all && { all: "1" }) })}`),
      createItem: (input: CreateFoodItemInput) => call<FoodItemDto>("POST", "/food-labels/items", input),
      /** Changes an item; `isActive: false` retires it and `true` brings it back. */
      updateItem: (itemId: string, input: UpdateFoodItemInput) =>
        call<FoodItemDto>("PATCH", `/food-labels/items/${id(itemId)}`, input),
      /** Deletes an item with no labels; one with labels is retired instead. */
      removeItem: (itemId: string) => call<FoodItemRemovalDto>("DELETE", `/food-labels/items/${id(itemId)}`),
      /** Records one printing of a saved label: how many stickers, and the moment Print was pressed. */
      create: (input: CreateFoodLabelInput) => call<FoodLabelDto>("POST", "/food-labels/labels", input),
      markPrinted: (labelId: string) => call<FoodLabelDto>("POST", `/food-labels/labels/${id(labelId)}/printed`),
      /** Asks the server to draw a label as a PNG picture, for a label printer's own app. */
      render: (input: RenderLabelInput) => call<LabelImageDto>("POST", "/food-labels/render", input),
    },
    // public-page-api: the public-page worker adds its calls on the next line
    /** The customer QR page: the restaurant's switch, ECCS's take-down, and the photos shown on it. */
    publicPage: {
      /** One outlet's page: whether it is on, its link, what a diner sees, its photos. */
      get: (outletId: string) => call<PublicPageSettingsDto>("GET", `/public-page/outlets/${id(outletId)}`),
      /** The restaurant's own switch. The Owner only. */
      setEnabled: (outletId: string, enabled: boolean) =>
        call<PublicPageSettingsDto>("PATCH", `/public-page/outlets/${id(outletId)}`, { enabled }),
      /** Replaces the link: every QR code printed before stops working. The Owner only. */
      newLink: (outletId: string) => call<PublicPageSettingsDto>("POST", `/public-page/outlets/${id(outletId)}/new-link`),
      /** ECCS admins take a page down, whatever the restaurant's switch says. */
      takeDown: (outletId: string, reason: string) =>
        call<PublicPageSettingsDto>("POST", `/public-page/outlets/${id(outletId)}/take-down`, { reason }),
      restore: (outletId: string) => call<PublicPageSettingsDto>("POST", `/public-page/outlets/${id(outletId)}/restore`),
      /**
       * Photos, by who asks: ECCS admins get the approval queue (waiting ones unless a
       * status is given), a Supervisor their own proposals, the restaurant its page's photos.
       */
      photos: (filter: { status?: PublicPhotoStatus; outletId?: string } = {}) =>
        call<PublicPhotoDto[]>(
          "GET",
          `/public-page/photos${query({ ...(filter.status && { status: filter.status }), ...(filter.outletId && { outletId: filter.outletId }) })}`,
        ),
      /** ECCS admins: how many photos wait for a decision. */
      photosWaiting: () => call<{ waiting: number }>("GET", "/public-page/photos/waiting"),
      /** A Supervisor proposes a photo of one of their own finished visits or inspections. */
      propose: (attachmentId: string, caption: PublicPhotoCaption) =>
        call<PublicPhotoDto>("POST", "/public-page/photos", { attachmentId, caption }),
      /** A Supervisor takes a photo specially for the page. */
      proposeNew(outletId: string, caption: PublicPhotoCaption, file: UploadFile, phone: { capturedAt?: string; facts?: PhotoFactsInput } = {}) {
        const form = new FormData();
        form.append("caption", caption);
        if (phone.capturedAt) form.append("capturedAt", phone.capturedAt);
        appendPhotoFacts(form, phone.facts);
        form.append("file", file, "photo.jpg");
        return send<PublicPhotoDto>("POST", `/public-page/outlets/${id(outletId)}/photos`, form, undefined, true);
      },
      /** The restaurant: its own daily-check photos that can be put forward for the page, and what became of those already put forward. */
      checkPhotos: (outletId: string) => call<PublicCheckPhotosDto>("GET", `/public-page/outlets/${id(outletId)}/check-photos`),
      /** The restaurant puts one of its own daily-check photos forward. ECCS looks at it before it appears. */
      proposeFromCheck: (outletId: string, attachmentId: string, caption: PublicPhotoCaption) =>
        call<PublicPhotoDto>("POST", `/public-page/outlets/${id(outletId)}/check-photos`, { attachmentId, caption }),
      approvePhoto: (photoId: string) => call<PublicPhotoDto>("POST", `/public-page/photos/${id(photoId)}/approve`),
      rejectPhoto: (photoId: string, reason: string) =>
        call<PublicPhotoDto>("POST", `/public-page/photos/${id(photoId)}/reject`, { reason }),
      /** The Owner (or ECCS) takes an approved photo off the page. */
      removePhoto: (photoId: string) => call<void>("DELETE", `/public-page/photos/${id(photoId)}`),
    },
    // subscriptions-api: the subscriptions worker adds its calls on the next line
    /** Plans as ECCS configures them: what is on offer, and (for the office) every plan with who is on it. */
    subscriptionPlans: {
      /** The plans a restaurant can choose, with what each includes and its price with GST. */
      offered: () => call<PlanOfferDto[]>("GET", "/subscription-plans"),
      /** ECCS admins only: every plan, offered or not, and the kinds of service a plan can include. */
      all: () => call<PlansAdminDto>("GET", "/subscription-plans/all"),
      create: (input: CreatePlanInput) => call<PlansAdminDto>("POST", "/subscription-plans", input),
      /** Changes a plan, or stops or resumes offering it. Outlets already on it are affected only from their next cycle. */
      update: (planId: string, input: UpdatePlanInput) => call<PlansAdminDto>("PATCH", `/subscription-plans/${id(planId)}`, input),
    },
    /** An outlet's subscription to a plan. Every call answers with the subscription as it now stands. */
    subscriptions: {
      forOutlet: (outletId: string) => call<OutletSubscriptionDto>("GET", `/outlets/${id(outletId)}/subscription`),
      /** The Owner sends only the plan; ECCS may also choose the start date and the day of the first visits. */
      start: (outletId: string, input: StartSubscriptionInput) =>
        call<OutletSubscriptionDto>("POST", `/outlets/${id(outletId)}/subscription`, input),
      /** The new plan takes over when the next cycle starts. */
      changePlan: (outletId: string, planCode: string) =>
        call<OutletSubscriptionDto>("POST", `/outlets/${id(outletId)}/subscription/change-plan`, { planCode }),
      undoChangePlan: (outletId: string) =>
        call<OutletSubscriptionDto>("POST", `/outlets/${id(outletId)}/subscription/undo-change-plan`),
      /** ECCS only. */
      pause: (outletId: string) => call<OutletSubscriptionDto>("POST", `/outlets/${id(outletId)}/subscription/pause`),
      /** ECCS only. */
      resume: (outletId: string) => call<OutletSubscriptionDto>("POST", `/outlets/${id(outletId)}/subscription/resume`),
      /** "PERIOD_END" for the Owner or ECCS; "NOW" for ECCS only. */
      cancel: (outletId: string, when: CancelSubscriptionInput["when"]) =>
        call<OutletSubscriptionDto>("POST", `/outlets/${id(outletId)}/subscription/cancel`, { when }),
      /** Undoes a cancellation that has not taken effect yet. */
      keep: (outletId: string) => call<OutletSubscriptionDto>("POST", `/outlets/${id(outletId)}/subscription/keep`),
    },
    // billing-api: the billing worker adds its calls on the next line
    /** GST invoices, what is due, and payments. Owner and Manager read; the Owner pays; ECCS admins do everything. */
    billing: {
      /** Newest first. Narrowed by outlet, by client (`organizationId`) and by status. */
      invoices: (filter: { outletId?: string; organizationId?: string; status?: InvoiceStatus } = {}) =>
        call<InvoiceSummaryDto[]>(
          "GET",
          `/invoices${query({
            ...(filter.outletId && { outletId: filter.outletId }),
            ...(filter.organizationId && { organizationId: filter.organizationId }),
            ...(filter.status && { status: filter.status }),
          })}`,
        ),
      invoice: (invoiceId: string) => call<InvoiceDto>("GET", `/invoices/${id(invoiceId)}`),
      /** What is owed and how overdue the oldest unpaid invoice is: in all, by client and by outlet. */
      dues: (filter: { outletId?: string } = {}) =>
        call<DuesDto>("GET", `/invoices/dues${query(filter.outletId ? { outletId: filter.outletId } : {})}`),
      /** ECCS admins: due, overdue and collected this month. */
      totals: () => call<BillingTotalsDto>("GET", "/invoices/totals"),
      /**
       * A link to the invoice as a PDF (relative to the API base URL, valid for a limited
       * time). May take a few seconds while the PDF is made, or made again after a payment.
       */
      pdf: (invoiceId: string) => call<{ path: string }>("POST", `/invoices/${id(invoiceId)}/pdf`),
      /** The Owner starts paying everything still owed on an invoice. Nothing is paid until `confirmPayment`. */
      startPayment: (invoiceId: string, input: StartPaymentInput) =>
        call<PaymentSessionDto>("POST", `/invoices/${id(invoiceId)}/payments`, input),
      /**
       * The payment screen reports how the payment ended. For the sample gateway:
       * `{ outcome: "success" }` or `{ outcome: "fail" }`. Safe to send twice.
       */
      confirmPayment: (paymentId: string, proof: ConfirmPaymentInput) =>
        call<PaymentResultDto>("POST", `/payments/${id(paymentId)}/confirm`, proof),
      /** One payment and its invoice as it stands now: the receipt. */
      receipt: (paymentId: string) => call<PaymentResultDto>("GET", `/payments/${id(paymentId)}`),
      /** ECCS admins record a payment received outside the app. */
      recordPayment: (invoiceId: string, input: RecordPaymentInput) =>
        call<PaymentResultDto>("POST", `/invoices/${id(invoiceId)}/payments/manual`, input),
      /** ECCS admins cancel an invoice. It stays on record as void. */
      void: (invoiceId: string, input: VoidInvoiceInput) => call<InvoiceDto>("POST", `/invoices/${id(invoiceId)}/void`, input),
      /** ECCS admins raise a new invoice for what a void one was for. */
      raiseAgain: (invoiceId: string) => call<InvoiceDto>("POST", `/invoices/${id(invoiceId)}/raise-again`),
      /** ECCS admins raise, now, the invoice of every plan whose cycle has begun and has none. */
      raiseDue: () => call<{ raised: number }>("POST", "/invoices/raise-due"),
    },
    // certificates-api: the certificates worker adds `certificates: { ... },` on the next line
    /** Service certificates: issued when ECCS approves the report of a visit whose kind of service carries one. */
    certificates: {
      /** Newest first. With an outlet: that outlet's. Without: every one the person may see. */
      list: (filter: { outletId?: string } = {}) =>
        call<CertificateDto[]>("GET", `/certificates${query(filter.outletId ? { outletId: filter.outletId } : {})}`),
      get: (certificateId: string) => call<CertificateDto>("GET", `/certificates/${id(certificateId)}`),
      /**
       * A link to the certificate as a PDF (relative to the API base URL, valid for a
       * limited time). May take a few seconds the first time, while the PDF is made.
       */
      pdf: (certificateId: string) => call<{ path: string }>("POST", `/certificates/${id(certificateId)}/pdf`),
      /** ECCS admins make the PDF again; the new one takes the old one's place. */
      remakePdf: (certificateId: string) =>
        call<{ path: string }>("POST", `/certificates/${id(certificateId)}/pdf/remake`),
    },
    // vendors-api: the vendor directory (13 Oct 2026)
    /** The vendor directory: nearby wholesalers and distributors, for the Owner and the Manager. Reading only. */
    vendors: {
      /**
       * Every vendor on the list as seen from one outlet: the nearest first, or in
       * name order when ECCS has not saved the outlet's place (`outletHasPlace`).
       */
      list: (outletId: string) => call<VendorDirectoryDto>("GET", `/vendors${query({ outletId })}`),
      /** One vendor, with its distance from that outlet. */
      get: (vendorId: string, outletId: string) =>
        call<VendorDto>("GET", `/vendors/${id(vendorId)}${query({ outletId })}`),
    },
    // legal-api: terms and privacy acceptance (14 Oct 2026)
    /**
     * The Terms of Service, the Privacy Policy and the other legal documents, and the
     * person's agreement to them. Until a restaurant user agrees, the server answers most
     * other calls with 403 and the code TERMS_NOT_ACCEPTED (`onTermsNotAccepted`).
     */
    legal: {
      /** Every document, with its version and its words. Needs no login. */
      documents: () => call<LegalDocumentDto[]>("GET", "/legal/documents", undefined, false),
      document: (key: LegalDocumentKey | string) => call<LegalDocumentDto>("GET", `/legal/documents/${id(key)}`, undefined, false),
      /** What the logged-in person must agree to now, and their latest agreement to each document. */
      status: () => call<LegalStatusDto>("GET", "/legal/status"),
      /** Records the agreement to exactly the pending documents. Answers with the new status. */
      accept: (input: AcceptLegalInput) => call<LegalStatusDto>("POST", "/legal/accept", input),
    },
    // scores-api: the hygiene score worker adds `scores: { ... },` on the next line
    /** The hygiene score: one number out of 100 per outlet, with what it is made of. */
    scores: {
      /**
       * An outlet's score now, its band and the change on last week. Everyone but the
       * Head Chef also gets the breakdown and the last 30 days (`detail`).
       */
      get: (outletId: string) => call<HygieneScoreDto>("GET", `/scores/${id(outletId)}`),
      /**
       * "Why this score?" written by AI from the score's own numbers (Owner and Manager).
       * Fails with code AI_OFF, AI_LIMIT or AI_FAILED when AI steps aside.
       */
      explain: (outletId: string) => call<ScoreExplanationDto>("POST", `/scores/${id(outletId)}/explain`),
    },
    // monitoring-api: the monitoring worker adds `monitoring: { ... },` on the next line
    /** The ECCS monitoring board: every outlet the person may see, worst first. ECCS staff only. */
    monitoring: {
      /** `days` is how far back the checklist and rating figures look; 7 when left out. */
      board: (filter: { days?: number } = {}) =>
        call<MonitoringBoardDto>("GET", `/monitoring${query(filter.days ? { days: String(filter.days) } : {})}`),
      /**
       * Today's digest of the board, written by AI (Super Admin and Ops Manager). Made on the
       * first opening of the day and kept. Fails with code AI_OFF, AI_LIMIT or AI_FAILED.
       */
      digest: () => call<MonitoringDigestDto>("GET", "/monitoring/digest"),
      /** "Update": a fresh digest, at most once an hour; sooner, the kept one comes back. */
      updateDigest: () => call<MonitoringDigestDto>("POST", "/monitoring/digest"),
    },
    // catalog-api: the console-editing worker adds its calls on the next line
    /**
     * ECCS admins change a client after onboarding. Nothing is deleted: a client or outlet is
     * switched off (`isActive: false`) and can be switched back on. Each call that changes the
     * client answers with the whole client as it now stands.
     */
    clients: {
      update: (organizationId: string, input: UpdateOrganizationInput) =>
        call<OrganizationDto>("PATCH", `/organizations/${id(organizationId)}`, input),
      updateOutlet: (organizationId: string, outletId: string, input: UpdateOutletInput) =>
        call<OrganizationDto>("PATCH", `/organizations/${id(organizationId)}/outlets/${id(outletId)}`, input),
      /** A new restaurant code for the outlet. Phones already linked stay linked. */
      newOutletCode: (organizationId: string, outletId: string) =>
        call<OrganizationDto>("POST", `/organizations/${id(organizationId)}/outlets/${id(outletId)}/new-code`),
      /** The phones linked to the client: each outlet's, and the Owner's own (no outlet). */
      phones: (organizationId: string) => call<LinkedPhoneDto[]>("GET", `/organizations/${id(organizationId)}/phones`),
      /** Unlinks one phone and answers with those still linked. */
      unlinkPhone: (organizationId: string, phoneId: string) =>
        call<LinkedPhoneDto[]>("DELETE", `/organizations/${id(organizationId)}/phones/${id(phoneId)}`),
      updateOwner: (organizationId: string, userId: string, input: UpdateOwnerInput) =>
        call<OrganizationDto>("PATCH", `/organizations/${id(organizationId)}/owners/${id(userId)}`, input),
      /** Removes the Owner's PIN and logs them out, so their next one-time-code login gives them a new PIN. */
      resetOwnerSetup: (organizationId: string, userId: string) =>
        call<OrganizationDto>("POST", `/organizations/${id(organizationId)}/owners/${id(userId)}/reset-setup`),
    },
    /** ECCS admins manage what is on offer: bookable services, kinds of service and each kind's task list. */
    catalogue: {
      /** Everything, including services no longer offered and retired tasks. */
      get: () => call<CatalogAdminDto>("GET", "/catalog"),
      addItem: (input: CreateCatalogItemInput) => call<CatalogAdminDto>("POST", "/catalog/items", input),
      /** A booked service whose price changes is kept as it was and replaced by a new one; `replacedById` says so. */
      updateItem: (itemId: string, input: UpdateCatalogItemInput) =>
        call<CatalogItemChangeDto>("PATCH", `/catalog/items/${id(itemId)}`, input),
      /** A brand-new kind of service, with its tax code. Its tasks and bookable services are added afterwards. */
      addKind: (input: CreateServiceKindInput) => call<CatalogAdminDto>("POST", "/catalog/kinds", input),
      updateKind: (serviceCode: string, input: UpdateServiceKindInput) =>
        call<CatalogAdminDto>("PATCH", `/catalog/kinds/${id(serviceCode)}`, input),
      addTask: (serviceCode: string, input: AddServiceTaskInput) =>
        call<CatalogAdminDto>("POST", `/catalog/kinds/${id(serviceCode)}/tasks`, input),
      updateTask: (taskId: string, input: UpdateServiceTaskInput) =>
        call<CatalogAdminDto>("PATCH", `/catalog/tasks/${id(taskId)}`, input),
      moveTask: (taskId: string, input: MoveServiceTaskInput) =>
        call<CatalogAdminDto>("POST", `/catalog/tasks/${id(taskId)}/move`, input),
    },
    // activity-log-api: the console's Logs page (15 Oct 2026)
    /**
     * Everything that happens in the restaurant app, the Supervisor's app, the console,
     * the AI and the server. Super Admin and Ops Manager only. Every call takes the same
     * filters, combined with AND.
     */
    activityLog: {
      /** Newest first, 50 at a time; pass `nextCursor` back as `cursor` for the next (older) page. */
      list: (filters: ActivityLogFilters & { cursor?: string; limit?: number } = {}) =>
        call<ActivityLogPageDto>("GET", `/activity-log${query(activityLogParams(filters))}`),
      /** The choices for each filter menu, each counted under all the other filters. */
      facets: (filters: ActivityLogFilters = {}) =>
        call<ActivityLogFacetsDto>("GET", `/activity-log/facets${query(activityLogParams(filters))}`),
      /** Events, failures, people, AI calls and AI cost under the filters. */
      summary: (filters: ActivityLogFilters = {}) =>
        call<ActivityLogSummaryDto>("GET", `/activity-log/summary${query(activityLogParams(filters))}`),
      /** One event in full, with the other rows written for the same request. */
      get: (entryId: string) => call<ActivityLogEventDto>("GET", `/activity-log/${id(entryId)}`),
      /** The filtered rows as a CSV file (newest first, at most 10,000). The export is itself logged. */
      async exportCsv(filters: ActivityLogFilters = {}): Promise<ActivityLogExport> {
        const { blob, headers } = await download(`/activity-log/export${query(activityLogParams(filters))}`);
        const named = headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1];
        const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
        const rows = headers.get("X-Export-Rows");
        const truncated = headers.get("X-Export-Truncated");
        return {
          blob,
          fileName: named ?? `eccs-activity-${day}.csv`,
          rows: rows === null ? null : Number(rows),
          truncated: truncated === null ? null : truncated === "true",
        };
      },
    },
    // ai-usage-api: the console's AI usage page and the AI settings (19 Oct 2026)
    /**
     * What the AI helpers cost, read from the server's request log, with the page's filters;
     * the log itself and its CSV; and the AI settings. The Super Admin and the Ops Manager
     * read; only the Super Admin changes the settings.
     */
    aiUsage: {
      overview: (filters: AiUsageFilters = {}) => call<AiOverviewDto>("GET", `/ai/overview${query(activityLogParams(filters))}`),
      /** Newest first, 50 at a time; pass `nextCursor` back as `cursor` for the next (older) page. */
      requests: (filters: AiUsageFilters & { cursor?: string; limit?: number } = {}) =>
        call<AiRequestPageDto>("GET", `/ai/requests${query(activityLogParams(filters))}`),
      /** The filtered requests as a CSV file (newest first, at most 10,000). The export is itself logged. */
      async exportCsv(filters: AiUsageFilters = {}): Promise<ActivityLogExport> {
        const { blob, headers } = await download(`/ai/requests/export${query(activityLogParams(filters))}`);
        const named = headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1];
        const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
        const rows = headers.get("X-Export-Rows");
        const truncated = headers.get("X-Export-Truncated");
        return {
          blob,
          fileName: named ?? `eccs-ai-requests-${day}.csv`,
          rows: rows === null ? null : Number(rows),
          truncated: truncated === null ? null : truncated === "true",
        };
      },
      /** The warnings true now, for the page's banner and the menu's count. */
      alerts: () => call<AiAlertsDto>("GET", "/ai/alerts"),
      settings: () => call<AiSettingsDto>("GET", "/ai/settings"),
      /** Changes some settings (the Super Admin only); answers with the settings as saved. */
      saveSettings: (change: AiSettingsPatch) => call<AiSettingsDto>("PATCH", "/ai/settings", change),
    },
    // finance-api: the console's Finance page (15 Oct 2026)
    /**
     * ECCS's own books: money in (read from billing), money out, the budget and the
     * founders' money. The Super Admin only; everyone else is refused.
     */
    finance: {
      /** Everything on the page for a period, against a budget (the default one when none is given). */
      overview: (input: { from: string; to: string; budgetId?: string | null }) =>
        call<FinanceOverviewDto>("GET", `/finance/overview${query({ from: input.from, to: input.to, ...(input.budgetId && { budgetId: input.budgetId }) })}`),
      /** One day's cash: opening, in, out, closing. */
      day: (date: string) => call<CashDayDetailDto>("GET", `/finance/day${query({ date })}`),
      /** The expense book, newest first, with its filters. */
      expenses: (filter: { month?: string; category?: string; paid?: "yes" | "no"; visit?: "yes" | "no" } = {}) =>
        call<ExpenseListDto>("GET", `/finance/expenses${query(Object.fromEntries(Object.entries(filter).filter(([, value]) => Boolean(value))) as Record<string, string>)}`),
      /** Visits an expense can be linked to. */
      visits: () => call<FinanceVisitOptionDto[]>("GET", "/finance/visits"),
      /** Pass an `id` made when the form opens, so pressing Save twice adds one entry. */
      addExpense: (input: ExpenseInput) => call<ExpenseDto>("POST", "/finance/expenses", input),
      updateExpense: (expenseId: string, input: ExpenseInput) => call<ExpenseDto>("PATCH", `/finance/expenses/${id(expenseId)}`, input),
      removeExpense: (expenseId: string) => call<void>("DELETE", `/finance/expenses/${id(expenseId)}`),
      /** Unpaid bills paid together. */
      markPaid: (input: MarkPaidInput) => call<{ updated: number }>("POST", "/finance/expenses/mark-paid", input),
      /** Files a receipt (a photo or PDF); put the id it returns in the expense. */
      uploadReceipt(file: UploadFile, fileName = "receipt") {
        const form = new FormData();
        form.append("file", file, fileName);
        return send<{ id: string; path: string; pdf: boolean }>("POST", "/finance/receipts", form, undefined, true);
      },
      addBudget: (input: BudgetInput) => call<BudgetDto>("POST", "/finance/budgets", input),
      updateBudget: (budgetId: string, input: BudgetInput) => call<BudgetDto>("PATCH", `/finance/budgets/${id(budgetId)}`, input),
      removeBudget: (budgetId: string) => call<void>("DELETE", `/finance/budgets/${id(budgetId)}`),
      addFounderMoney: (input: FounderMoneyInput) => call<FounderMoneyDto>("POST", "/finance/founders-money", input),
      removeFounderMoney: (entryId: string) => call<void>("DELETE", `/finance/founders-money/${id(entryId)}`),
      saveOpening: (input: OpeningBalanceInput) => call<CashOpeningDto>("PUT", "/finance/opening-balance", input),
      saveSettings: (input: FinanceSettingsInput) => call<FinanceSettingsDto>("PUT", "/finance/settings", input),
      /** The WhatsApp link with a payment reminder typed in, for an overdue invoice. Nothing is sent by the server. */
      remind: (invoiceId: string) => call<{ url: string; hasPhone: boolean }>("POST", `/finance/invoices/${id(invoiceId)}/remind`),
      /** One of the CA's three files for a period, as CSV. */
      async exportCsv(register: ExportRegister, period: { from: string; to: string }): Promise<{ blob: Blob; fileName: string }> {
        const { blob, headers } = await download(`/finance/export/${id(register)}${query(period)}`);
        const named = headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1];
        return { blob, fileName: named ?? `eccs-${register}-${period.from}-to-${period.to}.csv` };
      },
    },
    // sales-api: the console's Sales page and the CRM (15 Oct 2026)
    /**
     * Leads, the steps logged on them, quotes and the BDEs' targets. A BDE reaches only
     * their own leads. Sending a quote gives back a WhatsApp link; the server sends nothing.
     */
    sales: {
      overview: (owner?: string | null) => call<SalesOverviewDto>("GET", `/sales/overview${query(owner ? { owner } : {})}`),
      doToday: () => call<{ items: DoTodayItemDto[] }>("GET", "/sales/do-today"),
      leads: (filter: { stage?: LeadStage | ""; owner?: string; source?: LeadSource | ""; state?: LeadListState | ""; q?: string } = {}) =>
        call<LeadListDto>("GET", `/sales/leads${query(Object.fromEntries(Object.entries(filter).filter(([, value]) => Boolean(value))) as Record<string, string>)}`),
      lead: (leadId: string) => call<LeadDetailDto>("GET", `/sales/leads/${id(leadId)}`),
      quoteOptions: () => call<QuoteOptionDto[]>("GET", "/sales/quote-options"),
      addLead: (input: LeadInput) => call<LeadDetailDto>("POST", "/sales/leads", input),
      updateLead: (leadId: string, input: LeadUpdateInput) => call<LeadDetailDto>("PATCH", `/sales/leads/${id(leadId)}`, input),
      /** A call, visit, note, free check booked or done, or what the owner asked: the lead moves right by itself. */
      logStep: (leadId: string, input: StepInput) => call<LeadDetailDto>("POST", `/sales/leads/${id(leadId)}/steps`, input),
      park: (leadId: string, input: ParkInput) => call<LeadDetailDto>("POST", `/sales/leads/${id(leadId)}/park`, input),
      lose: (leadId: string, input: LoseInput) => call<LeadDetailDto>("POST", `/sales/leads/${id(leadId)}/lose`, input),
      reopen: (leadId: string) => call<LeadDetailDto>("POST", `/sales/leads/${id(leadId)}/reopen`),
      /** "Became a client" (the Super Admin and the Ops Manager); null undoes a wrong link. */
      linkClient: (leadId: string, input: LinkClientInput) => call<LeadDetailDto>("PUT", `/sales/leads/${id(leadId)}/client`, input),
      addQuote: (leadId: string, input: QuoteInput) => call<QuoteDto>("POST", `/sales/leads/${id(leadId)}/quotes`, input),
      sendQuote: (quoteId: string) => call<QuoteSentDto>("POST", `/sales/quotes/${id(quoteId)}/send`),
      removeQuote: (quoteId: string) => call<void>("DELETE", `/sales/quotes/${id(quoteId)}`),
      setFloors: (input: TargetFloorsInput) => call<TargetFigures>("PUT", "/sales/targets/floors", input),
      setTarget: (userId: string, input: TargetInput) => call<{ saved: boolean }>("PUT", `/sales/targets/${id(userId)}`, input),
      // The BDE's phone (B2, 16 Oct 2026).
      /** The BDE's own Do today and this week against their targets, for Home. */
      myDay: () => call<BdeDayDto>("GET", "/sales/my-day"),
      /**
       * Files a lead's photo (the shop board, or a free check's "Needs fixing") before the
       * lead or step that points at it. Pass an id made on the phone, so sending it again
       * from the outbox files it once.
       */
      uploadPhoto(file: UploadFile, input: { id?: string; capturedAt?: string } = {}) {
        const form = new FormData();
        if (input.id) form.append("id", input.id);
        if (input.capturedAt) form.append("capturedAt", input.capturedAt);
        form.append("file", file, "photo.jpg");
        return send<SalesPhotoDto>("POST", "/sales/photos", form, undefined, true);
      },
      /** Reads a filed shop-board photo into the Log a lead form, with AI. Fails with AI_OFF, AI_LIMIT or AI_FAILED when AI steps aside. */
      readBoard: (input: ShopBoardReadInput) => call<ShopBoardReadingDto>("POST", "/sales/board-reading", input),
    },
    // team-api: the console's Team page (16 Oct 2026)
    /**
     * ECCS's own team: who is in, each person's week, leave and salaries. The Super Admin and
     * the Ops Manager read it; salaries, adding, changing and marking as left are the Super
     * Admin's. People are addressed by their login's id. (Not `team`, which is the
     * restaurant's own staff.)
     */
    eccsTeam: {
      list: () => call<TeamListDto>("GET", "/team"),
      member: (userId: string) => call<TeamMemberDto>("GET", `/team/${id(userId)}`),
      /** Adds a team member with their ECCS login (they log in with this number and a one-time code). */
      add: (input: TeamMemberInput) => call<TeamMemberDto>("POST", "/team", input),
      /** Only what is sent changes; a new salary takes effect from its `from` day. */
      change: (userId: string, input: TeamChangeInput) => call<TeamMemberDto>("PATCH", `/team/${id(userId)}`, input),
      /** Their last day. Fails with code OPEN_LEADS (and `count`) until `handTo` names who takes their open leads. */
      markLeft: (userId: string, input: MarkLeftInput) => call<TeamMemberDto>("POST", `/team/${id(userId)}/mark-left`, input),
      addLeave: (userId: string, input: LeaveInput) => call<TeamMemberDto>("POST", `/team/${id(userId)}/leave`, input),
      removeLeave: (leaveId: string) => call<void>("DELETE", `/team/leave/${id(leaveId)}`),
      saveSettings: (input: TeamSettingsInput) => call<{ onTimeTargetPercent: number }>("PUT", "/team/settings", input),
    },
    // onboarding-api: onboarding a new team member (16 Oct 2026)
    /**
     * A new team member's checklist, joining file, documents, appointment letter and the staff
     * handbook. On a person's Team page: the checklist for the Super Admin and the Ops Manager,
     * the papers for the Super Admin only. `mine` and the `my*` calls are the new hire's own
     * "Joining ECCS" page. The files open only for the Super Admin and the person themselves.
     */
    onboarding: {
      person: (userId: string) => call<PersonOnboardingDto>("GET", `/onboarding/people/${id(userId)}`),
      start: (userId: string) => call<PersonOnboardingDto>("POST", `/onboarding/people/${id(userId)}/start`),
      tick: (userId: string, taskId: string, input: TickInput) => call<PersonOnboardingDto>("POST", `/onboarding/people/${id(userId)}/tasks/${id(taskId)}/tick`, input),
      addTask: (userId: string, input: PersonTaskInput) => call<PersonOnboardingDto>("POST", `/onboarding/people/${id(userId)}/tasks`, input),
      removeTask: (userId: string, taskId: string) => call<PersonOnboardingDto>("DELETE", `/onboarding/people/${id(userId)}/tasks/${id(taskId)}`),
      /** The whole joining file, the account number and PAN included: only for the Super Admin's edit form. */
      fullDetails: (userId: string) => call<JoiningDetails>("GET", `/onboarding/people/${id(userId)}/details`),
      saveDetails: (userId: string, input: JoiningDetailsInput) => call<PersonOnboardingDto>("PUT", `/onboarding/people/${id(userId)}/details`, input),
      uploadFor(userId: string, kind: JoiningDocumentKind, file: UploadFile, fileName = "document") {
        const form = new FormData();
        form.append("kind", kind);
        form.append("file", file, fileName);
        return send<PersonOnboardingDto>("POST", `/onboarding/people/${id(userId)}/documents`, form, undefined, true);
      },
      acceptDocument: (documentId: string) => call<PersonOnboardingDto>("POST", `/onboarding/documents/${id(documentId)}/accept`),
      sendBack: (documentId: string, reason: string) => call<PersonOnboardingDto>("POST", `/onboarding/documents/${id(documentId)}/send-back`, { reason }),
      makeLetter: (userId: string) => call<PersonOnboardingDto>("POST", `/onboarding/people/${id(userId)}/letter`),
      signedOnPaper(letterId: string, file: UploadFile, fileName = "signed-letter") {
        const form = new FormData();
        form.append("file", file, fileName);
        return send<PersonOnboardingDto>("POST", `/onboarding/letters/${id(letterId)}/paper`, form, undefined, true);
      },
      /** A joining document's file, for the Super Admin or the person only. */
      async documentFile(documentId: string): Promise<Blob> {
        return (await download(`/onboarding/documents/${id(documentId)}/file`)).blob;
      },
      /** The appointment letter as a PDF, for the Super Admin or the person only. */
      async letterPdf(letterId: string): Promise<Blob> {
        return (await download(`/onboarding/letters/${id(letterId)}/pdf`)).blob;
      },
      // The new hire's own page.
      mine: () => call<{ page: JoiningPageDto | null }>("GET", "/onboarding/me"),
      saveMyDetails: (input: JoiningDetailsInput) => call<{ page: JoiningPageDto | null }>("PUT", "/onboarding/me/details", input),
      uploadMine(kind: JoiningDocumentKind, file: UploadFile, fileName = "document") {
        const form = new FormData();
        form.append("kind", kind);
        form.append("file", file, fileName);
        return send<{ page: JoiningPageDto | null }>("POST", "/onboarding/me/documents", form, undefined, true);
      },
      acceptMyLetter: (input: AcceptLetterInput) => call<{ page: JoiningPageDto | null }>("POST", "/onboarding/me/letter/accept", input),
      acceptHandbook: (version: number) => call<{ page: JoiningPageDto | null }>("POST", "/onboarding/me/handbook/accept", { version }),
      tickMine: (taskId: string, input: TickInput) => call<{ page: JoiningPageDto | null }>("POST", `/onboarding/me/tasks/${id(taskId)}/tick`, input),
      // Templates, the letter's terms and the handbook (the Super Admin).
      templates: () => call<OnboardingTemplatesDto>("GET", "/onboarding/templates"),
      addTemplateTask: (role: TeamRole, input: TemplateTaskInput) => call<OnboardingTemplatesDto>("POST", `/onboarding/templates/${id(role)}/tasks`, input),
      changeTemplateTask: (taskId: string, input: TemplateTaskInput) => call<OnboardingTemplatesDto>("PUT", `/onboarding/templates/tasks/${id(taskId)}`, input),
      removeTemplateTask: (taskId: string) => call<OnboardingTemplatesDto>("DELETE", `/onboarding/templates/tasks/${id(taskId)}`),
      moveTemplateTask: (taskId: string, direction: "up" | "down") => call<OnboardingTemplatesDto>("POST", `/onboarding/templates/tasks/${id(taskId)}/move`, { direction }),
      setTemplateDocuments: (role: TeamRole, documents: DocumentAsked[]) => call<OnboardingTemplatesDto>("PUT", `/onboarding/templates/${id(role)}/documents`, { documents }),
      saveLetterSettings: (input: LetterSettingsInput) => call<LetterSettings>("PUT", "/onboarding/letter-settings", input),
      handbook: () => call<StaffHandbookDto | null>("GET", "/onboarding/handbook"),
      publishHandbook: (input: HandbookInput) => call<StaffHandbookDto>("POST", "/onboarding/handbook", input),
    },
    // buddy-api: ECCS Buddy, the helper in the restaurant app (16 Oct 2026)
    /**
     * ECCS Buddy, for the restaurant's Owner and Manager only (the server refuses everyone else).
     * A message is answered at once; a change comes back as a confirmation card, carried out only by
     * `confirm`. `stats` is the console's counts per day (the Super Admin and the Ops Manager).
     */
    buddy: {
      start: (screen: BuddyScreen, outletId?: string | null) => call<BuddyStartDto>("GET", `/buddy/start${query({ screen, ...(outletId ? { outletId } : {}) })}`),
      chats: () => call<BuddyChatSummaryDto[]>("GET", "/buddy/chats"),
      chat: (chatId: string) => call<BuddyChatDto>("GET", `/buddy/chats/${id(chatId)}`),
      removeChat: (chatId: string) => call<void>("DELETE", `/buddy/chats/${id(chatId)}`),
      send: (input: BuddyMessageInput) => call<BuddyReplyDto>("POST", "/buddy/messages", input),
      feedback: (messageId: string, input: BuddyFeedbackInput) => call<void>("POST", `/buddy/messages/${id(messageId)}/feedback`, input),
      confirm: (cardId: string) => call<BuddyCardResultDto>("POST", `/buddy/cards/${id(cardId)}/confirm`),
      cancel: (cardId: string) => call<BuddyCardDto>("POST", `/buddy/cards/${id(cardId)}/cancel`),
      stats: () => call<BuddyStatsDto>("GET", "/ai/buddy-stats"),
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
      addPhoto(
        inspectionId: string,
        itemId: string,
        file: UploadFile,
        phone: { id?: string; capturedAt?: string; facts?: PhotoFactsInput } = {},
      ) {
        const form = new FormData();
        // An id generated on the phone, so that sending the same photo twice stores it once.
        if (phone.id) form.append("id", phone.id);
        if (phone.capturedAt) form.append("capturedAt", phone.capturedAt);
        appendPhotoFacts(form, phone.facts);
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
      /** With `itemId` (the check it belonged to), removing a photo that is already gone is not an error. */
      removePhoto: (inspectionId: string, photoId: string, itemId?: string) =>
        call<InspectionAnswerResultDto>(
          "DELETE",
          `/inspections/${id(inspectionId)}/photos/${id(photoId)}${query(itemId ? { itemId } : {})}`,
        ),
      /**
       * The Supervisor finishes: the scores are worked out and the report waits for ECCS.
       * `at` is when Finish was pressed on the phone; the same Finish sent twice is harmless.
       */
      finish: (inspectionId: string, input?: { at?: string }) =>
        call<InspectionDto>("POST", `/inspections/${id(inspectionId)}/finish`, input),
      /** ECCS approves the report; the restaurant can read it from then on. */
      approve: (inspectionId: string) => call<InspectionDto>("POST", `/inspections/${id(inspectionId)}/approve`),
      /** ECCS gives it back to the Supervisor, saying what to correct. */
      sendBack: (inspectionId: string, input: ReturnInspectionInput) =>
        call<InspectionDto>("POST", `/inspections/${id(inspectionId)}/send-back`, input),
      /**
       * A link to the approved report as a PDF (relative to the API base URL, valid for a
       * limited time). May take a few seconds the first time, while the PDF is made.
       */
      reportPdf: (inspectionId: string) => call<{ path: string }>("POST", `/inspections/${id(inspectionId)}/report-pdf`),
      /**
       * An AI draft of the report's summary and "Fix these first", for the Supervisor to
       * check and edit. Nothing is saved. Fails with code AI_OFF, AI_LIMIT or AI_FAILED.
       */
      draftSummary: (inspectionId: string) =>
        call<InspectionSummaryDraftDto>("POST", `/inspections/${id(inspectionId)}/summary/draft`),
      /** Saves the summary for the report (after Finish, before approval). An empty summary removes it. */
      saveSummary: (inspectionId: string, input: SaveInspectionSummaryInput) =>
        call<InspectionDto>("PUT", `/inspections/${id(inspectionId)}/summary`, input),
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
