import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  acceptDocumentSchema,
  acceptHandbookSchema,
  acceptLetterSchema,
  documentDateSchema,
  handbookSchema,
  JOINING_DOCUMENT_KINDS,
  joiningDetailsSchema,
  letterSettingsSchema,
  moveSchema,
  ONBOARDING_RULES,
  personTaskSchema,
  sendBackSchema,
  templateDocumentsSchema,
  templateRoleSchema,
  templateTaskSchema,
  tickSchema,
  type JoiningDetails,
  type JoiningDetailsValues,
  type JoiningPageDto,
  type LetterSettings,
  type OnboardingTemplatesDto,
  type PersonOnboardingDto,
  type StaffHandbookDto,
  type TeamRole,
  type TemplateTaskValues,
} from '@eccs/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Activity } from '../activity-log/activity.decorator.js';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { OnboardingPapersService } from './onboarding-papers.service.js';
import { OnboardingService } from './onboarding.service.js';

// Onboarding a new team member (16 Oct 2026). Three kinds of route:
// - a person's onboarding on their Team page (/onboarding/people/:userId): the checklist needs
//   "team" R (the Super Admin and the Ops Manager, who ticks only the Ops Manager's tasks, as
//   the service checks); starting it, adding or removing tasks, the joining file, the
//   documents and the letter need "team" A (the Super Admin only);
// - the new hire's own joining page (/onboarding/me): only a login, as it is only ever their
//   own (the service finds it from the login, never from an id sent);
// - the files (/onboarding/documents/:id/file, /onboarding/letters/:id/pdf): the Super Admin
//   or the person themselves, checked in the service; everyone else is refused;
// - the templates, the letter's terms and the handbook: "team" A.
//
// Activity log: every change is staff data, recorded as its action and who did it, never the
// person, their details, ID digits, PAN, bank, pay, dates or a document's contents. Opening a
// joining document, the letter or the whole file is recorded the same way.

const upload = FileInterceptor('file', { limits: { fileSize: ONBOARDING_RULES.maxFileBytes, files: 1 } });
const kindSchema = z.object({ kind: z.enum(JOINING_DOCUMENT_KINDS, 'Choose which document this is') });
type Upload = { buffer: Buffer; size: number } | undefined;

