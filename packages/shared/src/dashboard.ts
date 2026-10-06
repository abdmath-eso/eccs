import type { ChecklistRunStatus, LocalizedText } from "./checklists.js";
import type { LicenceState, LicenceType } from "./licences.js";

// The restaurant's home screen: how today is going at each outlet, built
// from what is already recorded (checklists, licences, issues with ECCS).

/** One of today's checklists, without its items. */
export interface DashboardChecklistDto {
  /** The run's id, for opening the checklist. */
  id: string;
  title: LocalizedText;
  /** "HH:mm" local time by which it should be done, if set. */
  dueTime: string | null;
  status: ChecklistRunStatus;
  /** True when the due time has passed today and it has not been submitted. */
  isOverdue: boolean;
  itemCount: number;
  doneCount: number;
  problemCount: number;
  /** True once the Manager or Owner has marked it as reviewed. */
  reviewed: boolean;
}

/** A licence that is expired or expiring soon. */
export interface DashboardLicenceDto {
  id: string;
  type: LicenceType;
  name: string | null;
  expiresOn: string;
  /** Negative once expired. */
  daysLeft: number;
  state: LicenceState;
}

/** Today at one outlet. */
export interface OutletDashboardDto {
  outletId: string;
  outletName: string;
  /** Today's calendar date in India, YYYY-MM-DD. */
  date: string;
  /** Today's checklists in the order they fall due. */
  checklists: DashboardChecklistDto[];
  /**
   * Licences expired or expiring soon, soonest first. Null for someone who
   * has no access to licences (the Head Chef).
   */
  licences: DashboardLicenceDto[] | null;
  /** Issues raised with ECCS that are not yet resolved. Null for the Head Chef, who sees only checklists here. */
  issues: { open: number; inProgress: number } | null;
}
