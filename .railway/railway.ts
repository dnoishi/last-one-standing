import { defineRailway, preserve, project, service } from "railway/iac";

// Last resort for a per-service CaC repo. Prefer one .railway file for the
// project and drop this if you later combine services into that file.
export const partial = "companion";

export default defineRailway(() => {
  const companion = service("companion", {
    start: "npm run companion",
    env: {
      ARMORER_PRIVATE_KEY: preserve(),
      GAME_ADDRESS: preserve(),
      INDEXER_URL: preserve(),
      ROUND_RESULT_SCHEMA_ID: preserve(),
    },
  });

  return project("last-one-standing-companion", {
    resources: [companion],
  });
});
