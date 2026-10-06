import { z } from "zod";

// ECCS support: issues a restaurant raises for ECCS to act on, such as a pest
// sighting or a smoking chimney. This is separate from problems noted on a
// daily checklist, which stay inside the restaurant and are never sent to ECCS.

export const ISSUE_CATEGORIES = ["PEST_SIGHTING", "CHIMNEY", "EQUIPMENT", "HYGIENE", "SUPPORT", "OTHER"] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

export const ISSUE_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

/** Statuses that still need attention. */
export const isIssueOpen = (status: IssueStatus) => status === "OPEN" || status === "IN_PROGRESS";

export const createIssueSchema = z.object({
  outletId: z.string().min(1),
  category: z.enum(ISSUE_CATEGORIES),
  description: z.string().trim().min(5, "Describe the issue").max(1000),
  /** Photos already uploaded for this outlet. Optional. */
  attachmentIds: z.array(z.string().min(1)).max(4).default([]),
});
export type CreateIssueInput = z.input<typeof createIssueSchema>;

export const addIssueCommentSchema = z.object({
  body: z.string().trim().min(1, "Write a message").max(1000),
});
export type AddIssueCommentInput = z.input<typeof addIssueCommentSchema>;

export const updateIssueSchema = z.object({ status: z.enum(ISSUE_STATUSES) });
export type UpdateIssueInput = z.input<typeof updateIssueSchema>;

export interface IssueCommentDto {
  id: string;
  authorName: string;
  /** True if the message is from ECCS staff, false if from the restaurant. */
  fromEccs: boolean;
  body: string;
  createdAt: string;
}

/** One issue as shown in lists. */
export interface IssueSummaryDto {
  id: string;
  /** Short reference to quote on a call, e.g. "ECCS-0042". */
  reference: string;
  outletId: string;
  outletName: string;
  organizationName: string;
  category: IssueCategory;
  status: IssueStatus;
  description: string;
  raisedByName: string;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
  photoCount: number;
}

/** One issue with its photos and the conversation. */
export interface IssueDto extends IssueSummaryDto {
  /** Photo paths relative to the API base URL. Valid for a limited time. */
  photoPaths: string[];
  comments: IssueCommentDto[];
  resolvedAt: string | null;
}

/** How to reach ECCS directly. */
export interface SupportContactDto {
  /** Phone number in international form, e.g. "+919000000000". */
  phone: string;
  /** WhatsApp number in international form without "+", for wa.me links. */
  whatsapp: string;
  hours: string;
}
