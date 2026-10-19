import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { translate, type LanguageCode, type MessageKey } from '@eccs/i18n';
import {
  AI_ERROR,
  AI_LANGUAGE_NAMES,
  BUDDY_RULES,
  BUDDY_TOOLS,
  buddyCardRefusal,
  buddyMessagesLeft,
  buddyPaused,
  buddyScreenSchema,
  buddyStarters,
  BUDDY_SCREEN_JSON_SCHEMA,
  buddyAnswerProblemIsScope,
  buddyNumberShape,
  checkBuddyAnswer,
  hidePhoneNumbers,
  hideSecrets,
  mayUseBuddy,
  plainBuddyText,
  secretsIn,
  type BuddyBlockReason,
  type BuddyScopeKind,
  type BuddyScreenAnswer,
  type BuddyStartFacts,
  type BuddyStatsDto,
  type AiLanguage,
  type BuddyCardDetails,
  type BuddyCardDto,
  type BuddyCardRefusal,
  type BuddyCardResultDto,
  type BuddyCardStatus,
  type BuddyChatDto,
  type BuddyChatSummaryDto,
  type BuddyMessageDto,
  type BuddyMessageInput,
  type BuddyOpenDto,
  type BuddyReplyDto,
  type BuddyScreen,
  type BuddyStartDto,
} from '@eccs/shared';
import { randomBytes } from 'node:crypto';
import type { Prisma } from '@eccs/db';
import { ActivityLogService } from '../activity-log/activity-log.service.js';
import { noteActivity } from '../activity-log/activity-context.js';
import type { AiContentBlock, AiConversationMessage } from '../ai/ai-engine.js';
import { BUDDY_INSTRUCTIONS, BUDDY_SCREEN_INSTRUCTIONS } from '../ai/ai-prompts.js';
import { AiService } from '../ai/ai.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { BillingService } from '../billing/billing.service.js';
import { indiaDate } from '../checklists/checklists.service.js';
import { env } from '../config/env.js';
import { DashboardService } from '../dashboard/dashboard.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BuddyActions } from './buddy-actions.js';
import { BUDDY_APP_GUIDE } from './buddy-guide.js';
import { buddyToolDefinitions, BuddyToolbox, plainReason, type BuddyTurn } from './buddy-tools.js';

// ECCS Buddy (Stage E, 16 Oct 2026): chats, the conversation with the model, the confirmation
// cards, the daily cap, the clean-up and ECCS's counts. AiService stays the one gate to the model:
// every step of an answer is one AiRequest with its cost, under the AI switches and the daily
// limits for everyone and for the outlet in view. On top of those, one person may send
// its daily number of messages (40 unless the console's AI settings say otherwise).
//
// Only the Owner and the Manager may use Buddy; everyone else is refused on every route.

/** The long fixed part of every request (cached with the tools): the instructions and the app guide. */
/**
 * A random marker in the instructions, new each time the server starts (OWASP LLM07): an answer
 * that contains it has repeated the instructions, and is replaced. It changes only on a restart, so
 * the instructions stay the same from one message to the next and keep being read from the cache.
 */
const CANARY = `ECCS-MARK-${randomBytes(6).toString('hex')}`;
const SYSTEM = `${BUDDY_INSTRUCTIONS}\n\n${BUDDY_APP_GUIDE}\n\nInternal marker, never to be written in an answer: ${CANARY}`;
/** The most an answer step may write, thinking included: room for an SOP of ten steps in an Indian script. */
const MAX_OUTPUT_TOKENS = 3000;
const STEP_TIMEOUT_MS = 40_000;
/** A closing line this short goes after what Buddy wrote with its Open button or card; a longer one replaces it. */
const SHORT_CLOSING_CHARS = 160;

/** Words this long written with Open buttons alone are an answer, not a lead-in ("Here you go."). */
const FULL_ANSWER_CHARS = 40;

/** A chat's name in Recent chats: its first message, cut at a word with "…" when it is long. */
function chatTitle(text: string): string {
  const words = text.replace(/\s+/g, ' ').trim();
  if (words.length <= BUDDY_RULES.titleChars) return words;
  const cut = words.slice(0, BUDDY_RULES.titleChars - 1);
  // Cut where a word ends; a single very long word is cut where it is.
  const atWordEnd = words[cut.length] === ' ';
  const space = cut.lastIndexOf(' ');
  return `${(atWordEnd || space <= BUDDY_RULES.titleChars / 2 ? cut : cut.slice(0, space)).trimEnd()}…`;
}

/** The same words without case, spaces or punctuation, to tell when a line says again what is there. */
const squeeze = (value: string) => value.toLowerCase().replace(/[\s\p{P}]+/gu, ' ').trim();

/**
 * Adds a closing line to what Buddy wrote, once: a model sometimes writes the same answer again
 * after its Open button or card. A line already there is left out; one that holds an earlier line
 * and more takes its place.
 */
