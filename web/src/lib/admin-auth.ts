import { base64Bearer } from "@/lib/api";

export const ADMIN_TOKEN_STORAGE_KEY = "adminToken";

export function getAdminToken(): string | null {
  return localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
}

export function setAdminToken(token: string): void {
  localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
}

export function clearAdminToken(): void {
  localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
}

/** Admin endpoints authenticate with a base64-encoded bearer token. */
export function getAdminAuthorizationHeader(token?: string | null): string {
  return base64Bearer(token ?? getAdminToken());
}

/** The backend returns 4xx for an invalid/expired admin session. */
export function isInvalidAdminSessionResponse(status: number): boolean {
  return status > 400 && status < 500;
}
