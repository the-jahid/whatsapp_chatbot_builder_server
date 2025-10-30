// ===================================================
// 2. The Simple Authentication Guard (auth/auth.guard.ts)
// This is the new, simpler guard. Its only job is to check if the `auth`
// object exists on the request.
// ===================================================
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // Get the request object from the execution context
    const request = context.switchToHttp().getRequest();

    // The AuthMiddleware should have attached the 'auth' object.
    // We simply check for its existence.
    // If it exists, the user is authenticated.
    return !!request.auth;
  }
}
