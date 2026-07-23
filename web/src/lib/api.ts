import { ofetch, type FetchError } from "ofetch";
import { toBase64Utf8 } from "@/lib/base64";

/** Shared ofetch client. All calls are same-origin `/api/...` (dev proxy / prod Go server). */
export const api = ofetch.create({
  baseURL: "/api",
});

/** `Bearer <token>` — used by WHEP, which sends the raw stream key. */
export function bearer(token: string): string {
  return `Bearer ${token}`;
}

/** `Bearer <base64(token)>` — used by WHIP, profiles, and admin endpoints. */
export function base64Bearer(token: string | null | undefined): string {
  return `Bearer ${toBase64Utf8(token)}`;
}

/** Extracts an HTTP status code from an ofetch error, if present. */
export function getErrorStatus(error: unknown): number | undefined {
  const fetchError = error as FetchError | undefined;
  return fetchError?.response?.status ?? fetchError?.statusCode;
}
