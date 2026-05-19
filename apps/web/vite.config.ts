import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // MaintenanceOS dev API runs on 4010 to avoid colliding with other
      // local projects that use :4000. Production (Fly) is single-process
      // and unaffected — it uses the platform-injected PORT.
      "/api": "http://localhost:4010",
      "/docs": "http://localhost:4010",
    },
  },
});