@Controller('onboarding')
export class OnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly papers: OnboardingPapersService,
  ) {}

  // ───────────────────────── The new hire's own page ─────────────────────────

  /** "Joining ECCS": the person's own onboarding, or `{ page: null }` when they have none. */
  @Get('me')
  mine(@CurrentUser() user: AuthUser): Promise<{ page: JoiningPageDto | null }> {
    return this.onboarding.mine(user);
  }

  @Put('me/details')
  @Activity('team.onboarding.detailsSaved', { staffData: true })
  async saveMyDetails(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(joiningDetailsSchema)) body: JoiningDetailsValues): Promise<{ page: JoiningPageDto | null }> {
    const memberId = await this.onboarding.ownMemberId(user);
    await this.papers.saveDetails(user, memberId, body);
    await this.onboarding.sync([memberId]);
    return this.onboarding.mine(user);
  }

  @Post('me/documents')
  @UseInterceptors(upload)
  @Activity('team.onboarding.documentAdded', { staffData: true })
  async uploadMine(@CurrentUser() user: AuthUser, @UploadedFile() file: Upload, @Body() body: unknown): Promise<{ page: JoiningPageDto | null }> {
    const memberId = await this.onboarding.ownMemberId(user);
    await this.papers.upload(user, memberId, await this.asked(memberId), this.kind(body), file, true);
    return this.onboarding.mine(user);
  }

  @Post('me/letter/accept')
  @HttpCode(200)
  @Activity('team.onboarding.letterAccepted', { staffData: true })
  async acceptLetter(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(acceptLetterSchema)) body: z.output<typeof acceptLetterSchema>, @Req() request: Request): Promise<{ page: JoiningPageDto | null }> {
    const memberId = await this.onboarding.ownMemberId(user);
    const letter = await this.papers.letter(body.letterId);
    if (letter.memberId !== memberId) throw new BadRequestException('That is not your letter');
    await this.papers.acceptLetter(user, body.letterId, { kind: 'CLICK', version: body.version, ip: request.ip ?? null });
    await this.onboarding.sync([memberId]);
    return this.onboarding.mine(user);
  }

  @Post('me/handbook/accept')
  @HttpCode(200)
  @Activity('team.onboarding.handbookAccepted', { staffData: true })
  async acceptHandbook(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(acceptHandbookSchema)) body: z.output<typeof acceptHandbookSchema>): Promise<{ page: JoiningPageDto | null }> {
    const memberId = await this.onboarding.ownMemberId(user);
    await this.papers.acceptHandbook(user, memberId, body.version);
    await this.onboarding.sync([memberId]);
    return this.onboarding.mine(user);
  }

  @Post('me/tasks/:taskId/tick')
  @HttpCode(200)
  @Activity('team.onboarding.taskTicked', { staffData: true })
  async tickMine(@CurrentUser() user: AuthUser, @Param('taskId') taskId: string, @Body(new ZodValidationPipe(tickSchema)) body: z.output<typeof tickSchema>): Promise<{ page: JoiningPageDto | null }> {
    await this.onboarding.tickMine(user, taskId, body);
    return this.onboarding.mine(user);
  }

  // ───────────────────────── The files: the Super Admin and the person only ─────────────────────────

  @Get('documents/:documentId/file')
  @Activity('team.onboarding.documentOpened', { staffData: true, reads: 'always' })
  async documentFile(@CurrentUser() user: AuthUser, @Param('documentId') documentId: string, @Res() response: Response): Promise<void> {
    const file = await this.papers.openDocument(user, documentId);
    send(response, file.body, file.mimeType, file.name);
  }

  @Get('letters/:letterId/pdf')
  @Activity('team.onboarding.letterOpened', { staffData: true, reads: 'always' })
  async letterPdf(@CurrentUser() user: AuthUser, @Param('letterId') letterId: string, @Res() response: Response): Promise<void> {
    const file = await this.papers.letterPdf(user, letterId);
    send(response, file.body, 'application/pdf', file.name);
  }

  // ───────────────────────── Templates, the letter's terms, the handbook (the Super Admin) ─────────────────────────

  @Get('templates')
  @RequirePermission('team', 'approve')
  templates(): Promise<OnboardingTemplatesDto> {
    return this.onboarding.templates();
  }

  @Post('templates/:role/tasks')
  @RequirePermission('team', 'approve')
  @Activity('team.onboarding.templateTaskAdded', { staffData: true })
  async addTemplateTask(@Param('role') role: string, @Body(new ZodValidationPipe(templateTaskSchema)) body: TemplateTaskValues): Promise<OnboardingTemplatesDto> {
    await this.onboarding.addTemplateTask(roleOf(role), body);
    return this.onboarding.templates();
  }

  @Put('templates/tasks/:taskId')
  @RequirePermission('team', 'approve')
  @Activity('team.onboarding.templateTaskChanged', { staffData: true })
  async changeTemplateTask(@Param('taskId') taskId: string, @Body(new ZodValidationPipe(templateTaskSchema)) body: TemplateTaskValues): Promise<OnboardingTemplatesDto> {
    await this.onboarding.changeTemplateTask(taskId, body);
    return this.onboarding.templates();
  }

  @Delete('templates/tasks/:taskId')
  @RequirePermission('team', 'approve')
  @Activity('team.onboarding.templateTaskRemoved', { staffData: true })
  async removeTemplateTask(@Param('taskId') taskId: string): Promise<OnboardingTemplatesDto> {
    await this.onboarding.removeTemplateTask(taskId);
    return this.onboarding.templates();
  }

  @Post('templates/tasks/:taskId/move')
  @HttpCode(200)
  @RequirePermission('team', 'approve')
  @Activity('team.onboarding.templateTaskMoved', { staffData: true })
  async moveTemplateTask(@Param('taskId') taskId: string, @Body(new ZodValidationPipe(moveSchema)) body: z.output<typeof moveSchema>): Promise<OnboardingTemplatesDto> {
    await this.onboarding.moveTemplateTask(taskId, body.direction);
    return this.onboarding.templates();
  }

  @Put('templates/:role/documents')
  @RequirePermission('team', 'approve')
  @Activity('team.onboarding.templateDocumentsChanged', { staffData: true })
  async setTemplateDocuments(@Param('role') role: string, @Body(new ZodValidationPipe(templateDocumentsSchema)) body: z.output<typeof templateDocumentsSchema>): Promise<OnboardingTemplatesDto> {
    await this.onboarding.setTemplateDocuments(roleOf(role), body.documents);
    return this.onboarding.templates();
  }

  @Put('letter-settings')
  @RequirePermission('team', 'approve')
  @Activity('team.onboarding.letterSettingsChanged', { staffData: true })
  saveLetterSettings(@Body(new ZodValidationPipe(letterSettingsSchema)) body: LetterSettings): Promise<LetterSettings> {
    return this.papers.saveLetterSettings(body);
  }

  @Get('handbook')
  @RequirePermission('team', 'approve')
  handbook(): Promise<StaffHandbookDto | null> {
    return this.papers.handbook();
  }

  @Post('handbook')
  @RequirePermission('team', 'approve')
  @Activity('team.onboarding.handbookPublished', { staffData: true })
  publishHandbook(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(handbookSchema)) body: z.output<typeof handbookSchema>): Promise<StaffHandbookDto> {
    return this.papers.publishHandbook(user, body);
  }

  // ───────────────────────── A person's onboarding on their Team page ─────────────────────────

  /** The checklist (the Super Admin and the Ops Manager) and the papers (the Super Admin only). */
  @Get('people/:userId')
  @RequirePermission('team', 'read')
  person(@CurrentUser() user: AuthUser, @Param('userId') userId: string): Promise<PersonOnboardingDto> {
    return this.onboarding.person(user, userId);
  }

  @Post('people/:userId/start')
  @RequirePermission('team', 'approve')
  @Activity('team.onboarding.started', { staffData: true })
  async start(@CurrentUser() user: AuthUser, @Param('userId') userId: string): Promise<PersonOnboardingDto> {
    await this.onboarding.start(user, userId);
    return this.onboarding.person(user, userId);
  }

  @Post('people/:userId/tasks/:taskId/tick')
  @HttpCode(200)
  @RequirePermission('team', 'read')
  @Activity('team.onboarding.taskTicked', { staffData: true })
  async tick(@CurrentUser() user: AuthUser, @Param('userId') userId: string, @Param('taskId') taskId: string, @Body(new ZodValidationPipe(tickSchema)) body: z.output<typeof tickSchema>): Promise<PersonOnboardingDto> {
    await this.onboarding.tick(user, userId, taskId, body);
    return this.onboarding.person(user, userId);
  }

  @Post('people/:userId/tasks')
  @RequirePermission('team', 'approve')
  @Activity('team.onboarding.taskAdded', { staffData: true })
  async addTask(@CurrentUser() user: AuthUser, @Param('userId') userId: string, @Body(new ZodValidationPipe(personTaskSchema)) body: z.output<typeof personTaskSchema>): Promise<PersonOnboardingDto> {
    await this.onboarding.addTask(user, userId, body);
    return this.onboarding.person(user, userId);
  }

  @Delete('people/:userId/tasks/:taskId')
  @RequirePermission('team', 'approve')
  @Activity('team.onboarding.taskRemoved', { staffData: true })
  async removeTask(@CurrentUser() user: AuthUser, @Param('userId') userId: string, @Param('taskId') taskId: string): Promise<PersonOnboardingDto> {
    await this.onboarding.removeTask(userId, taskId);
    return this.onboarding.person(user, userId);
  }

  /** The whole joining file, the account number and PAN included, for the Super Admin's edit form. */
  @Get('people/:userId/details')
  @RequirePermission('team', 'approve')
  @Activity('team.onboarding.detailsOpened', { staffData: true, reads: 'always' })
  async details(@Param('userId') userId: string): Promise<JoiningDetails> {
    const member = await this.papers.member({ userId });
    return this.papers.fullFile(member.id);
  }

  @Put('people/:userId/details')
  @RequirePermission('team', 'approve')
  @Activity('team.onboarding.detailsSaved', { staffData: true })
  async saveDetails(@CurrentUser() user: AuthUser, @Param('userId') userId: string, @Body(new ZodValidationPipe(joiningDetailsSchema)) body: JoiningDetailsValues): Promise<PersonOnboardingDto> {
    const member = await this.papers.member({ userId });
    await this.papers.saveDetails(user, member.id, body);
    await this.onboarding.sync([member.id]);
    return this.onboarding.person(user, userId);
  }

  /** The Super Admin uploads a document on the person's behalf. */
  @Post('people/:userId/documents')
  @UseInterceptors(upload)
  @RequirePermission('team', 'approve')
  @Activity('team.onboarding.documentAdded', { staffData: true })
  async uploadFor(@CurrentUser() user: AuthUser, @Param('userId') userId: string, @UploadedFile() file: Upload, @Body() body: unknown): Promise<PersonOnboardingDto> {
    const member = await this.papers.member({ userId });
    await this.papers.upload(user, member.id, await this.asked(member.id), this.kind(body), file, false);
    return this.onboarding.person(user, userId);
  }

  @Post('documents/:documentId/accept')
  @HttpCode(200)
  @RequirePermission('team', 'approve')
  @Activity('team.onboarding.documentAccepted', { staffData: true })
  async acceptDocument(
    @CurrentUser() user: AuthUser,
    @Param('documentId') documentId: string,
    @Body(new ZodValidationPipe(acceptDocumentSchema)) body: z.output<typeof acceptDocumentSchema>,
  ): Promise<PersonOnboardingDto> {
    const memberId = await this.papers.accept(user, documentId, body.expiresOn);
    return this.personOf(user, memberId);
  }

  /** The day a document on file runs out or must be renewed, changed or cleared (20 Oct 2026). */
  @Put('documents/:documentId/date')
  @RequirePermission('team', 'approve')
  @Activity('team.onboarding.documentDated', { staffData: true })
  async setDocumentDate(@CurrentUser() user: AuthUser, @Param('documentId') documentId: string, @Body(new ZodValidationPipe(documentDateSchema)) body: z.output<typeof documentDateSchema>): Promise<PersonOnboardingDto> {
    const memberId = await this.papers.setDate(documentId, body.expiresOn);
    return this.personOf(user, memberId);
  }

  @Post('documents/:documentId/send-back')
  @HttpCode(200)
  @RequirePermission('team', 'approve')
  @Activity('team.onboarding.documentSentBack', { staffData: true })
  async sendBack(@CurrentUser() user: AuthUser, @Param('documentId') documentId: string, @Body(new ZodValidationPipe(sendBackSchema)) body: z.output<typeof sendBackSchema>): Promise<PersonOnboardingDto> {
    const memberId = await this.papers.sendBack(user, documentId, body.reason);
    return this.personOf(user, memberId);
  }

  /** Makes the appointment letter, or brings a waiting one up to date, or (after one is accepted) makes a new one. */
  @Post('people/:userId/letter')
  @HttpCode(200)
  @RequirePermission('team', 'approve')
  @Activity('team.onboarding.letterMade', { staffData: true })
  async makeLetter(@CurrentUser() user: AuthUser, @Param('userId') userId: string): Promise<PersonOnboardingDto> {
    const member = await this.papers.member({ userId });
    await this.papers.makeLetter(user, member.id);
    return this.onboarding.person(user, userId);
  }

  /** "Signed on paper": the signed scan filed and the acceptance recorded. */
  @Post('letters/:letterId/paper')
  @HttpCode(200)
  @UseInterceptors(upload)
  @RequirePermission('team', 'approve')
  @Activity('team.onboarding.letterSignedOnPaper', { staffData: true })
  async signedOnPaper(@CurrentUser() user: AuthUser, @Param('letterId') letterId: string, @UploadedFile() file: Upload): Promise<PersonOnboardingDto> {
    const memberId = await this.papers.signedOnPaper(user, letterId, file);
    return this.personOf(user, memberId);
  }

  // ───────────────────────── Helpers ─────────────────────────

  private kind(body: unknown) {
    const parsed = kindSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Choose which document this is');
    return parsed.data.kind;
  }

  private async asked(memberId: string) {
    return this.papers.askedFor(memberId);
  }

  private async personOf(user: AuthUser, memberId: string): Promise<PersonOnboardingDto> {
    await this.onboarding.sync([memberId]);
    const member = await this.papers.member({ id: memberId });
    return this.onboarding.person(user, member.userId);
  }
}

const roleOf = (role: string): TeamRole => {
  const parsed = templateRoleSchema.safeParse(role);
  if (!parsed.success) throw new BadRequestException('Choose Ops Manager, Supervisor or BDE');
  return parsed.data;
};

/** Streams a joining file: shown in the browser, never cached anywhere, never sniffed as another type. */
function send(response: Response, body: NodeJS.ReadableStream, mimeType: string, name: string) {
  response.setHeader('Content-Type', mimeType);
  response.setHeader('Content-Disposition', `inline; filename="${name.replace(/[^\w .-]/g, '')}"`);
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  body.pipe(response);
}
