import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clearAdminToken,
  getAdminAuthorizationHeader,
  isInvalidAdminSessionResponse,
} from "@/lib/admin-auth";
import { api, getErrorStatus } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import type { AdminProfile, StatusResult } from "@/lib/types";

interface LoginResponse {
  isValid: boolean;
  errorMessage: string;
}

const ADMIN_STATUS_POLL_INTERVAL_MS = 5000;

/** Clears the stored token when the backend reports an invalid admin session. */
function handleAdminError(error: unknown): void {
  const status = getErrorStatus(error);
  if (status !== undefined && isInvalidAdminSessionResponse(status)) {
    clearAdminToken();
  }
}

async function adminGet<T>(path: string): Promise<T> {
  try {
    return await api<T>(path, { headers: { Authorization: getAdminAuthorizationHeader() } });
  } catch (error) {
    handleAdminError(error);
    throw error;
  }
}

async function adminGetText(path: string): Promise<string> {
  try {
    // Note: no explicit type argument — that would disable `responseType` inference.
    return await api(path, {
      headers: { Authorization: getAdminAuthorizationHeader() },
      responseType: "text",
    });
  } catch (error) {
    handleAdminError(error);
    throw error;
  }
}

async function adminPost(path: string, streamKey: string): Promise<void> {
  try {
    await api(path, {
      method: "POST",
      headers: { Authorization: getAdminAuthorizationHeader() },
      body: { streamKey },
    });
  } catch (error) {
    handleAdminError(error);
    throw error;
  }
}

/** Validates a token against `POST /api/admin/login`. */
export async function verifyAdminToken(token: string): Promise<LoginResponse> {
  return api<LoginResponse>("/admin/login", {
    method: "POST",
    headers: { Authorization: getAdminAuthorizationHeader(token) },
  });
}

export function useAdminStatusQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "status"],
    enabled,
    refetchInterval: ADMIN_STATUS_POLL_INTERVAL_MS,
    queryFn: () => adminGet<StatusResult[]>("/admin/status"),
  });
}

export function useAdminProfilesQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "profiles"],
    enabled,
    queryFn: () => adminGet<AdminProfile[]>("/admin/profiles"),
  });
}

export function useAdminLoggingQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "logging"],
    enabled,
    queryFn: async (): Promise<string> => {
      const text = await adminGetText("/admin/logging");
      // Newest lines first.
      return text.split("\n").reverse().join("\n");
    },
  });
}

function useProfileMutation(path: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (streamKey: string) => adminPost(path, streamKey),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "profiles"] }),
    onError: () => toast.add({ description: "The profile action failed.", type: "error" }),
  });
}

export function useAddProfileMutation() {
  return useProfileMutation("/admin/profiles/add-profile");
}

export function useRemoveProfileMutation() {
  return useProfileMutation("/admin/profiles/remove-profile");
}

export function useResetTokenMutation() {
  return useProfileMutation("/admin/profiles/reset-token");
}
