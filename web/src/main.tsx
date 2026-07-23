import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { CinemaModeProvider } from "@/providers/cinema-mode";
import { routeTree } from "./routeTree.gen";
import "@fontsource-variable/inter";
import "./styles.css";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient();

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <QueryClientProvider client={queryClient}>
    <CinemaModeProvider>
      <RouterProvider router={router} />
    </CinemaModeProvider>
  </QueryClientProvider>,
);
