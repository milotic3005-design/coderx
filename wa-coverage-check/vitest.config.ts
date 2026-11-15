// The checker lives inside the coderx repo; this keeps Vitest from using coderx's own config.
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
