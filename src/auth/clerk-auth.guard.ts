// src/auth/clerk-auth.guard.ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { verifyToken } from '@clerk/backend';
import { IS_PUBLIC_KEY } from 'src/common/decorators/public.decorator';

type ReqWithAuth = Request & {
  auth?: { clerkUserId?: string; sessionId?: string; claims?: Record<string, any> };
};

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(private reflector: Reflector) { }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // Check for @Public() decorator
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = ctx.switchToHttp().getRequest<ReqWithAuth>();

    // 1) Authorization: Bearer <session-token>
    const header = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Bearer token');
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) throw new UnauthorizedException('Empty Bearer token');

    // 2) Prefer networkless verification with the PEM public key.
    //    Fallback to SECRET KEY (will fetch JWKS).
    const jwtKey = process.env.CLERK_JWT_KEY?.trim();       // Recommended (no network).
    const secretKey = process.env.CLERK_SECRET_KEY?.trim(); // OK too

    if (!jwtKey && !secretKey) {
      throw new UnauthorizedException('Server misconfigured: set CLERK_JWT_KEY or CLERK_SECRET_KEY');
    }

    try {
      const claims = await verifyToken(token, {
        secretKey,           // else verifies via JWKS
        // If you want to pin to your frontend origin(s):
        // authorizedParties: ['http://localhost:3000', 'https://yourapp.com'],
        // audience: ['your-api-audience'], // only if you use templates that set aud
      });

      const clerkUserId = claims.sub;
      const sessionId = claims.sid;

      if (!clerkUserId) {
        throw new UnauthorizedException('Invalid token claims (missing sub).');
      }

      req.auth = { clerkUserId, sessionId, claims };
      return true;
    } catch (e: any) {
      // Common causes:
      // - Wrong instance keys (token from one Clerk instance, server using another)
      // - azp/aud mismatch if you set authorizedParties/audience
      // - Clock skew beyond default tolerance
      // - No outbound network while using secretKey (use CLERK_JWT_KEY to avoid network)
      throw new UnauthorizedException(e?.message || 'Invalid or expired Clerk session token');
    }
  }
}