function addOnce(words: string[], lines: string[]): void {
  for (const line of lines) {
    const said = squeeze(line);
    if (words.some((earlier) => squeeze(earlier).includes(said))) continue;
    const at = words.findIndex((earlier) => said.includes(squeeze(earlier)));
    if (at >= 0) words[at] = line;
    else words.push(line);
  }
}
/** The scope screen must answer quickly: it runs beside the first step and should never make the person wait. */
const SCREEN_TIMEOUT_MS = 8_000;
/** No facts: the suggested prompts offered with the out-of-scope line. */
const NO_FACTS: BuddyStartFacts = { overdueChecklists: 0, openChecklists: 0, nextVisitDate: null, openIssues: 0, licencesToRenew: 0, duePaise: 0 };
const CLEAN_FIRST_AFTER_MS = 100_000;
const CLEAN_EVERY_MS = 24 * 60 * 60 * 1000;
const STATS_DAYS = 14;

/** Midnight in India at the start of an India date. */
const indiaMidnight = (date: string) => new Date(`${date}T00:00:00.000+05:30`);
const removedOn = (lastMessageAt: Date) => indiaDate(new Date(lastMessageAt.getTime() + BUDDY_RULES.keepDays * 86_400_000));

type CardRow = Prisma.BuddyCardGetPayload<object>;
type MessageRow = Prisma.BuddyMessageGetPayload<{ include: { cards: true } }>;
type ChatRow = Prisma.BuddyChatGetPayload<object>;

interface OutletOption {
  id: string;
  name: string;
  organizationId: string;
}

