import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { HEADER_ACTIONS_ID } from "@/components/layout/header-portal";
import { SITE_NAME } from "@/lib/site";

export const HEADER_HEIGHT_REM = 2.75;

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    // `dvh`, not `vh`: on mobile `100vh` is the toolbar-less height, which
    // leaves the page taller than the visible viewport and scrollable even
    // when a route already fills it exactly.
    <div className="flex min-h-dvh flex-col">
      <header className="bg-card/80 fixed inset-x-0 top-0 z-40 flex h-11 items-center gap-2 border-b px-3 backdrop-blur">
        <Link to="/" className="shrink-0 text-sm font-semibold tracking-tight">
          {SITE_NAME}
        </Link>
        <div id={HEADER_ACTIONS_ID} className="ml-auto flex min-w-0 items-center gap-2" />
      </header>

      <main className="flex-1 pt-11">
        <Outlet />
      </main>
    </div>
  );
}
