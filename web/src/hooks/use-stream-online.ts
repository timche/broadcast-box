import { useQuery } from "@tanstack/react-query";
import { api, getErrorStatus } from "@/lib/api";
import type { StreamStatus } from "@/lib/types";

/**
 * Polls whether a stream is currently live (`GET /api/status?key=`). Returns
 * false while the name is empty or the stream has no active publisher (404).
 */
export function useStreamOnline(streamName: string): boolean {
  const name = streamName.trim();

  const { data = false } = useQuery({
    queryKey: ["stream-online", name],
    enabled: name !== "",
    refetchInterval: 5000,
    queryFn: async () => {
      try {
        // Force JSON parsing: the status endpoint sets its Content-Type too late,
        // so ofetch would otherwise hand back an unparsed string.
        const status = await api<StreamStatus>("/status", {
          query: { key: name },
          responseType: "json",
        });
        return status.isOnline;
      } catch (error) {
        if (getErrorStatus(error) === 404) {
          return false;
        }
        throw error;
      }
    },
  });

  return data;
}
