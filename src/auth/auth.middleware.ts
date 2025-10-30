// ===================================================
// 1. Authentication Middleware (auth/auth.middleware.ts)
// This file remains the same. Its job is to verify the JWT and attach the user's
// auth claims to the request object.
// ===================================================
import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { Clerk } from '@clerk/clerk-sdk-node';

// This extends the Express Request interface to include our 'auth' property
declare global {
  namespace Express {
    interface Request {
      auth?: any;
    }
  }
}

const clerk = Clerk({ secretKey: process.env.CLERK_SECRET_KEY });

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  async use(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;


    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Bearer token is missing or invalid.');
    }

    const token = authHeader.split(' ')[1];

    try {
      const claims = await clerk.verifyToken(token);
      req.auth = claims; // Attach claims to the request
      next();
    } catch (error) {
      console.error('Token verification failed:', error);
      throw new UnauthorizedException('Invalid token.');
    }
  }
}



