import { randomUUID } from 'node:crypto';
import {
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
  type CurrentUserDto,
  type Language,
  type LinkedDeviceDto,
  type Role,
  type SessionDto,
} from '@eccs/shared';
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
      organization: { select: { name: true } },
      outlet: { select: { name: true, organizationId: true } },
    },
  },
} as const;

const otpHash = (challengeId: string, code: string) => sha256(`${challengeId}:${code}`);

@Injectable()
export class AuthService {
  private readonly linkAttempts = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotifyService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  // ───────────────────────── One-time code ─────────────────────────

  private otpUser(phone: string) {
    return this.db.user.findFirst({
      where: { phone, isActive: true, memberships: { some: { role: { in: OTP_ROLES } } } },
      include: userInclude,
    });
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
    const challenge = await this.db.otpChallenge.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge || challenge.attempts >= OTP_MAX_ATTEMPTS) {
      throw new UnauthorizedException(WRONG_CODE);
    }

    if (!safeEqualHex(otpHash(challenge.id, code), challenge.codeHash)) {
      await this.db.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      throw new UnauthorizedException(WRONG_CODE);
    }

    const user = await this.otpUser(phone);
    if (!user) {
      throw new UnauthorizedException(WRONG_CODE);
    }
    await this.db.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });

    const ownerOf = user.memberships.find((m) => m.role === 'OWNER' && m.organizationId);
    if (!ownerOf?.organizationId) {
      return this.startSession(user, deviceName);
    }

    const device = await this.createLinkedDevice(ownerOf.organizationId, null, deviceName);
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
      throw new NotFoundException('That restaurant code was not found. Check it and try again.');
    }

    const device = await this.createLinkedDevice(outlet.organizationId, outlet.id, deviceName);
    await this.notify.deviceLinked(outlet.id);
    return { deviceToken: device.token, organizationName: outlet.organization.name, outletName: outlet.name };
  }

  /**
   * Logs in with a PIN from a linked phone. The PIN decides who it is:
   * on a phone linked to an outlet it may be the owner or anyone at that
   * outlet; on an owner's phone it may be anyone in the organisation.
   */
  async pinLogin(deviceToken: string, pin: string): Promise<SessionDto> {
    const device = await this.db.linkedDevice.findUnique({ where: { tokenHash: sha256(deviceToken) } });
    if (!device || device.revokedAt) {
      throw new UnauthorizedException({
        code: AUTH_ERROR.deviceNotLinked,
        message: 'This phone is not linked to a restaurant. Enter the restaurant code again.',
      });
    }
    if (device.pinLockedUntil && device.pinLockedUntil > new Date()) {
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
      // The wrong PIN that causes the lock is told so at once, so the app can show the wait straight away.
      if (lockedUntil) {
        await this.notify.pinLocked(device);
        throw pinLocked(lockedUntil);
      }
      throw new UnauthorizedException('Wrong PIN');
    }

    await this.db.linkedDevice.update({
      where: { id: device.id },
      data: { failedPinAttempts: 0, pinLockedUntil: null, lastUsedAt: new Date() },
    });
    return this.startSession(user, device.name ?? undefined, device.id);
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

    if (Date.now() - session.lastUsedAt.getTime() > LAST_USED_REFRESH_MS) {
      await this.db.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
    }

    return { ...toDto(session.user), sessionId: session.id, contentLanguage: session.user.language };
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
