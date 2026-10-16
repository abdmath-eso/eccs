import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@eccs/db';
import {
  autoChanges,
  autoFacts,
  can,
  daysFrom,
  defaultDocuments,
  DOCUMENT_LABELS,
  dueWords,
  ECCS_ROLES,
  mayTick,
  ONBOARDING_PHASES,
  ONBOARDING_RULES,
  onboardingProgress,
  onboardingWords,
  PHASE_LABELS,
  phaseForDay,
  TEAM_ROLES,
  TEAM_ROLE_LABELS,
  TEMPLATE_ROLE_LABELS,
  type DatedTask,
  type DocumentAsked,
  type DocumentFacts,
  type JoiningDocumentStatus,
  type JoiningPageDto,
  type JoiningTodoDto,
  type OnboardingAuto,
  type OnboardingDto,
  type OnboardingOwner,
  type OnboardingPhase,
  type OnboardingTaskDto,
  type OnboardingTemplateDto,
  type OnboardingTemplatesDto,
  type PersonOnboardingDto,
  type PersonTaskInput,
  type Role,
  type TaskFacts,
  type TeamRole,
  type TemplateTaskValues,
} from '@eccs/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { indiaDate } from '../checklists/checklists.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { askedOf, currentDocuments, detailsOf, OnboardingPapersService } from './onboarding-papers.service.js';

// Onboarding a new team member (16 Oct 2026): the checklist. Starting someone's onboarding
// copies their role's template into their own checklist (later changes to the template reach
// only people started afterwards); each task has a phase, an owner and a due day counted from
// the joining day. Tasks the app can see tick themselves; the rest are ticked by their owner.
// The rules are in packages/shared/src/onboarding.ts; the papers (joining file, documents,
// letter, handbook) are onboarding-papers.service.ts.
//
// Who sees what: the Super Admin everything; the Ops Manager the checklist and its progress,
// ticking the tasks the Ops Manager owns, and nothing of the papers; the new hire their own
// joining page and their own tasks, never anyone else's; everyone else is refused.

const toDb = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fromDb = (date: Date) => date.toISOString().slice(0, 10);

type Viewer = 'SUPER_ADMIN' | 'OPS_MANAGER' | 'NEW_HIRE';

const onboardingInclude = {
  tasks: true,
  member: { select: { id: true, userId: true, joinedOn: true, leftOn: true, user: { select: { name: true, phone: true } } } },
} as const satisfies Prisma.OnboardingInclude;
type OnboardingRow = Prisma.OnboardingGetPayload<{ include: typeof onboardingInclude }>;
type TaskRow = OnboardingRow['tasks'][number];