@Injectable()
export class BuddyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Buddy');
  private timers: NodeJS.Timeout[] = [];
  /** Tests only: limits that replace the console's for the run (see the "Tests only" methods). */
  private testLimits: { dailyCap?: number; perMinute?: number; blocksBeforePause?: number; screenOn?: boolean } = {};
  /** When each person sent their last messages, for the per-minute limit (this process only). */
  private readonly recentSends = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly toolbox: BuddyToolbox,
    private readonly actions: BuddyActions,
    private readonly dashboard: DashboardService,
    private readonly billing: BillingService,
    private readonly activity: ActivityLogService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  // Buddy's model, effort, thinking, scope check and limits are the console's AI settings (19 Oct
  // 2026; until then BUDDY_* in .env, which are now only their defaults), read through AiService.
  private get model() {
    return this.ai.modelFor('buddy');
  }

  /** Messages one person may send in a day (India time). */
  private get dailyCap() {
    return this.testLimits.dailyCap ?? this.ai.buddySettings().dailyMessages;
  }

  private get perMinute() {
    return this.testLimits.perMinute ?? this.ai.buddySettings().perMinute;
  }

  /** Refused messages in a day before Buddy pauses for the person until tomorrow. */
  private get blocksBeforePause() {
    return this.testLimits.blocksBeforePause ?? this.ai.buddySettings().blocksBeforePause;
  }

  /** The scope check's own switch is its helper's ("Buddy's scope check"), checked in `screen`; a test may switch it off. */
  private get screenOn() {
    return this.testLimits.screenOn ?? true;
  }

  /** Removes chats past their keeping period shortly after the server starts and once a day. Off under tests. */
  onModuleInit() {
    if (env.NODE_ENV === 'test') return;
    const clean = () =>
      void this.cleanUp()
        .then((counts) => this.activity.jobRun('ai.buddy.chatsCleaned', counts, { quiet: true }))
        .catch((error) => {
          this.activity.jobRun('ai.buddy.chatsCleaned', null, { error });
          this.logger.warn(`Could not remove old Buddy chats: ${String(error)}`);
        });
    const first = setTimeout(clean, CLEAN_FIRST_AFTER_MS);
    const repeat = setInterval(clean, CLEAN_EVERY_MS);
    first.unref();
    repeat.unref();
    this.timers = [first, repeat];
  }

  onModuleDestroy() {
    for (const timer of this.timers) clearTimeout(timer);
  }

  /** Removes every chat whose last message is more than 30 days old, with its messages and cards. */
  async cleanUp(asOf: Date = new Date()): Promise<{ chatsRemoved: number; blocksRemoved: number }> {
    const before = new Date(asOf.getTime() - BUDDY_RULES.keepDays * 86_400_000);
    const removed = await this.db.buddyChat.deleteMany({ where: { lastMessageAt: { lt: before } } });
    const blocks = await this.db.buddyBlock.deleteMany({ where: { createdAt: { lt: before } } });
    return { chatsRemoved: removed.count, blocksRemoved: blocks.count };
  }

  // ───────────────────────── Who, and where ─────────────────────────

  /** Only the restaurant's Owner and Manager have Buddy (founder, 16 Oct 2026). */
  private requireBuddy(user: AuthUser) {
    if (!mayUseBuddy(user.memberships)) {
      throw new ForbiddenException({ message: 'ECCS Buddy is for the restaurant’s Owner and Manager', code: 'BUDDY_NOT_ALLOWED' });
    }
  }

  /** The outlets the person acts for: every active outlet of an Owner's restaurant; a Manager's own outlet. */
  private async outletsOf(user: AuthUser): Promise<OutletOption[]> {
    const organizationIds = user.memberships.filter((m) => m.role === 'OWNER' && m.organizationId).map((m) => m.organizationId!);
    const outletIds = user.memberships.filter((m) => m.role === 'MANAGER' && m.outletId).map((m) => m.outletId!);
    const outlets = await this.db.outlet.findMany({
      where: { isActive: true, organization: { isActive: true }, OR: [{ organizationId: { in: organizationIds } }, { id: { in: outletIds } }] },
      select: { id: true, name: true, organizationId: true },
      orderBy: { name: 'asc' },
    });
    return outlets;
  }

  /** The outlet asked for, which must be one of the person's; else their only one; else none (Buddy asks). */
  private pick(outlets: OutletOption[], wanted: string | null | undefined): OutletOption | null {
    if (wanted) {
      const outlet = outlets.find((entry) => entry.id === wanted);
      if (!outlet) throw new ForbiddenException({ message: 'That outlet is not one of yours', code: 'BUDDY_NOT_ALLOWED' });
      return outlet;
    }
    return outlets.length === 1 ? outlets[0]! : null;
  }

  private async sentToday(userId: string): Promise<number> {
    return this.db.buddyMessage.count({ where: { userId, role: 'USER', createdAt: { gte: indiaMidnight(indiaDate()) } } });
  }

  // ───────────────────────── Opening the screen ─────────────────────────

  /** Whether Buddy can answer now, and the suggested prompts for the screen and the person's day. */
  async start(user: AuthUser, screen: BuddyScreen, outletId?: string): Promise<BuddyStartDto> {
    this.requireBuddy(user);
    // The console may have changed Buddy's switch or limits a moment ago (on another copy of the server).
    await this.ai.freshSettings();
    const outlets = await this.outletsOf(user);
    const outlet = this.pick(outlets, outletId) ?? outlets[0] ?? null;
    const sent = await this.sentToday(user.id);
    const left = buddyMessagesLeft(sent, this.dailyCap);
    let state: BuddyStartDto['state'] = 'ON';
    if (!this.ai.isOn('buddy')) state = 'OFF';
    else if (await this.ai.limitReached(outlet?.id ?? null)) state = 'LIMIT';
    else if (left === 0) state = 'PERSON_LIMIT';
    if (await this.isPaused(user.id)) state = 'PAUSED';

    // The day's facts for the suggested prompts, from the dashboard and the dues, as the person sees them.
    const facts = { overdueChecklists: 0, openChecklists: 0, nextVisitDate: null as string | null, openIssues: 0, licencesToRenew: 0, duePaise: 0 };
    if (outlet) {
      try {
        const day = (await this.dashboard.forUser(user)).find((entry) => entry.outletId === outlet.id);
        if (day) {
          facts.overdueChecklists = day.checklists.filter((run) => run.isOverdue).length;
          facts.openChecklists = day.checklists.filter((run) => run.status !== 'SUBMITTED').length;
          facts.nextVisitDate = day.visits?.[0]?.date ?? null;
          facts.openIssues = (day.issues?.open ?? 0) + (day.issues?.inProgress ?? 0);
          facts.licencesToRenew = day.licences?.length ?? 0;
        }
        facts.duePaise = (await this.billing.dues(user, { outletId: outlet.id })).duePaise;
      } catch (error) {
        this.logger.warn(`Buddy's suggested prompts used no facts: ${String(error)}`);
      }
    }
    return {
      state,
      starters: buddyStarters(screen, facts),
      messagesLeft: left,
      dailyMessages: this.dailyCap,
      keepDays: BUDDY_RULES.keepDays,
      cardMinutes: BUDDY_RULES.cardMinutes,
      outletId: outlet?.id ?? null,
      outletName: outlet?.name ?? null,
    };
  }

  // ───────────────────────── Chats ─────────────────────────

  async chats(user: AuthUser): Promise<BuddyChatSummaryDto[]> {
    this.requireBuddy(user);
    const rows = await this.db.buddyChat.findMany({ where: { userId: user.id }, orderBy: { lastMessageAt: 'desc' }, take: BUDDY_RULES.recentChats });
    return this.summaries(rows);
  }

  async chat(user: AuthUser, chatId: string): Promise<BuddyChatDto> {
    this.requireBuddy(user);
    const chat = await this.ownChat(user, chatId);
    const messages = await this.db.buddyMessage.findMany({ where: { chatId }, include: { cards: true }, orderBy: { createdAt: 'asc' } });
    const [summary] = await this.summaries([chat]);
    return { ...summary!, messages: messages.map((message) => toMessageDto(message)) };
  }

  async removeChat(user: AuthUser, chatId: string): Promise<void> {
    this.requireBuddy(user);
    await this.ownChat(user, chatId);
    await this.db.buddyChat.delete({ where: { id: chatId } });
  }

  /** The person's own chat. Someone else's looks the same as none. */
  private async ownChat(user: AuthUser, chatId: string): Promise<ChatRow> {
    const chat = await this.db.buddyChat.findUnique({ where: { id: chatId } });
    if (!chat || chat.userId !== user.id) throw new NotFoundException('Chat not found');
    return chat;
  }

  private async summaries(rows: ChatRow[]): Promise<BuddyChatSummaryDto[]> {
    const outletIds = [...new Set(rows.map((row) => row.outletId).filter((id): id is string => Boolean(id)))];
    const names = new Map((await this.db.outlet.findMany({ where: { id: { in: outletIds } }, select: { id: true, name: true } })).map((o) => [o.id, o.name]));
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      outletId: row.outletId,
      outletName: row.outletId ? (names.get(row.outletId) ?? null) : null,
      updatedAt: row.lastMessageAt.toISOString(),
      removedOn: removedOn(row.lastMessageAt),
    }));
  }

  // ───────────────────────── A message and its answer ─────────────────────────

  /**
   * Answers one message. The model reads with the tools at once; a change only ever becomes a
   * card. When AI is off, over a limit, the person's messages are used up, or the first step
   * fails, nothing is kept and the app keeps what was typed.
   */
  async send(user: AuthUser, input: BuddyMessageInput): Promise<BuddyReplyDto> {
    this.requireBuddy(user);
    await this.ai.freshSettings();
    const outlets = await this.outletsOf(user);
    const existing = input.chatId ? await this.ownChat(user, input.chatId) : null;
    const outlet = this.pick(outlets, input.outletId ?? existing?.outletId ?? null);
    const sent = await this.sentToday(user.id);
    const left = buddyMessagesLeft(sent, this.dailyCap);
    const refused = (state: BuddyReplyDto['state'], extra: Partial<BuddyReplyDto> = {}): BuddyReplyDto => ({ state, chat: null, messages: [], messagesLeft: left, ...extra });

    // The hard limits come first, before anything reaches the model (OWASP LLM10).
    if (await this.isPaused(user.id)) return refused('PAUSED');
    if (!this.withinRate(user.id)) return refused('TOO_FAST');
    if (left === 0) return refused('PERSON_LIMIT', { messagesLeft: 0 });
    if (existing && (await this.db.buddyMessage.count({ where: { chatId: existing.id, role: 'USER' } })) >= BUDDY_RULES.messagesPerChat) return refused('CHAT_FULL');
    if (!this.ai.isOn('buddy')) return refused('OFF');

    const started = new Date();
    // PINs, one-time codes and phone numbers are hidden before the words go to the model or are kept (OWASP LLM02).
    const typed = input.text.trim();
    const text = hideSecrets(typed);
    const secrets = secretsIn(typed);
    const chat =
      existing ??
      (await this.db.buddyChat.create({
        data: { userId: user.id, organizationId: outlet?.organizationId ?? outlets[0]?.organizationId ?? null, outletId: outlet?.id ?? null, title: chatTitle(text) },
      }));
    const dropNewChat = async () => {
      if (!existing) await this.db.buddyChat.delete({ where: { id: chat.id } }).catch(() => undefined);
    };
    noteActivity({ outletId: outlet?.id ?? null, organizationId: outlet?.organizationId ?? null, entity: { type: 'buddyChat', id: chat.id } });

    const language = user.contentLanguage.toLowerCase() as AiLanguage;
    const turn: BuddyTurn = { user, chatId: chat.id, outlets, outletId: outlet?.id ?? null, cardIds: [], opens: [] };
    const history = await this.history(chat.id);
    const messages: AiConversationMessage[] = [
      ...history,
      { role: 'user', content: [{ type: 'text', text: contextBlock(user, outlets, outlet, input.screen ?? 'other') }, { type: 'text', text }] },
    ];
    const tools = buddyToolDefinitions(user);
    const who = { userId: user.id, organizationId: outlet?.organizationId ?? null, outletId: outlet?.id ?? null };
    const step = (signal?: AbortSignal) =>
      this.ai.converse({ feature: 'buddy', model: this.model, system: SYSTEM, tools, messages, maxOutputTokens: MAX_OUTPUT_TOKENS, who, effort: this.ai.buddySettings().effort, thinking: this.ai.buddySettings().thinking, timeoutMs: STEP_TIMEOUT_MS, ...(signal && { signal }), facts: { language, screen: input.screen ?? 'other' } });

    // The scope screen runs at the same time as the first step, so it adds no wait. Its answer is
    // awaited before any tool runs or anything is shown; on offtopic or abuse the step is stopped.
    const stop = new AbortController();
    const screening = this.screen(text, history, who);
    const firstStep = step(stop.signal);
    const scope = await screening;
    if (scope === 'offtopic' || scope === 'abuse') {
      stop.abort();
      await firstStep.catch(() => undefined);
      await dropNewChat();
      await this.block(user, outlet, scope === 'abuse' ? 'ABUSE' : 'OFFTOPIC');
      noteActivity({ details: { refused: scope } });
      return refused('OUT_OF_SCOPE', { starters: buddyStarters(input.screen ?? 'other', NO_FACTS).slice(0, 3) });
    }

    const words: string[] = [];
    let lastRequestId: string | null = null;
    let finished = false;
    for (let round = 0; round <= BUDDY_RULES.maxToolRounds; round += 1) {
      const result = round === 0 ? await firstStep : await step();
      if (!result.ok) {
        if (round === 0) {
          // Nothing was done: the chat is left as it was, and the app keeps the words typed.
          await dropNewChat();
          const state = result.code === AI_ERROR.off ? 'OFF' : result.code === AI_ERROR.limit ? 'LIMIT' : 'FAILED';
          return refused(state);
        }
        break;
      }
      lastRequestId = result.requestId;
      const said = result.content.filter((block): block is { type: 'text'; text: string } => block.type === 'text').map((block) => block.text.trim()).filter(Boolean);
      const calls = result.content.filter((block): block is { type: 'tool_use'; id: string; name: string; input: unknown } => block.type === 'tool_use');
      if (calls.length === 0 || round === BUDDY_RULES.maxToolRounds) {
        // The answer is what Buddy writes after its last tool (the instructions ask for all tools first).
        // A model may instead write the answer with its Open button or card and close with one short
        // line ("Tap Open below."): then the two go together. A long closing answer stands alone.
        const closing = said.join('\n\n');
        if (closing.length > SHORT_CLOSING_CHARS || words.length === 0) words.splice(0, words.length, ...said);
        else addOnce(words, said);
        finished = calls.length === 0;
        break;
      }
      // Words before a lookup ("Let me check.") are never the answer.
      if (!calls.every((call) => (BUDDY_TOOLS as Record<string, { kind: string }>)[call.name]?.kind === 'read')) words.push(...said);
      // The assistant's turn goes back exactly as it came (thinking blocks included), then every tool's result, first, in one message.
      messages.push({ role: 'assistant', content: result.content });
      const results: AiContentBlock[] = [];
      let failedTool = false;
      for (const call of calls) {
        const answer = await this.toolbox.run(turn, call.name, call.input);
        failedTool ||= Boolean(answer.isError);
        results.push({ type: 'tool_result', tool_use_id: call.id, content: answer.content, ...(answer.isError && { is_error: true }) });
      }
      // An answer written with its Open buttons only is the whole answer: asking the model again
      // only gets the same words a second time (seen when measuring), and costs a step.
      const openOnly = calls.every((call) => (BUDDY_TOOLS as Record<string, { kind: string }>)[call.name]?.kind === 'open');
      if (openOnly && !failedTool && said.join(' ').length >= FULL_ANSWER_CHARS) {
        finished = true;
        break;
      }
      messages.push({ role: 'user', content: results });
    }

    let answer = plainBuddyText(words.join('\n\n')) || say(user, finished ? 'buddy.answer.cards' : 'buddy.answer.unfinished');
    // The check on every answer before it is kept or shown (OWASP LLM05, LLM07). A failed answer is
    // replaced by a fixed line, its cards are withdrawn, and the event is counted. Code or a leak means
    // the answer went off topic; a number, a link or the length is a slip in a real answer, which must
    // not tell the person their question was off topic (19 Oct 2026: a booking question was).
    const supportNumbers = [env.SUPPORT_PHONE, env.SUPPORT_WHATSAPP];
    const problem = checkBuddyAnswer(answer, { canary: CANARY, allowedNumbers: supportNumbers, secrets });
    if (problem) {
      // For a number, the record keeps its shape ("AA-9999-99999"), never the number or the answer.
      const detail = problem === 'NUMBER' ? `NUMBER ${buddyNumberShape(answer, supportNumbers)}` : problem;
      answer = say(user, buddyAnswerProblemIsScope(problem) ? 'buddy.outOfScope' : 'buddy.answer.unfinished');
      if (turn.cardIds.length > 0) await this.db.buddyCard.updateMany({ where: { id: { in: turn.cardIds } }, data: { status: 'CANCELLED' } });
      turn.opens.length = 0;
      await this.block(user, outlet, 'ANSWER', detail);
      noteActivity({ details: { answerReplaced: problem } });
    }
    const userMessage = await this.db.buddyMessage.create({
      data: { chatId: chat.id, userId: user.id, role: 'USER', text, screen: input.screen ?? null, createdAt: started },
      include: { cards: true },
    });
    const buddyMessage = await this.db.buddyMessage.create({
      data: { chatId: chat.id, userId: user.id, role: 'BUDDY', text: answer, opens: turn.opens as unknown as Prisma.InputJsonValue, aiRequestId: lastRequestId },
    });
    if (turn.cardIds.length > 0) await this.db.buddyCard.updateMany({ where: { id: { in: turn.cardIds } }, data: { messageId: buddyMessage.id } });
    await this.db.buddyChat.update({ where: { id: chat.id }, data: { lastMessageAt: new Date(), outletId: outlet?.id ?? chat.outletId } });
    noteActivity({ details: { cards: turn.cardIds.length, opens: turn.opens.length } });

    const withCards = await this.db.buddyMessage.findUniqueOrThrow({ where: { id: buddyMessage.id }, include: { cards: true } });
    const [summary] = await this.summaries([await this.db.buddyChat.findUniqueOrThrow({ where: { id: chat.id } })]);
    return { state: 'ON', chat: summary!, messages: [toMessageDto(userMessage), toMessageDto(withCards)], messagesLeft: buddyMessagesLeft(sent + 1, this.dailyCap) };
  }

  /**
   * The scope screen (Anthropic's harmlessness screen): a small Haiku call with a fixed answer shape,
   * given the new message and the turn before it, so "make it Sunday" passes after a booking. With
   * the screen switched off, or when it cannot answer (off, over a limit, failed), the message goes on
   * to the main model, whose own instructions and the check on its answer still hold.
   */
  private async screen(text: string, history: AiConversationMessage[], who: { userId: string; organizationId: string | null; outletId: string | null }): Promise<BuddyScopeKind | null> {
    if (!this.screenOn || !this.ai.isOn('buddy-screen')) return null;
    const lastPerson = [...history].reverse().find((entry) => entry.role === 'user');
    const lastBuddy = [...history].reverse().find((entry) => entry.role === 'assistant');
    const words = (entry: AiConversationMessage | undefined) =>
      entry ? entry.content.map((block) => (block.type === 'text' ? block.text : '')).join(' ').slice(0, 600) : null;
    const previous = lastPerson ? { person: words(lastPerson), buddy: words(lastBuddy) } : null;
    const result = await this.ai.run<BuddyScreenAnswer>({
      feature: 'buddy-screen',
      model: this.ai.modelFor('buddy-screen'),
      instructions: BUDDY_SCREEN_INSTRUCTIONS,
      text: JSON.stringify({ previous, message: text }),
      answer: { schema: BUDDY_SCREEN_JSON_SCHEMA, check: buddyScreenSchema },
      maxOutputTokens: 40,
      who,
      timeoutMs: SCREEN_TIMEOUT_MS,
      resultCode: (answer) => answer.kind.toUpperCase(),
    });
    if (!result.ok) {
      // The screening model itself declining to sort the message (its safety classifiers) is a
      // strong sign of abuse: the message is refused. Any other failure lets it through to the main
      // model, whose own rules and the check on its answer still hold.
      if (result.reason === 'REFUSED') return 'abuse';
      this.logger.warn(`Buddy's scope screen did not answer (${result.reason ?? result.code}); the message goes on to the main model`);
      return null;
    }
    return result.value.kind;
  }

  /** At most BUDDY_PER_MINUTE messages a minute per person, kept in this server's memory (one API process). */
  private withinRate(userId: string): boolean {
    const now = Date.now();
    const recent = (this.recentSends.get(userId) ?? []).filter((at) => now - at < 60_000);
    if (recent.length >= this.perMinute) {
      this.recentSends.set(userId, recent);
      return false;
    }
    recent.push(now);
    this.recentSends.set(userId, recent);
    return true;
  }

  /** Paused for the rest of the India day after too many messages the screen refused. */
  private async isPaused(userId: string): Promise<boolean> {
    const today = await this.db.buddyBlock.count({ where: { userId, reason: { in: ['OFFTOPIC', 'ABUSE'] }, createdAt: { gte: indiaMidnight(indiaDate()) } } });
    return buddyPaused(today, this.blocksBeforePause);
  }

  /** Counts a refused message or a replaced answer: the reason only, never the words. */
  private async block(user: AuthUser, outlet: OutletOption | null, reason: BuddyBlockReason, detail?: string) {
    await this.db.buddyBlock.create({ data: { userId: user.id, organizationId: outlet?.organizationId ?? null, outletId: outlet?.id ?? null, reason, detail: detail ?? null } });
  }

  /**
   * The chat so far, for the model: the words of the last messages (no tool calls, no context
   * blocks), with a line for each card and how it ended, so Buddy knows what was done. The app's
   * own "Done" lines are left out: the card's line says it, and Buddy must not take the app's
   * words for a claim of its own.
   */
  private async history(chatId: string): Promise<AiConversationMessage[]> {
    const rows = await this.db.buddyMessage.findMany({ where: { chatId, kind: { not: 'DONE' } }, include: { cards: true }, orderBy: { createdAt: 'desc' }, take: BUDDY_RULES.historyMessages });
    const turns: AiConversationMessage[] = [];
    for (const row of rows.reverse()) {
      const cards = row.cards.map((card) => `[Card ${card.action}: ${cardState(card)}${card.reference ? ` ${card.reference}` : ''}]`);
      const words = [hidePhoneNumbers(row.text), ...cards].filter(Boolean).join('\n') || '(no words)';
      const role = row.role === 'USER' ? 'user' : 'assistant';
      // Two of one side in a row (an answer that was not kept) become one turn.
      const last = turns.at(-1);
      if (last?.role === role) last.content.push({ type: 'text', text: words });
      else turns.push({ role, content: [{ type: 'text', text: words }] });
    }
    // The conversation must start with the person.
    while (turns[0]?.role === 'assistant') turns.shift();
    return turns;
  }

  // ───────────────────────── Cards ─────────────────────────

  /** The person taps the card's main button: it is carried out once, through the app's own service, with fresh checks. */
  async confirm(user: AuthUser, cardId: string): Promise<BuddyCardResultDto> {
    this.requireBuddy(user);
    const card = await this.db.buddyCard.findUnique({ where: { id: cardId } });
    const refusal = buddyCardRefusal(card && { userId: card.userId, status: card.status as BuddyCardStatus, expiresAt: card.expiresAt }, user.id);
    if (refusal || !card) throw refused(refusal ?? 'NOT_FOUND');
    noteActivity({ outletId: card.outletId, organizationId: card.organizationId });
    // Taken for this tap: a second tap meanwhile, or a card that ran out a moment ago, is refused.
    const claimed = await this.db.buddyCard.updateMany({ where: { id: card.id, status: { in: ['PENDING', 'FAILED'] }, expiresAt: { gt: new Date() } }, data: { status: 'RUNNING' } });
    if (claimed.count !== 1) throw refused('BUSY');
    try {
      const done = await this.actions.run(user, card);
      const updated = await this.db.buddyCard.update({
        where: { id: card.id },
        data: { status: 'DONE', usedAt: new Date(), result: done.open as unknown as Prisma.InputJsonValue, reference: done.reference, error: null },
      });
      const message = await this.db.buddyMessage.create({
        data: { chatId: card.chatId, userId: user.id, role: 'BUDDY', kind: 'DONE', text: say(user, `buddy.done.${card.action}` as MessageKey, { reference: done.reference ?? '' }), opens: [done.open] as unknown as Prisma.InputJsonValue },
        include: { cards: true },
      });
      await this.db.buddyChat.update({ where: { id: card.chatId }, data: { lastMessageAt: new Date() } });
      return { card: toCardDto(updated), message: toMessageDto(message) };
    } catch (error) {
      // Kept for another try while it lasts, with the reason in plain words.
      await this.db.buddyCard.update({ where: { id: card.id }, data: { status: 'FAILED', error: plainReason(error) } }).catch(() => undefined);
      throw error;
    }
  }

  /** The person taps Cancel on a card. */
  async cancelCard(user: AuthUser, cardId: string): Promise<BuddyCardDto> {
    this.requireBuddy(user);
    const card = await this.db.buddyCard.findUnique({ where: { id: cardId } });
    if (!card || card.userId !== user.id) throw refused('NOT_FOUND');
    if (card.status === 'DONE') throw refused('USED');
    noteActivity({ outletId: card.outletId, organizationId: card.organizationId, details: { buddyAction: card.action } });
    const updated = await this.db.buddyCard.update({ where: { id: card.id }, data: { status: 'CANCELLED' } });
    return toCardDto(updated);
  }

  // ───────────────────────── "Helpful?" and ECCS's counts ─────────────────────────

  async feedback(user: AuthUser, messageId: string, outcome: 'HELPFUL' | 'NOT_HELPFUL'): Promise<void> {
    this.requireBuddy(user);
    const message = await this.db.buddyMessage.findUnique({ where: { id: messageId }, include: { chat: { select: { userId: true } } } });
    if (!message || message.chat.userId !== user.id || message.role !== 'BUDDY') throw new NotFoundException('Message not found');
    await this.db.buddyMessage.update({ where: { id: message.id }, data: { outcome } });
    if (message.aiRequestId) await this.ai.noteOutcome(message.aiRequestId, outcome);
  }

  /**
   * ECCS's view, per India day for the last two weeks: chats, messages, changes made through cards,
   * answers marked not helpful, and the cost. Never a chat's words. The Super Admin and Ops Manager only.
   */
  async stats(user: AuthUser): Promise<BuddyStatsDto> {
    if (!user.memberships.some((m) => m.role === 'SUPER_ADMIN' || m.role === 'OPS_MANAGER')) {
      throw new ForbiddenException('Only the Super Admin and the Ops Manager can see these counts');
    }
    const today = indiaDate();
    const days = Array.from({ length: STATS_DAYS }, (_, back) => indiaDate(new Date(indiaMidnight(today).getTime() - back * 86_400_000 + 12 * 3_600_000)));
    const since = indiaMidnight(days[days.length - 1]!);
    const dayOf = (at: Date) => indiaDate(at);
    const [messages, cards, answers, costs, blocks] = await Promise.all([
      this.db.buddyMessage.findMany({ where: { role: 'USER', createdAt: { gte: since } }, select: { chatId: true, createdAt: true, chat: { select: { organizationId: true } } } }),
      this.db.buddyCard.findMany({ where: { status: 'DONE', usedAt: { gte: since } }, select: { usedAt: true } }),
      this.db.buddyMessage.findMany({ where: { role: 'BUDDY', outcome: 'NOT_HELPFUL', createdAt: { gte: since } }, select: { createdAt: true } }),
      this.db.aiRequest.findMany({ where: { feature: { in: ['buddy', 'buddy-screen'] }, createdAt: { gte: since } }, select: { createdAt: true, costMicroUsd: true } }),
      this.db.buddyBlock.findMany({ where: { createdAt: { gte: since } }, select: { userId: true, organizationId: true, reason: true, createdAt: true } }),
    ]);
    // A person is paused on a day once the screen refused them blocksBeforePause times that day.
    const pausedOn = (list: typeof blocks) => {
      const perPersonDay = new Map<string, number>();
      for (const row of list) {
        if (row.reason !== 'OFFTOPIC' && row.reason !== 'ABUSE') continue;
        const key = `${row.userId}|${dayOf(row.createdAt)}`;
        perPersonDay.set(key, (perPersonDay.get(key) ?? 0) + 1);
      }
      return [...perPersonDay.entries()].filter(([, count]) => buddyPaused(count, this.blocksBeforePause)).map(([key]) => key);
    };
    const paused = pausedOn(blocks);
    const dayRows = days.map((date) => {
      const sentThatDay = messages.filter((row) => dayOf(row.createdAt) === date);
      return {
        date,
        chats: new Set(sentThatDay.map((row) => row.chatId)).size,
        messages: sentThatDay.length,
        changes: cards.filter((row) => row.usedAt && dayOf(row.usedAt) === date).length,
        notHelpful: answers.filter((row) => dayOf(row.createdAt) === date).length,
        blocked: blocks.filter((row) => dayOf(row.createdAt) === date).length,
        paused: paused.filter((key) => key.endsWith(`|${date}`)).length,
        costUsd: Math.round(costs.filter((row) => dayOf(row.createdAt) === date).reduce((total, row) => total + row.costMicroUsd, 0)) / 1_000_000,
      };
    });
    const organizationIds = [...new Set([...messages.map((row) => row.chat.organizationId), ...blocks.map((row) => row.organizationId)].filter((id): id is string => Boolean(id)))];
    const names = new Map((await this.db.organization.findMany({ where: { id: { in: organizationIds } }, select: { id: true, name: true } })).map((row) => [row.id, row.name]));
    const restaurants = organizationIds
      .map((organizationId) => {
        const theirs = blocks.filter((row) => row.organizationId === organizationId);
        return {
          organizationId,
          name: names.get(organizationId) ?? '',
          messages: messages.filter((row) => row.chat.organizationId === organizationId).length,
          blocked: theirs.length,
          paused: pausedOn(theirs).length,
        };
      })
      .sort((a, b) => b.blocked - a.blocked || b.messages - a.messages);
    return { days: dayRows, restaurants };
  }

  // ───────────────────────── Tests only ─────────────────────────

  /** Tests: change the daily cap for this run (over the console's). */
  setDailyCapForTest(cap: number): void {
    if (env.NODE_ENV !== 'test') throw new Error('Only in tests');
    this.testLimits.dailyCap = cap;
  }

  /** Tests: the per-minute limit, the pause and the screen for this run (over the console's); forgets who sent what. */
  setLimitsForTest(changes: Partial<{ perMinute: number; blocksBeforePause: number; screenOn: boolean }>): void {
    if (env.NODE_ENV !== 'test') throw new Error('Only in tests');
    this.testLimits = { ...this.testLimits, ...changes };
    this.recentSends.clear();
  }

  /** Tests: the console's settings apply again, with no limits of the test's own. */
  clearLimitsForTest(): void {
    if (env.NODE_ENV !== 'test') throw new Error('Only in tests');
    this.testLimits = {};
    this.recentSends.clear();
  }

  /** Tests: the marker in the instructions. */
  canaryForTest(): string {
    if (env.NODE_ENV !== 'test') throw new Error('Only in tests');
    return CANARY;
  }
}

