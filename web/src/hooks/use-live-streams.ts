import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { StatusResult } from "@/lib/types";

export interface LiveStream {
  name: string;
  viewers: number;
}

/**
 * Polls the streams that are live right now (`GET /api/status`), busiest first.
 *
 * The list form of the endpoint can be turned off with DISABLE_STATUS, and it
 * is behind the site password gate. Either way the request fails and this
 * returns an empty list, which callers render as nothing at all rather than as
 * an error: a viewer cannot act on a server that does not publish its streams.
 */
export function useLiveStreams(): LiveStream[] {
  const { data = [] } = useQuery({
    queryKey: ["live-streams"],
    refetchInterval: 5000,
    retry: false,
    queryFn: async () => {
      try {
        // Force JSON parsing: the status endpoint sets its Content-Type too
        // late, so ofetch would otherwise hand back an unparsed string.
        const streams = await api<StatusResult[]>("/status", { responseType: "json" });

        return streams
          .filter((stream) => stream.isOnline)
          .map((stream) => ({ name: stream.streamKey, viewers: stream.sessions.length }))
          .sort(
            (left, right) => right.viewers - left.viewers || left.name.localeCompare(right.name),
          );
      } catch {
        return [];
      }
    },
  });

  return data;
}
