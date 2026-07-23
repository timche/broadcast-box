/**
 * Encodes a string as base64 of its UTF-8 bytes. Used for the WHIP and admin
 * `Authorization: Bearer` headers, which the backend resolves via
 * `ResolveBearerToken` (accepts both base64 and raw tokens).
 */
export function toBase64Utf8(input: string | null | undefined): string {
  const utf8Bytes = new TextEncoder().encode(input ?? "");
  let binary = "";
  for (const byte of utf8Bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