/** The facts of this message for the model: the day, who is asking (by role only), the outlets, the screen and the language. */
function contextBlock(user: AuthUser, outlets: OutletOption[], outlet: OutletOption | null, screen: BuddyScreen): string {
  const now = new Date();
  const day = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
  const time = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).format(now);
  const role = user.memberships.some((m) => m.role === 'OWNER') ? 'Owner' : 'Manager';
  const language = user.contentLanguage.toLowerCase() as AiLanguage;
  return [
    '<app_context>',
    `Today: ${day} (${indiaDate(now)}), ${time}, India time.`,
    `The person: the restaurant's ${role}. Answer in ${AI_LANGUAGE_NAMES[language]} (${language}).`,
    `Outlets they can act for: ${outlets.map((entry) => `${entry.name} (id ${entry.id})`).join('; ') || 'none'}.`,
    `Outlet in view: ${outlet ? `${outlet.name} (id ${outlet.id})` : 'none chosen: ask which outlet when it matters'}.`,
    `Screen they opened Buddy from: ${screen}.`,
    '</app_context>',
  ].join('\n');
}

/** A fixed line in the person's language (falls back to English until it is translated). */
function say(user: AuthUser, key: MessageKey, params?: Record<string, string>): string {
  return translate(user.contentLanguage as LanguageCode, key, params);
}

