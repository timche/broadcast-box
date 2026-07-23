import { useQuery } from "@tanstack/react-query";
import { api, getErrorStatus } from "@/lib/api";
import type { StatusResult } from "@/lib/types";

export const STATUS_POLL_INTERVAL_MS = 5000;

/**
 * Polls `GET /api/status` for the list of public live streams. A `503` means the
 * status API is disabled server-side, which we surface as an empty list.
 */
export function useStatusQuery(enabled = true) {
  return useQuery({
    queryKey: ["status"],
    enabled,
    refetchInterval: STATUS_POLL_INTERVAL_MS,
    queryFn: async (): Promise<StatusResult[]> => {
      try {
        return await api<StatusResult[]>("/status");
      } catch (error) {
        if (getErrorStatus(error) === 503) {
          return [];
        }
        throw error;
      }
    },
  });
}
