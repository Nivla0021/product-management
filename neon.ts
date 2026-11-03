import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  functions: {
    products: {
      name: "Product manager API",
      source: "api/index.mjs",
      env: {
        ADMIN_PASSWORD: process.env.ADMIN_PASSWORD!,
        ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS!,
      },
    },
  },
});
