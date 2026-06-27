# Agent Taxonomy Graph

Agent Taxonomy Graph (ATG) is a structured dataset and Geo publishing toolkit for AI agent systems, frameworks, and related ecosystem entities.

The project maps agents not as a flat list of tools, but as a graph of capabilities, features, protocols, models, maintainers, licenses, links, covers, avatars, and reusable taxonomy nodes.

## Current Scope

This release contains four publication batches:

| Batch | Agents |
|---|---:|
| A | 37 |
| B | 32 |
| C | 32 |
| D | 31 |

Total: 132 agent/project records.

## Repository Contents

| Path | Purpose |
|---|---|
| `40_atg_publish_agents.ts` | Publishes agent cards and taxonomy relations to Geo |
| `60_atg_replace_agent_covers.ts` | Replaces existing agent cover images |
| `61_atg_attach_agent_avatars.ts` | Attaches avatar images to existing agent cards |
| `geo_atg/atg_agents_batch*.json` | Agent publication data |
| `geo_atg/atg_orgs_batch*.json` | Organization/provider publication data |
| `src/functions.ts` | Geo GraphQL and publish helpers |
| `src/constants.ts` | Shared Geo IDs and constants |

## Ontology Layers

ATG currently uses these main layers:

- Agents
- Organizations / providers
- Capabilities
- Features
- Protocols
- Models
- Software licenses
- License status
- GitHub / Docs / Website / X links
- Covers and avatars

## Capabilities vs Features

Capabilities describe what an agent can do at the system level, such as tool use, planning, code execution, memory, web browsing, or sandboxing.

Features describe product affordances or ecosystem-level functionality, such as model routing, live preview, code review, git integration, or streaming.

## Publishing

Dry-run example:

```bash
DRY_RUN=1 \
SPACE_ID=<target-space-id> \
ATG_AGENTS_JSON=geo_atg/atg_agents_batchA_publish.json \
ATG_ORGS_JSON=geo_atg/atg_orgs_batchA_publish.json \
bun run 40_atg_publish_agents.ts
```

## Production Proposal Workflow

The current data/ontology proposal has been submitted to the Geo AI space for DAO review.

The consolidated ATG proposal workflow is prepared through:

- `93_atg_clean_ai_consolidated_patch_plan.py` - builds the cleanup/enrichment plan for existing AI-space agent cards.
- `94_atg_existing_only_consolidated_dry_run.ts` - builds an existing-card-only dry-run.
- `95_atg_batch_publish_preflight.py` - validates batch readiness before publication.
- `96_atg_build_support_bootstrap_map.py` - prepares support/reuse bootstrap mapping.
- `97_atg_all_in_consolidated_dry_run.ts` - builds the all-in data/ontology dry-run.
- `88_atg_publish_reviewed_ops.ts` - publishes a reviewed ops file after explicit confirmation.
