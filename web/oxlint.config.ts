import oxlintConfig from "@timche/oxc-configs/oxlint";
import { defineConfig } from "oxlint";

export default defineConfig({
  ...oxlintConfig,
  ignorePatterns: ["build", "src/routeTree.gen.ts"],
});
