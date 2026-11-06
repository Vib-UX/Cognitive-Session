import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/presence": "https://sessionrelay-production.up.railway.app",
      "/health": "https://sessionrelay-production.up.railway.app",
    },
  },
});
