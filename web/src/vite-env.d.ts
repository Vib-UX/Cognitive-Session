/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RELAY_HTTP?: string;
  readonly VITE_SESSION_LOCK_ADDRESS?: string;
  readonly VITE_SESSION_PAYOUT_ADDRESS?: string;
  readonly VITE_BASE_SEPOLIA_RPC?: string;
  readonly VITE_SEPOLIA_RPC?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
