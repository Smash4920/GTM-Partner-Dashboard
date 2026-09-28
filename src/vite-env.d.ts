/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FEATURE_PRODUCTION_REQUIREMENTS?: string;
  readonly VITE_FEATURE_PRODUCTION_REQUIREMENTS_ROLLOUT?: string;
  readonly VITE_LOG_LEVEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
