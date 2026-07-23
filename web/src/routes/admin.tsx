import { createFileRoute } from "@tanstack/react-router";
import { AdminConsole } from "@/components/admin/admin-console";

export const Route = createFileRoute("/admin")({
  component: AdminConsole,
});