const factsOf = (task: TaskRow): TaskFacts & { row: TaskRow } => ({
  id: task.id,
  phase: task.phase as OnboardingPhase,
  daysFromJoining: task.daysFromJoining,
  required: task.required,
  position: task.position,
  doneAt: task.doneAt?.toISOString() ?? null,
  row: task,
});

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly papers: OnboardingPapersService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  // ───────────────────────── Starting ─────────────────────────

  /**
   * Starts a team member's onboarding: their role's template copied into their own checklist,
   * with the documents it asks for. One per person. A founder is not onboarded here.
   */
  async start(user: AuthUser, userId: string): Promise<void> {
    const member = await this.papers.member({ userId });
    const row = await this.db.teamMember.findUnique({ where: { id: member.id }, select: { leftOn: true, onboarding: { select: { id: true } } } });
    if (row?.onboarding) throw new ConflictException(`${member.name}'s onboarding has already started`);
    if (row?.leftOn) throw new BadRequestException(`${member.name} has left the team`);
    if (!member.role) throw new BadRequestException('A founder is not onboarded here');
    const template = await this.db.onboardingTemplate.findUnique({ where: { role: member.role }, include: { tasks: { orderBy: { position: 'asc' } } } });
    await this.db.onboarding.create({
      data: {
        memberId: member.id,
        role: member.role,
        startedOn: toDb(indiaDate()),
        startedById: user.id,
        documents: (template ? askedOf(template.documents) : defaultDocuments(member.role)) as object,
        tasks: {
          create: (template?.tasks ?? []).map((task) => ({
            phase: task.phase,
            title: task.title,
            owner: task.owner,
            daysFromJoining: task.daysFromJoining,
            required: task.required,
            auto: task.auto,
            position: task.position,
          })),
        },
      },
    });
    await this.sync([member.id]);
  }

  // ───────────────────────── Ticking themselves ─────────────────────────

  /**
   * Brings the tasks that tick themselves in line with what the app can see, for these team
   * members (every open onboarding when none are given): the joining file, the documents, the
   * letter, the handbook, the first login on the phone app.
   */
  async sync(memberIds?: readonly string[]): Promise<void> {
    const onboardings = await this.db.onboarding.findMany({
      where: memberIds ? { memberId: { in: [...memberIds] } } : { tasks: { some: { auto: { not: null } } } },
      include: { tasks: { where: { auto: { not: null } } }, member: { select: { userId: true } } },
    });
    if (onboardings.length === 0) return;
    const ids = onboardings.map((entry) => entry.memberId);
    const [files, documents, letters, handbooks, logins] = await Promise.all([
      this.db.joiningFile.findMany({ where: { memberId: { in: ids } } }),
      this.db.joiningDocument.findMany({ where: { memberId: { in: ids } }, select: { memberId: true, kind: true, status: true, reviewedAt: true, uploadedAt: true } }),
      this.db.appointmentLetter.findMany({ where: { memberId: { in: ids }, acceptedAt: { not: null } }, select: { memberId: true, acceptedAt: true }, orderBy: { acceptedAt: 'asc' } }),
      this.db.handbookAcceptance.findMany({ where: { memberId: { in: ids } }, select: { memberId: true, acceptedAt: true }, orderBy: { acceptedAt: 'asc' } }),
      this.papers.firstAppLogin(onboardings.map((entry) => entry.member.userId)),
    ]);
    for (const onboarding of onboardings) {
      const file = files.find((entry) => entry.memberId === onboarding.memberId) ?? null;
      const current = currentDocuments(documents.filter((entry) => entry.memberId === onboarding.memberId));
      const facts = autoFacts({
        details: file ? { ...detailsOf(file), updatedAt: file.updatedAt.toISOString() } : null,
        asked: askedOf(onboarding.documents),
        documents: [...current.values()].map((entry): DocumentFacts => ({ kind: entry.kind as DocumentFacts['kind'], status: entry.status as JoiningDocumentStatus, reviewedAt: entry.reviewedAt?.toISOString() ?? null })),
        letterAcceptedAt: letters.find((entry) => entry.memberId === onboarding.memberId)?.acceptedAt?.toISOString() ?? null,
        handbookAcceptedAt: handbooks.find((entry) => entry.memberId === onboarding.memberId)?.acceptedAt.toISOString() ?? null,
        firstAppLoginAt: logins.get(onboarding.member.userId) ?? null,
      });
      const changes = autoChanges(
        onboarding.tasks.map((task) => ({ id: task.id, auto: task.auto as OnboardingAuto, doneAt: task.doneAt?.toISOString() ?? null, doneById: task.doneById })),
        facts,
      );
      for (const change of changes) {
        await this.db.onboardingTask.update({ where: { id: change.id }, data: { doneAt: change.doneAt ? new Date(change.doneAt) : null, doneById: null } });
      }
    }
  }

  // ───────────────────────── Reading ─────────────────────────

  /** Who the person looking is to this onboarding, or null when they may not see it. */
  private viewerOf(user: AuthUser): Viewer | null {
    if (can(user.memberships, 'team', 'approve')) return 'SUPER_ADMIN';
    if (can(user.memberships, 'team', 'read')) return 'OPS_MANAGER';
    return null;
  }

  private async onboardingOf(where: Prisma.OnboardingWhereUniqueInput): Promise<OnboardingRow | null> {
    return this.db.onboarding.findUnique({ where, include: { ...onboardingInclude, tasks: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } } });
  }

  private async taskDtos(onboarding: OnboardingRow, viewer: Viewer, today: string) {
    const progress = onboardingProgress(onboarding.tasks.map(factsOf), { joinedOn: fromDb(onboarding.member.joinedOn), startedOn: fromDb(onboarding.startedOn), today });
    const ids = onboarding.tasks.map((task) => task.doneById).filter((id): id is string => Boolean(id));
    const names = new Map((ids.length ? await this.db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } }) : []).map((row) => [row.id, row.name]));
    const dto = (entry: DatedTask<ReturnType<typeof factsOf>>): OnboardingTaskDto => {
      const task = entry.task.row;
      return {
        id: task.id,
        phase: task.phase as OnboardingPhase,
        title: task.title,
        owner: task.owner as OnboardingOwner,
        dueOn: entry.dueOn,
        dueWords: dueWords(entry, today, entry.late),
        daysLate: entry.late,
        required: task.required,
        auto: (task.auto as OnboardingAuto | null) ?? null,
        done: entry.done,
        doneAt: task.doneAt?.toISOString() ?? null,
        doneBy: task.doneAt ? (task.doneById ? (names.get(task.doneById) ?? 'someone') : 'the app') : null,
        note: task.note,
        custom: Boolean(task.addedById),
        canTick: mayTick({ owner: task.owner as OnboardingOwner, auto: (task.auto as OnboardingAuto | null) ?? null, doneAt: task.doneAt?.toISOString() ?? null, doneById: task.doneById }, viewer),
      };
    };
    return { progress, all: progress.dated.map(dto), next: progress.next.map(dto) };
  }

  /** A person's onboarding on their Team page: the checklist for the Super Admin and the Ops Manager, the papers for the Super Admin only. */
  async person(user: AuthUser, userId: string): Promise<PersonOnboardingDto> {
    const viewer = this.viewerOf(user);
    if (!viewer) throw new ForbiddenException('Onboarding is for the founders and the Ops Manager');
    const member = await this.db.teamMember.findUnique({ where: { userId }, select: { id: true, leftOn: true, user: { select: { memberships: { select: { role: true } } } } } });
    if (!member) return { onboarding: null, canStart: false };
    await this.sync([member.id]);
    const onboarding = await this.onboardingOf({ memberId: member.id });
    const teamRole = member.user.memberships.map((m) => m.role as Role).find((role) => (TEAM_ROLES as readonly Role[]).includes(role));
    if (!onboarding) return { onboarding: null, canStart: viewer === 'SUPER_ADMIN' && !member.leftOn && Boolean(teamRole) };
    return { onboarding: await this.dto(onboarding, viewer), canStart: false };
  }

  private async dto(onboarding: OnboardingRow, viewer: Viewer): Promise<OnboardingDto> {
    const today = indiaDate();
    const { progress, all, next } = await this.taskDtos(onboarding, viewer, today);
    const admin = viewer === 'SUPER_ADMIN';
    const memberId = onboarding.memberId;
    const [file, documents, letter, handbook, accepted] = admin
      ? await Promise.all([
          this.papers.fileDto(memberId),
          this.papers.documentsDto(memberId, askedOf(onboarding.documents)),
          this.papers.letterBlock(memberId),
          this.papers.handbook(),
          this.papers.handbookAccepted(memberId),
        ])
      : [null, null, null, null, null];
    return {
      id: onboarding.id,
      role: onboarding.role as TeamRole,
      startedOn: fromDb(onboarding.startedOn),
      joinedOn: fromDb(onboarding.member.joinedOn),
      progress: { done: progress.done, total: progress.total, late: progress.late, requiredLeft: progress.requiredLeft, doneOn: progress.doneOn },
      next,
      phases: ONBOARDING_PHASES.map((phase) => {
        const tasks = all.filter((task) => task.phase === phase);
        return { phase, label: PHASE_LABELS[phase], done: tasks.filter((task) => task.done).length, total: tasks.length, late: tasks.filter((task) => task.daysLate > 0).length, tasks };
      }).filter((phase) => phase.total > 0),
      currentPhase: progress.currentPhase,
      canEdit: admin,
      file,
      documents,
      letter,
      handbook: admin ? { version: handbook?.version ?? null, acceptedVersion: accepted?.version ?? null, acceptedAt: accepted?.acceptedAt ?? null } : null,
    };
  }

  /**
   * The Team list's figures for these members: progress while their onboarding is open (null
   * once done, or with none), and how many tasks are late. Read after `sync`.
   */
  progressFor(rows: readonly { joinedOn: Date; onboarding: { startedOn: Date; tasks: TaskRow[] } | null }[], today: string) {
    return rows.map((row) => {
      if (!row.onboarding) return null;
      const progress = onboardingProgress(row.onboarding.tasks.map(factsOf), { joinedOn: fromDb(row.joinedOn), startedOn: fromDb(row.onboarding.startedOn), today });
      if (progress.doneOn) return null;
      return { done: progress.done, total: progress.total, late: progress.late, words: onboardingWords(progress) };
    });
  }

  // ───────────────────────── The new hire's own page ─────────────────────────

  /** The person's own team record, for their joining page. ECCS staff only. */
  private async own(user: AuthUser) {
    if (!user.memberships.some((m) => (ECCS_ROLES as readonly Role[]).includes(m.role))) throw new ForbiddenException('This page is for ECCS\'s own team');
    const member = await this.db.teamMember.findUnique({ where: { userId: user.id }, select: { id: true, area: true, joinedOn: true, onboarding: { select: { id: true } } } });
    return member?.onboarding ? member : null;
  }

  /** The member id of the person's own onboarding, or why not. */
  async ownMemberId(user: AuthUser): Promise<string> {
    const member = await this.own(user);
    if (!member) throw new NotFoundException('You have no joining page');
    return member.id;
  }

  /** "Joining ECCS": what is left for them first, then their first week. Only ever their own. */
  async mine(user: AuthUser): Promise<{ page: JoiningPageDto | null }> {
    const member = await this.own(user);
    if (!member) return { page: null };
    await this.sync([member.id]);
    const onboarding = (await this.onboardingOf({ memberId: member.id }))!;
    const today = indiaDate();
    const { progress, all } = await this.taskDtos(onboarding, 'NEW_HIRE', today);
    const asked = askedOf(onboarding.documents);
    const [file, documents, letters, handbook, accepted] = await Promise.all([
      this.papers.fileDto(member.id),
      this.papers.documentsDto(member.id, asked),
      this.papers.letterBlock(member.id),
      this.papers.handbook(),
      this.papers.handbookAccepted(member.id),
    ]);
    const joinedOn = fromDb(member.joinedOn);
    const role = onboarding.role as TeamRole;
    // Counted over the required documents: the optional ones are there to upload if they have them.
    const required = documents.filter((entry) => entry.required);
    const acceptedCount = required.filter((entry) => entry.status === 'ACCEPTED').length;
    const sentBack = required.filter((entry) => entry.status === 'SENT_BACK').length;
    const toUpload = required.filter((entry) => entry.status === 'WAITING').length;
    const letter = letters.current;
    const shortDay = (iso: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }).format(new Date(iso));
    const handbookDone = Boolean(handbook && accepted && accepted.version === handbook.version);
    const todo: JoiningTodoDto[] = [
      {
        key: 'DETAILS',
        title: 'Fill in your details',
        done: file.complete,
        words: file.complete ? 'Done' : file.updatedAt ? `${file.missing.length} ${file.missing.length === 1 ? 'thing' : 'things'} still to fill in` : 'About 5 minutes',
      },
      {
        key: 'DOCUMENTS',
        title: 'Upload your documents',
        done: required.every((entry) => entry.status === 'ACCEPTED'),
        words: [`${acceptedCount} of ${required.length} accepted`, sentBack > 0 ? `${sentBack} sent back` : null, toUpload > 0 ? `${toUpload} to upload` : null].filter(Boolean).join(' · '),
      },
      {
        key: 'LETTER',
        title: 'Read and accept your appointment letter',
        done: letter?.status === 'ACCEPTED',
        words: !letter ? 'ECCS is preparing it' : letter.status === 'ACCEPTED' ? `Accepted on ${shortDay(letter.acceptedAt!)}` : 'Waiting for you',
      },
      {
        key: 'HANDBOOK',
        title: 'Read and accept the staff handbook',
        done: handbookDone,
        words: !handbook ? 'Not ready yet' : handbookDone ? `Accepted on ${shortDay(accepted!.acceptedAt)}` : accepted ? `Version ${handbook.version} is new: read it again` : 'About 5 minutes',
      },
    ];
    const longDay = (date: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${date}T00:00:00Z`)).replace(',', '');
    return {
      page: {
        name: user.name,
        role,
        roleLabel: TEAM_ROLE_LABELS[role],
        area: member.area,
        joinedOn,
        joiningWords: joinedOn > today ? `You join on ${longDay(joinedOn)}` : joinedOn === today ? 'You join today' : `You joined on ${longDay(joinedOn)}`,
        todo,
        left: todo.filter((entry) => !entry.done).length,
        progress: { done: progress.done, total: progress.total },
        doneOn: progress.doneOn,
        file,
        documents,
        letter: letter && letter.status !== 'REPLACED' ? letter : null,
        handbook,
        handbookAccepted: accepted,
        firstWeek: all.filter((task) => task.phase === 'FIRST_DAY' || task.phase === 'FIRST_WEEK'),
        myTasks: all.filter((task) => task.owner === 'NEW_HIRE' && !task.auto),
      },
    };
  }

  // ───────────────────────── Ticking, adding, removing ─────────────────────────

  private async task(taskId: string) {
    const row = await this.db.onboardingTask.findUnique({ where: { id: taskId }, include: { onboarding: { include: { member: { select: { userId: true, id: true } } } } } });
    if (!row) throw new NotFoundException('That task is no longer on the checklist');
    return row;
  }

  /**
   * Ticks or unticks a task, with an optional short note, on a person's Team page: the Super
   * Admin any task, the Ops Manager the tasks the Ops Manager owns.
   */
  async tick(user: AuthUser, userId: string, taskId: string, input: { done: boolean; note?: string | null | undefined }): Promise<void> {
    const viewer = this.viewerOf(user);
    if (!viewer) throw new ForbiddenException('Onboarding is for the founders and the Ops Manager');
    await this.tickAs(user, viewer, taskId, input, (row) => row.onboarding.member.userId === userId);
  }

  /** The new hire ticks one of their own tasks (owner "New hire"), on their own checklist only. */
  async tickMine(user: AuthUser, taskId: string, input: { done: boolean; note?: string | null | undefined }): Promise<void> {
    const memberId = await this.ownMemberId(user);
    await this.tickAs(user, 'NEW_HIRE', taskId, input, (row) => row.onboarding.member.id === memberId);
  }

  private async tickAs(user: AuthUser, viewer: Viewer, taskId: string, input: { done: boolean; note?: string | null | undefined }, belongs: (row: Awaited<ReturnType<OnboardingService['task']>>) => boolean) {
    const row = await this.task(taskId);
    if (!belongs(row)) throw new NotFoundException('That task is not on this checklist');
    const facts = { owner: row.owner as OnboardingOwner, auto: (row.auto as OnboardingAuto | null) ?? null, doneAt: row.doneAt?.toISOString() ?? null, doneById: row.doneById };
    if (!mayTick(facts, viewer)) {
      throw new ForbiddenException(row.auto ? 'This task ticks itself when the app sees it done' : `Only the ${viewer === 'NEW_HIRE' ? 'person who owns it' : 'Super Admin or its owner'} can tick this task`);
    }
    await this.db.onboardingTask.update({
      where: { id: row.id },
      data: input.done
        ? { doneAt: row.doneAt ?? new Date(), doneById: row.doneAt ? row.doneById : user.id, ...(input.note !== undefined && { note: input.note }) }
        : { doneAt: null, doneById: null, ...(input.note !== undefined && { note: input.note }) },
    });
    // An auto task unticked by hand ticks itself again if what it waits for is true.
    if (row.auto) await this.sync([row.onboarding.memberId]);
  }

  /** Adds a task to this person's checklist alone (the Super Admin), on a day. */
  async addTask(user: AuthUser, userId: string, input: Omit<PersonTaskInput, 'required'> & { required: boolean }): Promise<void> {
    const member = await this.db.teamMember.findUnique({ where: { userId }, select: { joinedOn: true, onboarding: { select: { id: true, _count: { select: { tasks: true } } } } } });
    if (!member?.onboarding) throw new NotFoundException('Their onboarding has not started');
    if (member.onboarding._count.tasks >= ONBOARDING_RULES.maxTasks) throw new BadRequestException(`A checklist holds at most ${ONBOARDING_RULES.maxTasks} tasks`);
    const days = daysFrom(fromDb(member.joinedOn), input.dueOn);
    const phase = phaseForDay(days);
    const last = await this.db.onboardingTask.findFirst({ where: { onboardingId: member.onboarding.id, phase }, orderBy: { position: 'desc' }, select: { position: true } });
    await this.db.onboardingTask.create({
      data: { onboardingId: member.onboarding.id, phase, title: input.title, owner: input.owner, daysFromJoining: days, required: input.required, position: (last?.position ?? -1) + 1, addedById: user.id },
    });
  }

  /** Removes a task from a person's checklist (the Super Admin). */
  async removeTask(userId: string, taskId: string): Promise<void> {
    const row = await this.task(taskId);
    if (row.onboarding.member.userId !== userId) throw new NotFoundException('That task is not on this checklist');
    await this.db.onboardingTask.delete({ where: { id: row.id } });
  }

  // ───────────────────────── Templates ─────────────────────────

  async templates(): Promise<OnboardingTemplatesDto> {
    const rows = await this.db.onboardingTemplate.findMany({ include: { tasks: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } } });
    const [settings, handbook] = await Promise.all([this.papers.letterSettings(), this.papers.handbook()]);
    return {
      templates: TEAM_ROLES.map((role): OnboardingTemplateDto => {
        const row = rows.find((entry) => entry.role === role);
        const asked = row ? askedOf(row.documents) : defaultDocuments(role);
        return {
          role,
          label: TEMPLATE_ROLE_LABELS[role],
          tasks: (row?.tasks ?? []).map((task) => ({
            id: task.id,
            phase: task.phase as OnboardingPhase,
            title: task.title,
            owner: task.owner as OnboardingOwner,
            daysFromJoining: task.daysFromJoining,
            required: task.required,
            auto: (task.auto as OnboardingAuto | null) ?? null,
            position: task.position,
          })),
          documents: asked.map((entry) => ({ ...entry, label: DOCUMENT_LABELS[entry.kind].label })),
          isSample: row?.isSample ?? false,
          updatedAt: row?.updatedAt.toISOString() ?? null,
        };
      }),
      settings,
      handbook,
    };
  }

  /** A role's template, made (empty, with the usual documents) the first time it is changed. Any change makes a sample template the founder's own. */
  private async template(role: TeamRole) {
    const row = await this.db.onboardingTemplate.findUnique({ where: { role } });
    if (row) {
      if (row.isSample) await this.db.onboardingTemplate.update({ where: { id: row.id }, data: { isSample: false, sampleKey: null } });
      return row;
    }
    return this.db.onboardingTemplate.create({ data: { role, documents: defaultDocuments(role) as object } });
  }

  async addTemplateTask(role: TeamRole, input: TemplateTaskValues): Promise<void> {
    const template = await this.template(role);
    if ((await this.db.onboardingTemplateTask.count({ where: { templateId: template.id } })) >= ONBOARDING_RULES.maxTasks) {
      throw new BadRequestException(`A checklist holds at most ${ONBOARDING_RULES.maxTasks} tasks`);
    }
    const last = await this.db.onboardingTemplateTask.findFirst({ where: { templateId: template.id, phase: input.phase }, orderBy: { position: 'desc' }, select: { position: true } });
    await this.db.onboardingTemplateTask.create({
      data: { templateId: template.id, phase: input.phase, title: input.title, owner: input.owner, daysFromJoining: input.daysFromJoining, required: input.required, auto: input.auto ?? null, position: (last?.position ?? -1) + 1 },
    });
  }

  private async templateTask(taskId: string) {
    const row = await this.db.onboardingTemplateTask.findUnique({ where: { id: taskId }, include: { template: { select: { role: true } } } });
    if (!row) throw new NotFoundException('That task is no longer in the template');
    await this.template(row.template.role as TeamRole);
    return row;
  }

  async changeTemplateTask(taskId: string, input: TemplateTaskValues): Promise<void> {
    const row = await this.templateTask(taskId);
    const moved = row.phase !== input.phase;
    const last = moved ? await this.db.onboardingTemplateTask.findFirst({ where: { templateId: row.templateId, phase: input.phase }, orderBy: { position: 'desc' }, select: { position: true } }) : null;
    await this.db.onboardingTemplateTask.update({
      where: { id: row.id },
      data: {
        phase: input.phase,
        title: input.title,
        owner: input.owner,
        daysFromJoining: input.daysFromJoining,
        required: input.required,
        auto: input.auto ?? null,
        ...(moved && { position: (last?.position ?? -1) + 1 }),
      },
    });
  }

  async removeTemplateTask(taskId: string): Promise<void> {
    const row = await this.templateTask(taskId);
    await this.db.onboardingTemplateTask.delete({ where: { id: row.id } });
  }

  /** Moves a task one place up or down within its phase. */
  async moveTemplateTask(taskId: string, direction: 'up' | 'down'): Promise<void> {
    const row = await this.templateTask(taskId);
    const siblings = await this.db.onboardingTemplateTask.findMany({ where: { templateId: row.templateId, phase: row.phase }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
    const index = siblings.findIndex((entry) => entry.id === row.id);
    const other = siblings[direction === 'up' ? index - 1 : index + 1];
    if (!other) return;
    const order = siblings.map((entry) => entry.id);
    order[index] = other.id;
    order[siblings.indexOf(other)] = row.id;
    await this.db.$transaction(order.map((id, position) => this.db.onboardingTemplateTask.update({ where: { id }, data: { position } })));
  }

  async setTemplateDocuments(role: TeamRole, documents: DocumentAsked[]): Promise<void> {
    const template = await this.template(role);
    await this.db.onboardingTemplate.update({ where: { id: template.id }, data: { documents: documents as object, isSample: false, sampleKey: null } });
  }
}

