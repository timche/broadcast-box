import { createFileRoute } from "@tanstack/react-router";
import { Broadcaster } from "@/components/broadcast/broadcaster";

export const Route = createFileRoute("/publish/$streamKey")({
  component: PublishPage,
});

function PublishPage() {
  const { streamKey } = Route.useParams();
  return <Broadcaster streamKey={decodeURIComponent(streamKey)} />;
}
