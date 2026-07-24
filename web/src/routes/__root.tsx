import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { HEADER_ACTIONS_ID } from "@/components/layout/header-portal";

export const HEADER_HEIGHT_REM = 2.75;

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-card/80 fixed inset-x-0 top-0 z-40 flex h-11 items-center gap-2 border-b px-3 backdrop-blur">
        <Link to="/" className="text-sm font-semibold tracking-tight">
          Broadcast Box
        </Link>
        <div id={HEADER_ACTIONS_ID} className="ml-auto flex items-center gap-2" />
      </header>

      <main className="flex-1 pt-11">
        <Outlet />
      </main>
    </div>
  );
}
