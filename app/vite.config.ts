import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      output: {
        // The block geometry is ~290 KB of the bundle and changes only when
        // someone ingests a new street count; the libraries change never.
        // Splitting both off app code means an edit to a component invalidates
        // a few KB rather than the whole thing.
        manualChunks: {
          vendor: ["react", "react-dom", "leaflet", "react-leaflet"],
          supabase: ["@supabase/supabase-js"],
        },
      },
    },
  },
});
