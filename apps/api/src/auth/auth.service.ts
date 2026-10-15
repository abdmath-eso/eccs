import { randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { generatePin, normalizeOutletCode, pinLookup, Prisma } from '@eccs/db';
import {
  AUTH_ERROR,
  ECCS_ROLES,
  isEccsRole,
  mainRole,
  maskPhone,
  type CurrentUserDto,
  type Language,
  type LinkedDeviceDto,
  type Role,
  type SessionDto,
} from '@eccs/shared';
import { noteActivity } from '../activity-log/activity-context.js';
import { ActivityLogService } from '../activity-log/activity-log.service.js';
import { env } from '../config/env.js';
import { NotifyService } from '../notifications/notify.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { newToken, randomOtp, safeEqualHex, sha256 } from './auth.crypto.js';
import type { AuthUser } from './auth.types.js';

const OTP_TTL_SECONDS = 5 * 60;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_REQUESTS = 5;
const OTP_REQUEST_WINDOW_MS = 10 * 60 * 1000;
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCK_MS = 15 * 60 * 1000;

/**
 * The answer while a phone is locked after too many wrong PINs. The seconds left
 * are written after the reason ("PIN_LOCKED:540") so the app can count them down.
 */
function pinLocked(until: Date): HttpException {
  const seconds = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000));
  return new HttpException(
    { code: `PIN_LOCKED:${seconds}`, message: `Too many wrong PINs. Try again in ${Math.ceil(seconds / 60)} minutes.` },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
const LINK_MAX_PER_MINUTE = 10;
const LAST_USED_REFRESH_MS = 5 * 60 * 1000;

const WRONG_CODE = 'That code is wrong or has expired';

// Only ECCS staff and restaurant owners ever use a one-time code.
const OTP_ROLES: Role[] = [...ECCS_ROLES, 'OWNER'];

const userInclude = {
  memberships: {
    include: {
      organization: { select: { name: true, isActive: true } },
      outlet: { select: { name: true, organizationId: true, isActive: true, organization: { select: { isActive: true } } } },
    },
  },
} as const;

/**
 * The person with only the roles that still count. ECCS can switch an outlet,
 * or a whole client, off in the console: a role at a place that is switched
 * off is left out, so its Manager and Head Chefs cannot log in while the Owner
 * (whose role is at the client, not the outlet) still can. Someone left with no
 * role at all cannot log in. Switching the place back on restores everything.
 */
function withLiveRoles<
  T extends {
    memberships: {
      organization: { isActive: boolean } | null;
      outlet: { isActive: boolean; organization: { isActive: boolean } } | null;
    }[];
  },
>(user: T): T {
  return {
    ...user,
    memberships: user.memberships.filter(
      (m) => (m.organization?.isActive ?? true) && (m.outlet?.isActive ?? true) && (m.outlet?.organization.isActive ?? true),
    ),
  };
}

const otpHash = (challengeId: string, code: string) => sha256(`${challengeId}:${code}`);

@Injectable()
export class AuthService {
  private readonly linkAttempts = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotifyService,
    private readonly activity: ActivityLogService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  // ───────────────────────── One-time code ─────────────────────────

  private async otpUser(phone: string) {
    const user = await this.db.user.findFirst({
      where: { phone, isActive: true, memberships: { some: { role: { in: OTP_ROLES } } } },
      include: userInclude,
    });
    if (!user) return null;
    // The Owner of a client ECCS has switched off is treated like an unknown number.
    const live = withLiveRoles(user);
    return live.memberships.some((m) => OTP_ROLES.includes(m.role)) ? live : null;
  }

  /**
   * Starts a one-time-code login. The response is the same whether or not
   * the phone belongs to someone, so it cannot be used to discover accounts.
   */
  async requestOtp(phone: string): Promise<{ expiresInSeconds: number }> {
    const recent = await this.db.otpChallenge.count({
      where: { phone, createdAt: { gt: new Date(Date.now() - OTP_REQUEST_WINDOW_MS) } },
    });
    if (recent >= OTP_MAX_REQUESTS) {
      throw new HttpException('Too many codes requested. Try again in a few minutes.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const user = await this.otpUser(phone);
    // The activity log keeps the last four digits only, and never the code.
    noteActivity({
      details: { phoneLast4: maskPhone(phone) },
      ...(user && { side: user.memberships.some((m) => isEccsRole(m.role)) ? ('eccs' as const) : ('restaurant' as const) }),
    });

    let code: string;
    if (env.DEV_FIXED_OTP) {
      code = env.DEV_FIXED_OTP;
    } else {
      // Real SMS and email delivery are not wired up yet; see docs/STATUS.md.
      throw new ServiceUnavailableException('Code delivery is not configured');
    }

    const id = randomUUID();
    await this.db.otpChallenge.create({
      data: {
        id,
        phone,
        // An unknown phone gets a challenge nobody can pass.
        codeHash: otpHash(id, user ? code : randomOtp() + randomUUID()),
        expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
      },
    });

    return { expiresInSeconds: OTP_TTL_SECONDS };
  }

  /**
   * Completes a one-time-code login. For a restaurant owner this is the
   * onboarding step: it links the phone to their restaurant and, the first
   * time (or when resetPin is set), creates their PIN.
   */
  async verifyOtp(phone: string, code: string, deviceName?: string, resetPin = false): Promise<SessionDto> {
    // For the activity log: the last four digits only, never the code. The full number stays in memory,
    // only to tell an ECCS staff phone from a restaurant's when the code is wrong.
    noteActivity({ details: { phoneLast4: maskPhone(phone) }, lookupPhone: phone });
    const challenge = await this.db.otpChallenge.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge || challenge.attempts >= OTP_MAX_ATTEMPTS) {
      noteActivity({ action: 'auth.otp.wrong' });
      throw new UnauthorizedException(WRONG_CODE);
    }

    if (!safeEqualHex(otpHash(challenge.id, code), challenge.codeHash)) {
      await this.db.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      noteActivity({ action: 'auth.otp.wrong' });
      throw new UnauthorizedException(WRONG_CODE);
    }

    const user = await this.otpUser(phone);
    if (!user) {
      noteActivity({ action: 'auth.otp.wrong' });
      throw new UnauthorizedException(WRONG_CODE);
    }
    await this.db.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });

    const ownerOf = user.memberships.find((m) => m.role === 'OWNER' && m.organizationId);
    if (!ownerOf?.organizationId) {
      return this.startSession(user, deviceName);
    }

    const device = await this.createLinkedDevice(ownerOf.organizationId, null, deviceName);
    noteActivity({ organizationId: ownerOf.organizationId, details: { deviceLinked: true, setUpAgain: !user.pinLookup || resetPin } });
    const generatedPin =
      !user.pinLookup || resetPin ? await this.assignPin(user.id, ownerOf.organizationId) : undefined;
    const session = await this.startSession(user, deviceName, device.id);
    return {
      ...session,
      linkedDevice: {
        deviceToken: device.token,
        organizationName: ownerOf.organization?.name ?? '',
        outletName: null,
      },
      ...(generatedPin && { generatedPin }),
    };
  }

  // ───────────────────────── Restaurant code and PIN ─────────────────────────

  /** Links a phone to an outlet, once, using the outlet's restaurant code. */
  async linkDevice(code: string, deviceName: string | undefined, clientAddress: string): Promise<LinkedDeviceDto> {
    this.limitLinkAttempts(clientAddress);

    const outlet = await this.db.outlet.findFirst({
      where: { code: normalizeOutletCode(code), isActive: true, organization: { isActive: true } },
      select: { id: true, name: true, organizationId: true, organization: { select: { name: true } } },
    });
    if (!outlet) {
      // The code typed is never logged: it is what links a phone to a kitchen.
      noteActivity({ action: 'auth.device.wrongCode' });
      throw new NotFoundException('That restaurant code was not found. Check it and try again.');
    }

    const device = await this.createLinkedDevice(outlet.organizationId, outlet.id, deviceName);
    noteActivity({ organizationId: outlet.organizationId, outletId: outlet.id, deviceId: device.id });
    await this.notify.deviceLinked(outlet.id);
    return { deviceToken: device.token, organizationName: outlet.organization.name, outletName: outlet.name };
  }

  /**
   * Logs in with a PIN from a linked phone. The PIN decides who it is:
   * on a phone linked to an outlet it may be the owner or anyone at that
   * outlet; on an owner's phone it may be anyone in the organisation.
   */
  async pinLogin(deviceToken: string, pin: string): Promise<SessionDto> {
    const device = await this.requireLinkedDevice(deviceToken);
    // The phone and its outlet, right PIN or wrong; never the PIN, and on a wrong one not who it was meant to be.
    noteActivity({ organizationId: device.organizationId, outletId: device.outletId, deviceId: device.id });
    const live = await this.checkPin(device, pin);
    return this.startSession(live, device.name ?? undefined, device.id);
  }

  /**
   * The linked phone a device token belongs to. A linked phone identifies its
   * outlet without anyone being logged in; face attendance relies on this too.
   */
  async requireLinkedDevice(deviceToken: string) {
    const device = await this.db.linkedDevice.findUnique({ where: { tokenHash: sha256(deviceToken) } });
    if (!device || device.revokedAt) {
      throw new UnauthorizedException({
        code: AUTH_ERROR.deviceNotLinked,
        message: 'This phone is not linked to a restaurant. Enter the restaurant code again.',
      });
    }
    return device;
  }

  /**
   * Checks a PIN typed on a linked phone and answers who it belongs to. Wrong
   * PINs are counted on the phone and lock it after five, whatever the PIN was
   * typed for: logging in, or approving an assisted clock-in. One counter, so
   * the second use cannot be turned into extra guesses at the first.
   */
  async checkPin(device: { id: string; organizationId: string; outletId: string | null; failedPinAttempts: number; pinLockedUntil: Date | null }, pin: string) {
    if (device.pinLockedUntil && device.pinLockedUntil > new Date()) {
      noteActivity({ action: 'auth.pin.whileLocked' });
      throw pinLocked(device.pinLockedUntil);
    }

    const user = await this.db.user.findFirst({
      where: {
        pinOrganizationId: device.organizationId,
        pinLookup: pinLookup(env.PIN_SECRET, device.organizationId, pin),
        isActive: true,
        memberships: {
          some: device.outletId
            ? { OR: [{ role: 'OWNER', organizationId: device.organizationId }, { outletId: device.outletId }] }
            : { organizationId: device.organizationId },
        },
      },
      include: userInclude,
    });

    if (!user) {
      const attempts = device.failedPinAttempts + 1;
      const lockedUntil = attempts >= PIN_MAX_ATTEMPTS ? new Date(Date.now() + PIN_LOCK_MS) : null;
      await this.db.linkedDevice.update({
        where: { id: device.id },
        data: {
          failedPinAttempts: lockedUntil ? 0 : attempts,
          pinLockedUntil: lockedUntil,
        },
      });
      noteActivity({ action: 'auth.pin.wrong', details: { wrongInARow: lockedUntil ? PIN_MAX_ATTEMPTS : attempts } });
      // The wrong PIN that causes the lock is told so at once, so the app can show the wait straight away.
      if (lockedUntil) {
        // A row of its own in the activity log: which phone and outlet, never the PINs tried.
        this.activity.event('auth.pin.locked', {
          result: 'REFUSED',
          organizationId: device.organizationId,
          outletId: device.outletId,
          deviceId: device.id,
          side: 'restaurant',
          details: { lockedMinutes: PIN_LOCK_MS / 60_000 },
        });
        await this.notify.pinLocked(device);
        throw pinLocked(lockedUntil);
      }
      throw new UnauthorizedException('Wrong PIN');
    }

    // The PIN is right, but ECCS has switched this person's outlet (or the whole
    // restaurant) off. Said plainly, and not counted as a wrong PIN.
    const live = withLiveRoles(user);
    if (live.memberships.length === 0) {
      throw new ForbiddenException({
        code: AUTH_ERROR.restaurantInactive,
        message: 'This restaurant is not active with ECCS at the moment. Please call ECCS.',
      });
    }

    await this.db.linkedDevice.update({
      where: { id: device.id },
      data: { failedPinAttempts: 0, pinLockedUntil: null, lastUsedAt: new Date() },
    });
    return live;
  }

  /** Gives a restaurant user a new random PIN, unique within the organisation. Returns it once. */
  async assignPin(userId: string, organizationId: string): Promise<string> {
    for (let attempt = 0; attempt < 25; attempt++) {
      const pin = generatePin();
      try {
        await this.db.user.update({
          where: { id: userId },
          data: { pinOrganizationId: organizationId, pinLookup: pinLookup(env.PIN_SECRET, organizationId, pin) },
        });
        return pin;
      } catch (error) {
        const taken = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!taken) throw error;
      }
    }
    throw new ServiceUnavailableException('Could not generate a PIN. Try again.');
  }

  /** Logs a user out everywhere, for example after their PIN is reset or they are deactivated. */
  async revokeSessions(userId: string): Promise<void> {
    await this.db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  // ───────────────────────── Sessions ─────────────────────────

  /** Resolves a bearer token to its user, or null if the session is not valid. */
  async authenticate(token: string): Promise<AuthUser | null> {
    const session = await this.db.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: { include: userInclude } },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.user.isActive) {
      return null;
    }
    // Checked on every request, so switching an outlet off in the console logs its staff out at once.
    const user = withLiveRoles(session.user);
    if (user.memberships.length === 0) return null;

    if (Date.now() - session.lastUsedAt.getTime() > LAST_USED_REFRESH_MS) {
      await this.db.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
    }

    return { ...toDto(user), sessionId: session.id, contentLanguage: user.language, linkedDeviceId: session.linkedDeviceId };
  }

  async logout(sessionId: string): Promise<void> {
    await this.db.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
  }

  async updateProfile(userId: string, data: { name?: string | undefined; language?: Language | undefined }) {
    const user = await this.db.user.update({
      where: { id: userId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.language !== undefined && { language: data.language }),
      },
      include: userInclude,
    });
    return toDto(user);
  }

  private async startSession(user: UserWithMemberships, deviceName?: string, linkedDeviceId?: string): Promise<SessionDto> {
    // Who logged in, for the activity log (the request itself had no login yet).
    noteActivity({
      actor: { id: user.id, name: user.name, role: mainRole(user.memberships.map((m) => m.role)) },
      ...(linkedDeviceId && { deviceId: linkedDeviceId }),
    });
    const token = newToken();
    const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await this.db.session.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        deviceName: deviceName ?? null,
        linkedDeviceId: linkedDeviceId ?? null,
        expiresAt,
      },
    });
    return { token, expiresAt: expiresAt.toISOString(), user: toDto(user) };
  }

  private async createLinkedDevice(organizationId: string, outletId: string | null, name?: string) {
    const token = newToken();
    const device = await this.db.linkedDevice.create({
      data: { organizationId, outletId, tokenHash: sha256(token), name: name ?? null },
    });
    return { id: device.id, token };
  }

  // Restaurant codes are long enough not to be guessable; this only stops
  // one client hammering the endpoint. It is per API process, which is
  // enough for now and should move to Redis when there is more than one.
  private limitLinkAttempts(clientAddress: string) {
    const now = Date.now();
    const entry = this.linkAttempts.get(clientAddress);
    if (!entry || entry.resetAt <= now) {
      this.linkAttempts.set(clientAddress, { count: 1, resetAt: now + 60_000 });
      return;
    }
    entry.count += 1;
    if (entry.count > LINK_MAX_PER_MINUTE) {
      throw new HttpException('Too many attempts. Wait a minute and try again.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}

type UserWithMemberships = {
  id: string;
  phone: string | null;
  name: string;
  language: Language;
  memberships: {
    role: Role;
    organizationId: string | null;
    outletId: string | null;
    organization: { name: string } | null;
    outlet: { name: string; organizationId: string } | null;
  }[];
};

function toDto(user: UserWithMemberships): CurrentUserDto {
  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    language: user.language,
    memberships: user.memberships.map((m) => ({
      role: m.role,
      organizationId: m.organizationId ?? m.outlet?.organizationId ?? null,
      organizationName: m.organization?.name ?? null,
      outletId: m.outletId,
      outletName: m.outlet?.name ?? null,
    })),
  };
}
