// src/user/services/user.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateUserDto, UpdateUserDto } from '../schemas/user.schema';

type AuthContext = {
  clerkUserId?: string;   // set by ClerkAuthGuard on req.auth
  sessionId?: string;     // not used here, but available
};

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create a user directly (usually not used in Clerk flow).
   * Throws on unique-constraint violations (email/oauthId).
   */
  async createUser(data: CreateUserDto): Promise<User> {
    return this.prisma.user.create({ data });
  }

  /**
   * Upsert user from Clerk webhook (idempotent for retries).
   */
  async getOrCreateByOauth(input: {
    oauthId: string;
    email: string;
    username?: string;
  }): Promise<User> {
    const { oauthId, email, username } = input;
    return this.prisma.user.upsert({
      where: { oauthId },
      create: { oauthId, email, username },
      update: {
        ...(email ? { email } : {}),
        ...(typeof username !== 'undefined' ? { username } : {}),
      },
    });
  }

  /**
   * Update a user by Clerk oauthId.
   * Throws 404 if not found.
   */
  async updateUser(oauthId: string, data: UpdateUserDto): Promise<User> {
    const user = await this.requireByOauthId(oauthId);
    return this.prisma.user.update({
      where: { id: user.id },
      data,
    });
  }

  /**
   * Delete a user by Clerk oauthId.
   * Throws 404 if not found.
   */
  async deleteUser(oauthId: string): Promise<User> {
    const user = await this.requireByOauthId(oauthId);
    return this.prisma.user.delete({
      where: { id: user.id },
    });
  }

  // ------------------------------
  // Lookup helpers
  // ------------------------------

  /** Find by internal UUID (nullable). */
  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /** Require by internal UUID (throws 404). */
  async requireById(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException(`User with ID "${id}" not found.`);
    return user;
  }

  /** Find by Clerk oauthId (nullable). */
  async findByOauthId(oauthId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { oauthId } });
  }

  /** Require by Clerk oauthId (throws 404). */
  async requireByOauthId(oauthId: string): Promise<User> {
    const user = await this.findByOauthId(oauthId);
    if (!user) {
      throw new NotFoundException(`User with OAuth ID "${oauthId}" not found.`);
    }
    return user;
  }

  /**
   * Resolve current user from the auth context set by ClerkAuthGuard.
   * Throws 404 if the local user record doesn’t exist.
   */
  async getFromAuth(auth: AuthContext): Promise<User> {
    const clerkUserId = auth?.clerkUserId;
    if (!clerkUserId) {
      // Guard should have set this; treat as not-found for local mapping
      throw new NotFoundException('User not found for this session.');
    }
    return this.requireByOauthId(clerkUserId);
  }
}