function cardState(card: CardRow): string {
  if ((card.status === 'PENDING' || card.status === 'FAILED') && card.expiresAt.getTime() <= Date.now()) return 'ran out, not done';
  return { PENDING: 'waiting for the tap', RUNNING: 'being done', DONE: 'done: the person tapped its button and the app carried it out', FAILED: 'failed, can be tried again', CANCELLED: 'cancelled, not done' }[card.status] ?? card.status;
}

function toCardDto(card: CardRow): BuddyCardDto {
  const status = card.status as BuddyCardStatus;
  return {
    id: card.id,
    action: card.action as BuddyCardDto['action'],
    status,
    details: card.details as unknown as BuddyCardDetails,
    expiresAt: card.expiresAt.toISOString(),
    expired: (status === 'PENDING' || status === 'FAILED') && card.expiresAt.getTime() <= Date.now(),
    result: (card.result as unknown as BuddyOpenDto | null) ?? null,
    reference: card.reference,
    error: status === 'FAILED' ? card.error : null,
  };
}

function toMessageDto(row: MessageRow): BuddyMessageDto {
  return {
    id: row.id,
    role: row.role === 'USER' ? 'USER' : 'BUDDY',
    text: row.text,
    createdAt: row.createdAt.toISOString(),
    cards: [...row.cards].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map(toCardDto),
    opens: Array.isArray(row.opens) ? (row.opens as unknown as BuddyOpenDto[]) : [],
    outcome: row.outcome === 'HELPFUL' || row.outcome === 'NOT_HELPFUL' ? row.outcome : null,
  };
}

/** A refused tap, with a code the app puts into words. */
function refused(reason: BuddyCardRefusal) {
  if (reason === 'NOT_FOUND') return new NotFoundException({ message: 'Card not found', code: 'BUDDY_CARD_NOT_FOUND' });
  const message = {
    USED: 'This card has already been used',
    EXPIRED: 'This card has run out. Ask Buddy again.',
    CANCELLED: 'This card was cancelled',
    BUSY: 'This card is being carried out',
  }[reason];
  return new ConflictException({ message, code: `BUDDY_CARD_${reason}` });
}
