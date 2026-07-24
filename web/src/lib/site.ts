/**
 * The site/brand name, configurable at build time via the `VITE_SITE_NAME`
 * env var (loaded from the repo-root `.env*` files). Defaults to "Broadcast Box".
 */
export const SITE_NAME = import.meta.env.VITE_SITE_NAME?.trim() || "Broadcast Box";
