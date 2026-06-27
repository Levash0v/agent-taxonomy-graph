/**
 * All-in ATG dry-run wrapper.
 *
 * Builds one reviewed proposal plan for existing clean AI-space agent cards plus
 * missing B/C/D agents. This wrapper never publishes by itself; it only enables
 * create-agent rows in the consolidated dry-run builder.
 *
 * Run:
 *   bun run 97_atg_all_in_consolidated_dry_run.ts
 *
 * Optional image upload during dry-run:
 *   UPLOAD_IMAGES=1 bun run 97_atg_all_in_consolidated_dry_run.ts
 */

process.env.INCLUDE_CREATE_AGENTS = "1";

await import("./94_atg_existing_only_consolidated_dry_run.ts");
