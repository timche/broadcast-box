import { useQuery } from "@tanstack/react-query";
import { fetchStreamPasswordState, type StreamPasswordState } from "@/lib/stream-password";

const withheld: StreamPasswordState = { required: false, password: "" };

/**
 * Asks the server whether publishing needs a password, and for the password
 * itself when the site gate is what let this request through.
 *
 * A failed request is treated as "no password required", which is how the
 * server behaves when the feature is off. Publishing then fails with a 401 and
 * says so, rather than the page asking for a password nobody set.
 */
export function useStreamPassword(): StreamPasswordState {
  const { data = withheld } = useQuery({
    queryKey: ["stream-password"],
    // A credential: keep it in memory for this page rather than refetching it
    // on every window focus.
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      try {
        return await fetchStreamPasswordState();
      } catch {
        return withheld;
      }
    },
  });

  return data;
}
