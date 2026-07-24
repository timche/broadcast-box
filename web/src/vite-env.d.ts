/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Site/brand name shown in the header and document title. */
  readonly VITE_SITE_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
