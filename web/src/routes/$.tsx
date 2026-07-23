import { createFileRoute } from "@tanstack/react-router";
import { StreamView } from "@/components/player/stream-view";

export const Route = createFileRoute("/$")({
  component: WatchPage,
});

function WatchPage() {
  const { _splat } = Route.useParams();
  // The splat carries one or more stream keys: /key1/key2/... — so the URL
  // persists the full multiview.
  const streamKeys = (_splat ?? "").split("/").filter((key) => key !== "");

  if (streamKeys.length === 0) {
    return null;
  }
  return <StreamView streamKeys={streamKeys} />;
}
