// Minimal helpers to keep controllers clean and consistent.

export type ApiStatus = 'ok' | 'created' | 'connecting' | 'open' | 'close' | 'error';

export function ok<T>(data: T, message?: string) {
  return { code: 200, status: 'ok' as ApiStatus, ...(message ? { message } : {}), data };
}

export function created<T>(data: T, message?: string) {
  return { code: 201, status: 'created' as ApiStatus, ...(message ? { message } : {}), data };
}
