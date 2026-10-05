import { randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { CurrentUserDto, SessionDto } from '@eccs/shared';
import { env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashPin, newSessionToken, randomOtp, safeEqualHex, sha256, verifyPinHash } from './auth.crypto.js';
import type { AuthUser } from './auth.types.js';

const OTP_TTL_SECONDS = 5 * 60;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_REQUESTS = 5;
const OTP_REQUEST_WINDOW_MS = 10 * 60 * 1000;
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCK_MS = 15 * 60 * 1000;
const LAST_USED_REFRESH_MS = 5 * 60 * 1000;

const WRONG_CODE = 'That code is wrong or has expired';

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
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  /**
   * Starts a login. The response is the same whether or not the phone
   * belongs to a user, so the endpoint cannot be used to discover accounts.
   */
  async requestOtp(phone: string): Promise<{ expiresInSeconds: number }> {
    const recent = await this.db.otpChallenge.count({
      where: { phone, createdAt: { gt: new Date(Date.now() - OTP_REQUEST_WINDOW_MS) } },
    });
    if (recent >= OTP_MAX_REQUESTS) {
      throw new HttpException('Too many codes requested. Try again in a few minutes.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const user = await this.db.user.findFirst({ where: { phone, isActive: true }, select: { id: true } });

    let code: string;
    if (env.DEV_FIXED_OTP) {
      code = env.DEV_FIXED_OTP;
    } else {
      // Real SMS (MSG91) is not wired up yet; see docs/STATUS.md.
      throw new ServiceUnavailableException('SMS sending is not configured');
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

  async verifyOtp(phone: string, code: string, deviceName?: string): Promise<SessionDto> {
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

    const user = await this.db.user.findFirst({ where: { phone, isActive: true }, include: userInclude });
    if (!user) {
      throw new UnauthorizedException(WRONG_CODE);
    }

    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await this.db.$transaction([
      this.db.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } }),
      this.db.session.create({
        data: { userId: user.id, tokenHash: sha256(token), deviceName: deviceName ?? null, expiresAt },
      }),
    ]);

    return { token, expiresAt: expiresAt.toISOString(), user: toDto(user) };
  }

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

    return { ...toDto(session.user), sessionId: session.id };
  }

  async logout(sessionId: string): Promise<void> {
    await this.db.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
  }

  async updateProfile(userId: string, data: { name?: string | undefined; language?: 'EN' | 'TE' | 'HI' | undefined }) {
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

  async setPin(userId: string, pin: string): Promise<void> {
    await this.db.user.update({
      where: { id: userId },
      data: { pinHash: await hashPin(pin), pinFailedAttempts: 0, pinLockedUntil: null },
    });
  }

  /** Checks the PIN that unlocks Manager and Owner areas on a shared phone. */
  async verifyPin(userId: string, pin: string): Promise<void> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.pinHash) {
      throw new ForbiddenException('No PIN has been set');
    }
    if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
      throw new HttpException('Too many wrong PINs. Try again in 15 minutes.', HttpStatus.TOO_MANY_REQUESTS);
    }

    if (await verifyPinHash(pin, user.pinHash)) {
      if (user.pinFailedAttempts > 0 || user.pinLockedUntil) {
        await this.db.user.update({ where: { id: userId }, data: { pinFailedAttempts: 0, pinLockedUntil: null } });
      }
      return;
    }

    const attempts = user.pinFailedAttempts + 1;
    const locked = attempts >= PIN_MAX_ATTEMPTS;
    await this.db.user.update({
      where: { id: userId },
      data: {
        pinFailedAttempts: locked ? 0 : attempts,
        pinLockedUntil: locked ? new Date(Date.now() + PIN_LOCK_MS) : null,
      },
    });
    throw new ForbiddenException('Wrong PIN');
  }
}

type UserWithMemberships = {
  id: string;
  phone: string;
  name: string;
  language: 'EN' | 'TE' | 'HI';
  pinHash: string | null;
  memberships: {
    role: CurrentUserDto['memberships'][number]['role'];
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
    hasPin: user.pinHash !== null,
    memberships: user.memberships.map((m) => ({
      role: m.role,
      organizationId: m.organizationId ?? m.outlet?.organizationId ?? null,
      organizationName: m.organization?.name ?? null,
      outletId: m.outletId,
      outletName: m.outlet?.name ?? null,
    })),
  };
}
