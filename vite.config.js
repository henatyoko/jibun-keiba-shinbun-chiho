import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/chiho/",
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
  },
});
