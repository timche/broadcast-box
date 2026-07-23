import { useAdminLoggingQuery } from "@/lib/queries/admin";

export function LoggingPage() {
  const { data } = useAdminLoggingQuery(true);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold">Logging</h2>
      <pre className="bg-muted/40 max-h-[60vh] overflow-auto rounded-md border p-4 text-xs whitespace-pre-wrap">
        {data ?? "Loading…"}
      </pre>
    </div>
  );
}
