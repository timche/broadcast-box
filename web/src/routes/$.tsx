import { createFileRoute } from "@tanstack/react-router";
import { Multiview } from "@/components/player/multiview";

export const Route = createFileRoute("/$")({
  component: WatchPage,
});

function WatchPage() {
  const { _splat } = Route.useParams();
  return <Multiview initialStreamKey={_splat ?? ""} />;
}
