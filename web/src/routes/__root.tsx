import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { useCinemaMode } from "@/providers/cinema-mode";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const { cinemaMode } = useCinemaMode();

  return (
    <div className="flex min-h-screen flex-col">
      {!cinemaMode && (
        <nav className="bg-card/80 fixed inset-x-0 top-0 z-40 border-b px-4 py-3 backdrop-blur">
          <Link to="/" className="text-2xl font-light">
            Broadcast Box
          </Link>
        </nav>
      )}

      <main className={cinemaMode ? "flex-1" : "flex-1 pt-16"}>
        <Outlet />
      </main>

      {!cinemaMode && (
        <footer className="container mx-auto px-2 py-6">
          <ul className="text-muted-foreground flex items-center justify-center gap-4 text-sm">
            <li>
              <a
                href="https://github.com/Glimesh/broadcast-box"
                className="hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                GitHub
              </a>
            </li>
            <li>
              <a
                href="https://pion.ly"
                className="hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                Pion
              </a>
            </li>
          </ul>
        </footer>
      )}
    </div>
  );
}
