import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development, /api/* is forwarded to FastAPI on port 8000 (no CORS needed).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
