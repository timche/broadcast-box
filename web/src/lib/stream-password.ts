import { api } from "@/lib/api";

const STREAM_PASSWORD_STORAGE_KEY = "streamPassword";

export interface StreamPasswordState {
  required: boolean;
  /** Empty unless the site gate is what let this request through. */
  password: string;
}

/** Asks the server whether publishing needs a password, and for it if it may. */
export function fetchStreamPasswordState(): Promise<StreamPasswordState> {
  return api<StreamPasswordState>("/stream-password");
}

/**
 * Resolves the password to publish with.
 *
 * Someone already past the site gate is handed it by the server, so publishing
 * from the browser does not ask for a second secret. The stored value is the
 * fallback for the case the server withholds it — a server with a stream
 * password but no site password, where there is no gate to have passed.
 */
export async function resolveStreamPassword(): Promise<string> {
  try {
    const state = await fetchStreamPasswordState();

    if (state.password !== "") {
      // Remembered so a later attempt still has it if the endpoint is briefly
      // unreachable.
      setStreamPassword(state.password);

      return state.password;
    }
  } catch {
    // Fall through to whatever was typed earlier this session.
  }

  return getStreamPassword();
}

/**
 * The password a broadcaster prefixes to their stream key when the server
 * requires one.
 *
 * It cannot be read from the site password the browser is already holding:
 * that lives in the browser's own HTTP authentication cache, which is not
 * reachable from scripts. A broadcaster publishing from the browser therefore
 * types it once per session.
 *
 * `sessionStorage`, not `localStorage`: a credential should not outlive the
 * tab it was typed into.
 */
export function getStreamPassword(): string {
  try {
    return sessionStorage.getItem(STREAM_PASSWORD_STORAGE_KEY) ?? "";
  } catch {
    // Private windows and blocked site data throw rather than returning null.
    return "";
  }
}

export function setStreamPassword(password: string): void {
  try {
    sessionStorage.setItem(STREAM_PASSWORD_STORAGE_KEY, password);
  } catch {
    // Publishing still works for this attempt; only the remembering is lost.
  }
}

export function clearStreamPassword(): void {
  try {
    sessionStorage.removeItem(STREAM_PASSWORD_STORAGE_KEY);
  } catch {
    // Nothing to do: the value was never stored.
  }
}
