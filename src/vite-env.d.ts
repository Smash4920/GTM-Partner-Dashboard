/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FEATURE_PRODUCTION_REQUIREMENTS?: string;
  readonly VITE_FEATURE_PRODUCTION_REQUIREMENTS_ROLLOUT?: string;
  readonly VITE_LOG_LEVEL?: string;
  readonly VITE_METRICS_ENDPOINT?: string;
  readonly VITE_METRICS_SAMPLE_RATE?: string;
  readonly VITE_DEPLOYMENT_ENV?: string;
  readonly VITE_RELEASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
