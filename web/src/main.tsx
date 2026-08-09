import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/toast";
import { SITE_NAME } from "@/lib/site";
import { routeTree } from "./routeTree.gen";
import "@fontsource-variable/inter";
import "./styles.css";

document.title = SITE_NAME;

// Registered only in a real build: the worker lives in `public/`, so the dev
// server has no `/sw.js` to serve. Failing to register just means no install
// prompt, which is not worth surfacing.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

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
    <Toaster>
      <RouterProvider router={router} />
    </Toaster>
  </QueryClientProvider>,
);
