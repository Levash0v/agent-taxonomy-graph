/**
 * Idempotent batch publisher for ATG agents to Geo Protocol testnet.
 * Reads current state first, skips anything already present.
 *
 * Run: DRY_RUN=1 bun run 40_atg_publish_agents.ts
 *      bun run 40_atg_publish_agents.ts
 */

import dotenv from "dotenv";
import sharp from "sharp";
import { Graph, Position, type Op, ContentIds } from "@geoprotocol/geo-sdk";
import { publishOps, printOps, gql } from "./src/functions.js";
import { TYPES, PROPERTIES, VIEWS, COLLECTION_DATA_SOURCE, SPACE_PROPS } from "./src/constants.js";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

dotenv.config();

const DRY_RUN = process.env.DRY_RUN === "1";
const AGENT_FILTER = process.env.AGENT ?? null;
const AGENTS_FILTER = process.env.AGENTS
  ? new Set(process.env.AGENTS.split(",").map(s => s.trim()).filter(Boolean))
  : null;
const SKIP_SK = process.env.SKIP_SK === "1";
const SPACE_ID = process.env.SPACE_ID ?? process.env.GEO_SPACE_ID ?? "80bbb6e9716f83fddf68f6df4f52a6bd";
const AGENTS_JSON = process.env.ATG_AGENTS_JSON ?? "atg_agents.json";
const ORGS_JSON = process.env.ATG_ORGS_JSON ?? "atg_orgs.json";
const SKIP_IMAGE_UPLOAD = process.env.SKIP_IMAGE_UPLOAD === "1";
const PUBLISH_ORIGIN_BLOCK = process.env.PUBLISH_ORIGIN_BLOCK === "1";
const CLEAN_AI_SPACE_ID = "41e851610e13a19441c4d980f2f2ce6b";
const REUSE_SPACE_IDS = (process.env.REUSE_SPACE_IDS
  ? process.env.REUSE_SPACE_IDS.split(",").map(s => s.trim()).filter(Boolean)
  : SPACE_ID === CLEAN_AI_SPACE_ID ? [SPACE_ID] : [SPACE_ID, CLEAN_AI_SPACE_ID]
);
const ALLOW_CREATE_TAXONOMY = process.env.ALLOW_CREATE_TAXONOMY === "1"
  || (process.env.ALLOW_CREATE_TAXONOMY !== "0" && SPACE_ID !== CLEAN_AI_SPACE_ID);
const STRICT_TAXONOMY_REUSE = process.env.STRICT_TAXONOMY_REUSE === "1"
  || (process.env.STRICT_TAXONOMY_REUSE !== "0" && SPACE_ID === CLEAN_AI_SPACE_ID);
const REUSE_MAP_JSON = process.env.ATG_ENTITY_REUSE_MAP ?? "atg_entity_reuse_map.json";

// ─── Space & type IDs ─────────────────────────────────────────────────────────
const OUR_SPACE     = SPACE_ID;
const AGENT_TYPE_ID = "9069cd7680cabc7b5e7aace5bc0da4d3";
const TOOL_TYPE_ID  = "fa464fe0c27b4d54bbac4caa20ca7781";
const OPEN_SRC_ID   = "2e267679d9b04444af89f9ba7134d7f2";

// ─── Property IDs ─────────────────────────────────────────────────────────────
const PROP_GITHUB    = "9eedefa860ae4ac19a04805054a4b094";
const PROP_DOCS      = "a446528df6b24ecab04bc4dd7dedfbd9";
const PROP_X         = "0d6259784b3c4b57a86fde45c997c73c";
const PROP_STARS     = "a79523e6aaa5dfc0701711234df6af9d";
const PROP_RELDATE   = "1170c5a68a015fb2addc44382fe7d0f5";
const PROP_ACTIVE    = "ffab986cc06f6f288efae9db7c4a3fdc";  // Actively maintained (boolean)
const PROP_SKILLS    = "45509a98a0a2473ba727f7b170ed813b";  // Skills count (integer)

// ─── Relation type IDs ────────────────────────────────────────────────────────
const REL_TYPES        = "8f151ba4de204e3c9cb499ddf96f48f1";
const REL_CAPABILITIES = "15f630ff5d87f0e3992fdd68567970fc";  // action/architectural/safety classes
const REL_FEATURES     = "b3c9e2e050234801a0da05314326c439";  // product affordances / ecosystem
const REL_DEVELOPERS   = "b36bba262b6b45dabe8b6fe1d41f5f96";
const REL_PROTOCOLS    = "27f4e74e301943a89dc573bbb6df8f00";
const REL_MODELS       = "968742a40c109c633de1c70a79587487";
const REL_SW_LIC     = "7fc423a18e304205988af467d1f8b84a";
const REL_LIC_STATUS = "a79b63d453dd4938a3091ff448d36cbc";
const COMM_PROTO_TYPE = "ecf7f8ea560f4c8bae62ef2329ae82c6";
const MODEL_TYPE_ID   = "c7a4fc6d1afc53250a22d4209391dc79";

// ─── License entity IDs ───────────────────────────────────────────────────────
const MIT      = "aad29168dd2f4f7c825504835850826c";
const APACHE_2 = "752157c74ccc47c79fd8bba761b63b65";
// AGPL-3.0: no entity — warn and skip

// ─── Already-published entity IDs ────────────────────────────────────────────
const PUBLISHED_ORG_IDS: Record<string, string> = {
  org_microsoft: "04a1a0f70ef349de9698b930a689598c",
};
const PUBLISHED_AGENT_IDS: Record<string, string> = {
  "microsoft-semantic-kernel": "2b36d177c7c6478d9e4299c1a69bc04b",
};

// ─── Capability / Feature slug → entity spec ────────────────────────────────
const CAPABILITY_FEATURES: Record<string, { name: string; description: string; geoId?: string; aliases?: string[] }> = {
  // Core execution
  tool_use:                  { name: "Tool use",                  description: "Invokes registered tools and functions as part of task execution.", aliases: ["Tool use / function calling"] },
  code_execution:            { name: "Code execution",            description: "Writes and executes code directly as the primary action mechanism." },
  code_generation:           { name: "Code generation",           description: "Generates source code or full applications as structured output." },
  file_system_access:        { name: "File system access",        description: "Reads and writes files on the local file system as part of task execution." },
  shell_execution:           { name: "Shell execution",           description: "Runs shell commands and scripts in a terminal environment.", aliases: ["Shell / terminal execution"] },
  terminal_access:           { name: "Terminal access",           description: "Can access or drive a terminal and shell execution surface.", aliases: ["Shell / terminal execution"] },
  deployment:                { name: "Deployment",                description: "Deploys code, applications, or services to target environments." },
  runtime_management:        { name: "Runtime management",        description: "Creates, configures, and manages execution environments and dependencies." },
  cloud_ops:                 { name: "Cloud ops",                 description: "Provisions and manages cloud infrastructure and services." },
  cron_scheduling:           { name: "Cron scheduling",           description: "Schedules and executes recurring tasks at defined intervals." },
  // Browser & interface
  browser_control:           { name: "Browser control",           description: "Automates web browser interactions through visual understanding or DOM manipulation.", aliases: ["Browser / web automation"] },
  computer_use:              { name: "Computer use",              description: "Controls the computer interface through screenshots and mouse/keyboard actions.", aliases: ["Computer use / GUI control"] },
  ui_generation:             { name: "UI generation",             description: "Generates user interface components or complete frontend layouts." },
  live_preview:              { name: "Live preview",              description: "Renders a live, interactive preview of generated UI or code output in real time." },
  voice_tts:                 { name: "Voice / TTS",               description: "Produces or consumes audio via speech synthesis or voice input." },
  // Orchestration & planning
  multi_agent_orchestration: { name: "Multi-agent orchestration", description: "Coordinates multiple specialized agents toward a shared goal.",                         geoId: "a7e5eed43d354c6c8fbd06a130c125d6" },
  planning:                  { name: "Planning",                  description: "Decomposes complex goals into structured step-by-step execution plans." },
  multi_step_autonomy:       { name: "Multi-step autonomy",       description: "Executes long chains of actions without requiring human confirmation at each step." },
  human_in_the_loop:         { name: "Human-in-the-loop",         description: "Pauses execution to request confirmation or additional input from a human operator." },
  // Knowledge & memory
  vector_rag:                { name: "Vector RAG",                description: "Retrieves relevant context from a vector store to augment generation." },
  persistent_memory:         { name: "Persistent memory",         description: "Stores and retrieves facts, context, and learned information across sessions." },
  context_management:        { name: "Context management",        description: "Manages task context, project context, or conversation state across agent steps." },
  in_context_memory:         { name: "In-context memory",         description: "Accumulates and references information within the current session context window." },
  web_search:                { name: "Web search",                description: "Queries the web for real-time information as part of task execution." },
  // Repository & code workflow
  repo_context:              { name: "Repo context",              description: "Indexes and semantically understands a codebase to inform code generation and edits.", aliases: ["Repository-scale context"] },
  pull_request_workflow:     { name: "Pull request workflow",     description: "Creates, reviews, and manages pull requests as part of a development workflow." },
  multi_file_edits:          { name: "Multi-file edits",          description: "Plans and applies coordinated changes across multiple files in a single task." },
  // Orchestration & planning (extended)
  workflow_orchestration:    { name: "Workflow orchestration",    description: "Coordinates multi-step task pipelines as directed acyclic graphs with conditional branching and parallel execution." },
  long_running_tasks:        { name: "Long-running tasks",        description: "Persists agent execution across extended time periods — hours to days — with background scheduling and resumption." },
  state_management:          { name: "State management",          description: "Tracks and updates agent execution state across steps, managing context, progress, and decision history." },
  checkpointing:             { name: "Checkpointing",             description: "Saves execution state at defined intervals to enable recovery, resume, and fault tolerance." },
  // Safety & trust
  evaluation:                { name: "Agent evaluation",          description: "Measures and scores agent outputs against defined criteria, enabling automated benchmarking and quality assessment.", aliases: ["Evaluation"], geoId: "302788bbdba54305af609fe2cc4f318e" },
  guardrails:                { name: "Guardrails",                description: "Applies safety constraints and output filters to prevent harmful, off-topic, or policy-violating responses." },
  sandboxing:                { name: "Sandboxing",                description: "Executes untrusted or experimental code in isolated environments to prevent system interference." },
  agent_identity:            { name: "Agent identity",            description: "Manages agent credentials, personas, and authentication context across interactions." },
  permissioning:             { name: "Permissioning",             description: "Enforces access control policies to restrict which actions, tools, or resources an agent can use." },
  // Integration & extensibility
  mcp_client:                { name: "MCP client",                description: "Connects to external tool servers using the Model Context Protocol (MCP)." },
  plugin_extensions:         { name: "Plugin extensions",         description: "Extends agent capabilities by loading additional plugins or extensions at runtime.",     geoId: "fcbd41fa6752442d9d4af51025497415" },
  model_routing:             { name: "Model routing",             description: "Selects and routes requests between multiple model providers based on task type, availability, cost, or fallback policy." },
  observability_tracing:     { name: "Observability tracing",     description: "Records and exposes structured traces of agent execution — LLM calls, tool invocations, reasoning steps — for debugging and evaluation." },
};

// ─── Slugs that route to REL_FEATURES (product affordances) ──────────────────
// Everything else in CAPABILITY_FEATURES routes to REL_CAPABILITIES.
const FEATURE_SLUGS = new Set([
  "live_preview", "multi_file_edits", "plugin_extensions", "model_routing",
  "prompt_caching", "parallel_tool_calls", "streaming", "structured_outputs",
  "function_calling", "code_review", "git_integration",
]);

const MCP_PROTOCOL = {
  name: "Model Context Protocol (MCP)",
  description: "Open standard by Anthropic for connecting LLMs to external tools, data sources, and services via a client-server architecture.",
  docsUrl: "https://modelcontextprotocol.io",
};

const PROTOCOL_SPECS: Record<string, { name: string; description: string; docsUrl?: string; geoId?: string }> = {
  mcp: MCP_PROTOCOL,
  "openai-tool-call": {
    name: "OpenAI tool call format",
    description: "OpenAI-compatible tool/function calling format used by models and agent frameworks to request structured tool invocations.",
    docsUrl: "https://platform.openai.com/docs/guides/function-calling",
  },
  openapi: {
    name: "OpenAPI / REST",
    description: "API integration pattern using OpenAPI specifications or REST endpoints as callable tools for agent systems.",
    docsUrl: "https://www.openapis.org/",
  },
  agentskill: {
    name: "Agent Skills",
    description: "Skill-packaging pattern for extending AI agents with reusable instructions, workflows, and capabilities.",
    docsUrl: "https://github.com/anthropics/skills",
  },
  acp: {
    name: "Agent Client Protocol (ACP)",
    description: "Protocol/interface pattern for connecting agent clients and agent runtimes.",
    docsUrl: "https://agentclientprotocol.com",
  },
};

const MODEL_SPECS: Record<string, { name: string; description: string; sourceUrl?: string; geoId?: string; aliases?: string[] }> = {
  any: {
    name: "Model-agnostic",
    description: "Agent framework is designed to work across multiple model providers or model families rather than being tied to a single model.",
  },
  claude: {
    name: "Claude (family)",
    aliases: ["Claude", "Claude (family)"],
    geoId: "b78e920399ee42a3b5903fa9719fd30a",
    description: "Anthropic's Claude model family, commonly used by coding and tool-using agents.",
    sourceUrl: "https://anthropic.com",
  },
  "gpt-4o": {
    name: "GPT-4o",
    aliases: ["GPT-4o"],
    description: "OpenAI multimodal model used by agents for text, vision, audio, and tool-calling workflows.",
    sourceUrl: "https://openai.com",
  },
  gemini: {
    name: "Gemini",
    aliases: ["Gemini"],
    description: "Google's Gemini model family for multimodal language, reasoning, and tool-use workflows.",
    sourceUrl: "https://ai.google.dev",
  },
  ollama: {
    name: "Ollama",
    aliases: ["Ollama"],
    description: "Local model runtime and ecosystem often used by agents that support local/open-weight models.",
    sourceUrl: "https://ollama.com",
  },
};

// ─── ATG agent / org data types ───────────────────────────────────────────────
interface AtgAgent {
  id: string;
  name: string;
  avatar_url: string;
  cover_url: string;
  description: string;
  organization: string;
  primary_category: string;
  license: string;
  primary_language: string;
  stars_at_collection: number;
  release_date: string;
  website_url: string;
  github_url: string;
  docs_url: string;
  x_url: string;
  capabilities: string[];
  features?: string[];
  protocols?: string[];
  models?: string[];
  runtimes?: string[];
  domains?: string[];
  memory_types?: string[];
  risk_surface?: string[];
  risk_mitigations?: string[];
  skills_count?: number;
}

interface AtgOrg {
  id: string;
  name: string;
  type: string;
  country: string;
  web_url: string;
  x_url: string;
  description: string;
}

interface EntityReuseMap {
  capabilities?: Record<string, string>;
  features?: Record<string, string>;
  protocols?: Record<string, string>;
  orgs?: Record<string, string>;
  agents?: Record<string, string>;
}

// ─── Load JSON data ───────────────────────────────────────────────────────────
const dataDir = resolve(process.cwd(), "geo_atg");
const allAgents: AtgAgent[] = JSON.parse(readFileSync(resolve(dataDir, AGENTS_JSON), "utf8"));
const allOrgs:   AtgOrg[]   = JSON.parse(readFileSync(resolve(dataDir, ORGS_JSON),   "utf8"));
const reuseMapPath = resolve(dataDir, REUSE_MAP_JSON);
const reuseMap: EntityReuseMap = existsSync(reuseMapPath)
  ? JSON.parse(readFileSync(reuseMapPath, "utf8"))
  : {};

const orgById = new Map<string, AtgOrg>(allOrgs.map(o => [o.id, o]));

// ─── Filter agents ────────────────────────────────────────────────────────────
let agents = allAgents;
if (AGENT_FILTER) {
  agents = agents.filter(a => a.id === AGENT_FILTER);
  if (agents.length === 0) {
    console.error(`ERROR: No agent found with id="${AGENT_FILTER}"`);
    process.exit(1);
  }
  console.log(`Filtered to agent: ${agents[0].name}`);
}
if (AGENTS_FILTER) {
  agents = agents.filter(a => AGENTS_FILTER.has(a.id));
  const missing = [...AGENTS_FILTER].filter(id => !agents.some(a => a.id === id));
  if (missing.length) {
    console.error(`ERROR: Missing agents from ${AGENTS_JSON}: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log(`Filtered to agents: ${agents.map(a => a.name).join(", ")}`);
}
if (SKIP_SK) {
  agents = agents.filter(a => a.id !== "microsoft-semantic-kernel");
  console.log("Skipping microsoft-semantic-kernel (SKIP_SK=1)");
}

// ─── Image helpers ────────────────────────────────────────────────────────────
async function fetchResized(url: string, w: number, h: number): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return sharp(buf).resize(w, h, { fit: "cover", position: "centre" }).png().toBuffer();
}

async function uploadImageToGeo(buf: Buffer, name: string, ops: Op[]): Promise<string> {
  const b64 = `data:image/png;base64,${buf.toString("base64")}`;
  const { id, ops: imgOps } = await Graph.createImage({ url: b64, name, network: "TESTNET" });
  ops.push(...imgOps);
  return id;
}

// ─── License resolver ─────────────────────────────────────────────────────────
function resolveLicenseId(license: string): string | null {
  switch ((license ?? "").toLowerCase()) {
    case "mit":        return MIT;
    case "apache-2.0": return APACHE_2;
    case "agpl-3.0":
      console.warn(`  ⚠️  AGPL-3.0 has no Geo entity — skipping license relation`);
      return null;
    case "noassertion":
    case "no assertion":
    case "":
      console.warn(`  ⚠️  No license assertion — skipping license relation`);
      return null;
    default:
      console.warn(`  ⚠️  Unknown license "${license}" — skipping license relation`);
      return null;
  }
}

function isOpenSourceLicense(license: string): boolean {
  switch ((license ?? "").toLowerCase()) {
    case "mit":
    case "apache-2.0":
    case "agpl-3.0":
    case "gpl-3.0":
    case "gpl-2.0":
    case "bsd-3-clause":
      return true;
    default:
      return false;
  }
}

// ─── Feature registry (in-memory dedup across agents) ────────────────────────
// Maps capability slug → resolved Geo entity ID
const featureRegistry = new Map<string, string>();
const protocolRegistry = new Map<string, string>();
const modelRegistry = new Map<string, string>();

// Pre-seed with geoId entries (reuse from AI space, never create)
for (const [slug, spec] of Object.entries(CAPABILITY_FEATURES)) {
  const mapped = FEATURE_SLUGS.has(slug)
    ? reuseMap.features?.[slug]
    : reuseMap.capabilities?.[slug];
  if (mapped) featureRegistry.set(slug, mapped);
  else if (spec.geoId) featureRegistry.set(slug, spec.geoId);
}
for (const [slug, id] of Object.entries(reuseMap.protocols ?? {})) {
  protocolRegistry.set(slug, id);
}

// ─── Org registry (in-memory dedup across agents) ─────────────────────────────
// Maps org id string → resolved Geo entity ID
const orgRegistry = new Map<string, string>([
  ...Object.entries(PUBLISHED_ORG_IDS),
  ...Object.entries(reuseMap.orgs ?? {}),
]);

// ─── Helper: query entity by name in space ────────────────────────────────────
async function queryEntityByName(name: string, spaceId: string): Promise<string | null> {
  const data = await gql(`{
    entities(spaceId: "${spaceId}" filter: { name: { in: ${JSON.stringify([name])} } }) {
      id name
    }
  }`, undefined, `lookup "${name}"`);
  const found = (data?.entities ?? []).find((e: { id: string; name: string }) => e.name === name);
  return found?.id ?? null;
}

async function queryEntityByNames(names: string[], spaceId: string): Promise<{ id: string; name: string } | null> {
  const uniqueNames = [...new Set(names.filter(Boolean))];
  const data = await gql(`{
    entities(spaceId: "${spaceId}" filter: { name: { in: ${JSON.stringify(uniqueNames)} } }) {
      id name
    }
  }`, undefined, `lookup ${uniqueNames.join(" / ")}`);
  const entities: { id: string; name: string }[] = data?.entities ?? [];
  return uniqueNames
    .map(name => entities.find(e => e.name === name))
    .find(Boolean) ?? null;
}

// ─── Helper: read current relations for an entity ────────────────────────────
async function readEntityRelations(entityId: string): Promise<{
  relsByType: Map<string, Set<string>>;
  existingBlockNames: Set<string | null>;
  hasRelTo: (type: string, to: string) => boolean;
  hasRelType: (type: string) => boolean;
}> {
  const data = await gql(`{
    entities(spaceId: "${OUR_SPACE}" filter: { id: { in: ["${entityId}"] } }) {
      relations { nodes { typeId toEntity { id name } } }
    }
  }`, undefined, `read relations for ${entityId}`);

  const relNodes: { typeId: string; toEntity: { id: string; name: string | null } }[] =
    data?.entities?.[0]?.relations?.nodes ?? [];

  const relsByType = new Map<string, Set<string>>();
  for (const r of relNodes) {
    if (!relsByType.has(r.typeId)) relsByType.set(r.typeId, new Set());
    relsByType.get(r.typeId)!.add(r.toEntity.id);
  }

  const existingBlockNames = new Set<string | null>(
    relNodes
      .filter(r => r.typeId === PROPERTIES.blocks)
      .map(r => r.toEntity.name),
  );

  const hasRelTo  = (type: string, to: string) => relsByType.get(type)?.has(to) ?? false;
  const hasRelType = (type: string)             => (relsByType.get(type)?.size ?? 0) > 0;

  return { relsByType, existingBlockNames, hasRelTo, hasRelType };
}

// ─── Helper: resolve or create an org entity ─────────────────────────────────
async function resolveOrg(orgId: string, ops: Op[]): Promise<string> {
  // 1. Already in registry (from PUBLISHED_ORG_IDS or prior run in this session)
  const cached = orgRegistry.get(orgId);
  if (cached) {
    console.log(`  [reuse]  Org "${orgId}" → ${cached} (registry)`);
    return cached;
  }

  const org = orgById.get(orgId);
  if (!org) throw new Error(`Unknown org id: "${orgId}"`);

  // 2. Query by name across the current space and reusable AI spaces.
  for (const spaceId of REUSE_SPACE_IDS) {
    const found = await queryEntityByName(org.name, spaceId);
    if (found) {
      console.log(`  [reuse]  Org "${org.name}" → ${found} (space ${spaceId})`);
      orgRegistry.set(orgId, found);
      return found;
    }
  }

  // 3. Create
  const { id, ops: orgOps } = Graph.createEntity({
    name: org.name,
    description: org.description,
    types: [TYPES.project],
    values: [
      { property: PROPERTIES.web_url, type: "text", value: org.web_url },
      { property: PROP_X,             type: "text", value: org.x_url },
    ],
  });
  ops.push(...orgOps);
  orgRegistry.set(orgId, id);
  console.log(`  [create] Org "${org.name}" → ${id}`);
  return id;
}

// ─── Helper: resolve or create a feature entity ──────────────────────────────
async function resolveFeature(slug: string, ops: Op[]): Promise<string | null> {
  const spec = CAPABILITY_FEATURES[slug];
  if (!spec) {
    console.warn(`  ⚠️  Unknown capability slug "${slug}" — skipping`);
    return null;
  }

  // 1. Already in registry (includes pre-seeded geoId entries)
  const cached = featureRegistry.get(slug);
  if (cached) return cached;

  // 2. Query canonical name and known aliases across reuse spaces.
  const names = [spec.name, ...(spec.aliases ?? [])];
  for (const spaceId of REUSE_SPACE_IDS) {
    const found = await queryEntityByNames(names, spaceId);
    if (found) {
      console.log(`  [reuse]  ${FEATURE_SLUGS.has(slug) ? "Feature" : "Capability"} "${found.name}" → ${found.id} (space ${spaceId})`);
      featureRegistry.set(slug, found.id);
      return found.id;
    }
  }

  if (!ALLOW_CREATE_TAXONOMY) {
    const message = `Unresolved ${FEATURE_SLUGS.has(slug) ? "feature" : "capability"} slug "${slug}" (${names.join(" / ")}). Add it to ${REUSE_MAP_JSON} or create/reuse the canonical Geo entity before publishing.`;
    if (STRICT_TAXONOMY_REUSE) throw new Error(message);
    console.warn(`  ⚠️  ${message}`);
    return null;
  }

  // 3. Create
  const { id, ops: featOps } = Graph.createEntity({
    name: spec.name,
    description: spec.description,
  });
  ops.push(...featOps);
  featureRegistry.set(slug, id);
  console.log(`  [create] ${FEATURE_SLUGS.has(slug) ? "Feature" : "Capability"} "${spec.name}" → ${id}`);
  return id;
}

// ─── Helper: resolve or create MCP protocol entity ──────────────────────────
async function resolveProtocol(slug: string, ops: Op[]): Promise<string | null> {
  const spec = PROTOCOL_SPECS[slug];
  if (!spec) {
    console.warn(`  ⚠️  Unknown protocol slug "${slug}" — skipping`);
    return null;
  }
  if (spec.geoId) return spec.geoId;

  const cached = protocolRegistry.get(slug);
  if (cached) return cached;

  for (const spaceId of REUSE_SPACE_IDS) {
    const found = await queryEntityByName(spec.name, spaceId);
    if (found) {
      console.log(`  [reuse]  Protocol "${spec.name}" → ${found} (space ${spaceId})`);
      protocolRegistry.set(slug, found);
      return found;
    }
  }

  if (!ALLOW_CREATE_TAXONOMY) {
    const message = `Unresolved protocol slug "${slug}" (${spec.name}). Add it to ${REUSE_MAP_JSON} or create/reuse the canonical Geo entity before publishing.`;
    if (STRICT_TAXONOMY_REUSE) throw new Error(message);
    console.warn(`  ⚠️  ${message}`);
    return null;
  }

  const { id, ops: protocolOps } = Graph.createEntity({
    name: spec.name,
    description: spec.description,
    values: spec.docsUrl ? [{ property: PROP_DOCS, type: "text", value: spec.docsUrl }] : [],
  });
  ops.push(...protocolOps);
  ops.push(...Graph.createRelation({ fromEntity: id, toEntity: COMM_PROTO_TYPE, type: REL_TYPES }).ops);
  protocolRegistry.set(slug, id);
  console.log(`  [create] Protocol "${spec.name}" → ${id}`);
  return id;
}

async function resolveModel(slug: string, ops: Op[]): Promise<string | null> {
  const spec = MODEL_SPECS[slug];
  if (!spec) {
    console.warn(`  ⚠️  Unknown model slug "${slug}" — skipping`);
    return null;
  }
  if (spec.geoId) {
    modelRegistry.set(slug, spec.geoId);
    return spec.geoId;
  }

  const cached = modelRegistry.get(slug);
  if (cached) return cached;

  const names = [spec.name, ...(spec.aliases ?? [])];
  for (const spaceId of REUSE_SPACE_IDS) {
    const found = await queryEntityByNames(names, spaceId);
    if (found) {
      console.log(`  [reuse]  Model "${found.name}" → ${found.id} (space ${spaceId})`);
      modelRegistry.set(slug, found.id);
      return found.id;
    }
  }

  if (!ALLOW_CREATE_TAXONOMY) {
    const message = `Unresolved model slug "${slug}" (${names.join(" / ")}). Add it to ${REUSE_MAP_JSON} or create/reuse the canonical Geo entity before publishing.`;
    if (STRICT_TAXONOMY_REUSE) throw new Error(message);
    console.warn(`  ⚠️  ${message}`);
    return null;
  }

  const { id, ops: modelOps } = Graph.createEntity({
    name: spec.name,
    description: spec.description,
    values: spec.sourceUrl ? [{ property: PROPERTIES.web_url, type: "text", value: spec.sourceUrl }] : [],
  });
  ops.push(...modelOps);
  ops.push(...Graph.createRelation({ fromEntity: id, toEntity: MODEL_TYPE_ID, type: REL_TYPES }).ops);
  modelRegistry.set(slug, id);
  console.log(`  [create] Model "${spec.name}" → ${id}`);
  return id;
}

function normalizeDateValue(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{4}-\d{2}$/.test(value)) return `${value}-01`;
  if (/^\d{4}$/.test(value)) return `${value}-01-01`;
  return null;
}

function agentValues(agent: AtgAgent): any[] {
  const values: any[] = [
    { property: PROPERTIES.web_url, type: "text", value: agent.website_url },
    { property: PROP_GITHUB,        type: "text", value: agent.github_url },
  ];
  if (agent.docs_url) values.push({ property: PROP_DOCS, type: "text", value: agent.docs_url });
  if (agent.x_url)    values.push({ property: PROP_X,    type: "text", value: agent.x_url });
  if (Number.isFinite(agent.stars_at_collection) && agent.stars_at_collection > 0) {
    values.push({ property: PROP_STARS, type: "integer", value: agent.stars_at_collection });
  }
  const dateValue = normalizeDateValue(agent.release_date);
  if (dateValue) values.push({ property: PROP_RELDATE, type: "date", value: dateValue });
  if (agent.skills_count != null) values.push({ property: PROP_SKILLS, type: "integer", value: agent.skills_count });
  return values;
}

// ─── Origin text generator ────────────────────────────────────────────────────
function buildOriginText(agent: AtgAgent): string {
  const licenseLabel = agent.license ?? "unknown";
  const langLabel    = agent.primary_language ?? "unknown";
  const parts = [`${agent.name} is written primarily in ${langLabel || "unknown"} and released under the ${licenseLabel} license.`];
  if (Number.isFinite(agent.stars_at_collection) && agent.stars_at_collection > 0) {
    parts.push(`The project had ${agent.stars_at_collection.toLocaleString()} GitHub stars at collection time.`);
  }
  return parts.join(" ");
}

// ─── Determine which Geo types to attach ─────────────────────────────────────
function getTypeIds(agent: AtgAgent): string[] {
  if (agent.primary_category === "agent_framework_orchestration") {
    return [TYPES.project, AGENT_TYPE_ID];
  }
  return [TYPES.project, AGENT_TYPE_ID, TOOL_TYPE_ID];
}

// ═════════════════════════════════════════════════════════════════════════════
// Main loop
// ═════════════════════════════════════════════════════════════════════════════
const allOps: Op[] = [];

for (const agent of agents) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Processing agent: ${agent.name} (${agent.id})`);
  console.log(`${"─".repeat(60)}`);

  const ops: Op[] = [];
  const lastPos: Record<string, string> = {};

  // ── Step 1: Resolve org ────────────────────────────────────────────────────
  const orgGeoId = await resolveOrg(agent.organization, ops);

  // ── Step 2: Resolve agent entity ──────────────────────────────────────────
  let agentGeoId: string;
  let isNewAgent = false;

  const prePublished = reuseMap.agents?.[agent.id] ?? PUBLISHED_AGENT_IDS[agent.id];
  if (prePublished) {
    agentGeoId = prePublished;
    console.log(`  [reuse]  Agent "${agent.name}" → ${agentGeoId} (pre-published)`);

    // Update scalars for pre-published agents
    const { ops: updateOps } = Graph.updateEntity({
      id: agentGeoId,
      name: agent.name,
      description: agent.description,
      values: agentValues(agent),
    });
    ops.push(...updateOps);
    console.log(`  [update] Agent scalar properties`);
  } else {
    // Query by name in space
    const found = await queryEntityByName(agent.name, OUR_SPACE);
    if (found) {
      agentGeoId = found;
      console.log(`  [reuse]  Agent "${agent.name}" → ${agentGeoId} (space query)`);

      const { ops: updateOps } = Graph.updateEntity({
        id: agentGeoId,
        name: agent.name,
        description: agent.description,
        values: [...agentValues(agent), { property: PROP_ACTIVE, type: "boolean" as const, value: true }],
      });
      ops.push(...updateOps);
      console.log(`  [update] Agent scalar properties`);
    } else {
      // Create new — do NOT pass types here; add via addRel below
      const { id, ops: createOps } = Graph.createEntity({
        name: agent.name,
        description: agent.description,
        values: [...agentValues(agent), { property: PROP_ACTIVE, type: "boolean" as const, value: true }],
      });
      ops.push(...createOps);
      agentGeoId = id;
      isNewAgent = true;
      console.log(`  [create] Agent "${agent.name}" → ${agentGeoId}`);
    }
  }

  // ── Step 3: Read current relations (skip for brand-new entities) ──────────
  const { existingBlockNames, hasRelTo, hasRelType } =
    isNewAgent
      ? {
          existingBlockNames: new Set<string | null>(),
          hasRelTo:           (_t: string, _to: string) => false,
          hasRelType:         (_t: string) => false,
        }
      : await readEntityRelations(agentGeoId);

  // ── Step 4: addRel helper (scoped to this agent) ──────────────────────────
  function addRel(from: string, to: string, type: string, label: string) {
    if (hasRelTo(type, to)) {
      console.log(`  [skip]   ${label} (already exists)`);
      return;
    }
    ops.push(...Graph.createRelation({ fromEntity: from, toEntity: to, type }).ops);
    console.log(`  [add]    ${label}`);
  }

  // ── Step 5: Type relations ─────────────────────────────────────────────────
  const typeIds = getTypeIds(agent);
  for (const typeId of typeIds) {
    const label = typeId === TYPES.project     ? "Type → Project"
                : typeId === AGENT_TYPE_ID     ? "Type → Agent"
                : typeId === TOOL_TYPE_ID      ? "Type → Tool"
                : `Type → ${typeId}`;
    addRel(agentGeoId, typeId, REL_TYPES, label);
  }

  // ── Step 6: Developer relation ────────────────────────────────────────────
  addRel(agentGeoId, orgGeoId, REL_DEVELOPERS, `Developers → ${agent.organization}`);

  // ── Step 7: License relations ──────────────────────────────────────────────
  const licId = resolveLicenseId(agent.license);
  if (licId) {
    addRel(agentGeoId, licId, REL_SW_LIC, `Software licenses → ${agent.license}`);
  }

  // ── Step 8: License status → Open source ──────────────────────────────────
  if (isOpenSourceLicense(agent.license)) {
    addRel(agentGeoId, OPEN_SRC_ID, REL_LIC_STATUS, "License status → Open source");
  } else {
    console.log(`  [skip]   License status → Open source (${agent.license || "unknown"} is not open-source asserted)`);
  }

  // ── Step 9: Resolve capability / feature entities ─────────────────────────
  const resolvedCapIds:  string[] = [];  // → REL_CAPABILITIES
  const resolvedFeatIds: string[] = [];  // → REL_FEATURES
  const resolvedProtocolIds: string[] = [];  // → REL_PROTOCOLS
  const resolvedModelIds: string[] = [];  // → REL_MODELS
  for (const slug of agent.capabilities) {
    if (slug === "mcp_client") {
      const protocolId = await resolveProtocol("mcp", ops);
      if (protocolId) resolvedProtocolIds.push(protocolId);
      continue;
    }
    const entityId = await resolveFeature(slug, ops);
    if (!entityId) continue;
    resolvedCapIds.push(entityId);
  }
  for (const slug of agent.features ?? []) {
    const entityId = await resolveFeature(slug, ops);
    if (!entityId) continue;
    resolvedFeatIds.push(entityId);
  }
  for (const slug of agent.protocols ?? []) {
    const protocolId = await resolveProtocol(slug, ops);
    if (protocolId) resolvedProtocolIds.push(protocolId);
  }
  for (const slug of agent.models ?? []) {
    const modelId = await resolveModel(slug, ops);
    if (modelId) resolvedModelIds.push(modelId);
  }

  // ── Step 10a: Capabilities relations ──────────────────────────────────────
  for (const capId of resolvedCapIds) {
    if (hasRelTo(REL_CAPABILITIES, capId)) {
      console.log(`  [skip]   Capabilities → ${capId}`);
    } else {
      ops.push(...Graph.createRelation({ fromEntity: agentGeoId, toEntity: capId, type: REL_CAPABILITIES }).ops);
      console.log(`  [add]    Capabilities → ${capId}`);
    }
  }
  // ── Step 10b: Features relations (product affordances) ────────────────────
  for (const featId of resolvedFeatIds) {
    if (hasRelTo(REL_FEATURES, featId)) {
      console.log(`  [skip]   Features → ${featId}`);
    } else {
      ops.push(...Graph.createRelation({ fromEntity: agentGeoId, toEntity: featId, type: REL_FEATURES }).ops);
      console.log(`  [add]    Features → ${featId}`);
    }
  }
  // ── Step 10c: Protocol relations ─────────────────────────────────────────
  for (const protocolId of resolvedProtocolIds) {
    if (hasRelTo(REL_PROTOCOLS, protocolId)) {
      console.log(`  [skip]   Protocols → ${protocolId}`);
    } else {
      ops.push(...Graph.createRelation({ fromEntity: agentGeoId, toEntity: protocolId, type: REL_PROTOCOLS }).ops);
      console.log(`  [add]    Protocols → ${protocolId}`);
    }
  }
  // ── Step 10d: Model relations ────────────────────────────────────────────
  for (const modelId of resolvedModelIds) {
    if (hasRelTo(REL_MODELS, modelId)) {
      console.log(`  [skip]   Models → ${modelId}`);
    } else {
      ops.push(...Graph.createRelation({ fromEntity: agentGeoId, toEntity: modelId, type: REL_MODELS }).ops);
      console.log(`  [add]    Models → ${modelId}`);
    }
  }
  console.log(`  [done]   Capabilities (${resolvedCapIds.length}) Features (${resolvedFeatIds.length}) Protocols (${resolvedProtocolIds.length}) Models (${resolvedModelIds.length})`);

  // ── Step 11: Optional "Origin and development" text block ────────────────
  // Disabled by default for ATG cards: this duplicated Description in test
  // cards and is not part of the agent ontology. Enable only for reviewed
  // long-form cards with PUBLISH_ORIGIN_BLOCK=1.
  if (!PUBLISH_ORIGIN_BLOCK) {
    console.log('  [skip]   Block "Origin and development" (disabled)');
  } else if (existingBlockNames.has("Origin and development")) {
    console.log('  [skip]   Block "Origin and development"');
  } else {
    const originMd = buildOriginText(agent);
    const { id: blockId, ops: blockOps } = Graph.createEntity({
      name: "Origin and development",
      types: [TYPES.text_block],
      values: [{ property: PROPERTIES.markdown_content, type: "text", value: originMd }],
    });
    ops.push(...blockOps);
    const pos = Position.generateBetween(lastPos[agentGeoId] ?? null, null);
    lastPos[agentGeoId] = pos;
    ops.push(...Graph.createRelation({
      fromEntity: agentGeoId, toEntity: blockId,
      type: PROPERTIES.blocks, position: pos,
    }).ops);
    console.log(`  [create] Block "Origin and development" → ${blockId}`);
  }

  // ── Step 12: "Capabilities" collection block ──────────────────────────────
  if (existingBlockNames.has("Capabilities")) {
    console.log('  [skip]   Block "Capabilities"');
  } else {
    const { id: capId, ops: capOps } = Graph.createEntity({
      name: "Capabilities",
      types: [TYPES.data_block],
      relations: {
        [PROPERTIES.data_source_type]: { toEntity: COLLECTION_DATA_SOURCE },
        [PROPERTIES.collection_item]:  resolvedCapIds.map(toEntity => ({ toEntity })),
      },
    });
    ops.push(...capOps);
    const pos = Position.generateBetween(lastPos[agentGeoId] ?? null, null);
    lastPos[agentGeoId] = pos;
    ops.push(...Graph.createRelation({
      fromEntity: agentGeoId, toEntity: capId,
      type: PROPERTIES.blocks, position: pos,
      entityRelations: { [PROPERTIES.view]: { toEntity: VIEWS.list } },
    }).ops);
    console.log(`  [create] Block "Capabilities" → ${capId}`);
  }

  // ── Step 13: Avatar ────────────────────────────────────────────────────────
  if (SKIP_IMAGE_UPLOAD) {
    console.log("  [skip]   Avatar (SKIP_IMAGE_UPLOAD=1)");
  } else if (hasRelType(ContentIds.AVATAR_PROPERTY)) {
    console.log("  [skip]   Avatar (already exists)");
  } else {
    try {
      const buf = await fetchResized(agent.avatar_url, 512, 512);
      const id  = await uploadImageToGeo(buf, agent.name, ops);
      ops.push(...Graph.createRelation({ fromEntity: agentGeoId, toEntity: id, type: ContentIds.AVATAR_PROPERTY }).ops);
      console.log(`  [create] Avatar → ${id}`);
    } catch (e) { console.warn(`  ⚠️  avatar failed: ${e}`); }
  }

  // ── Step 14: Cover ─────────────────────────────────────────────────────────
  if (SKIP_IMAGE_UPLOAD) {
    console.log("  [skip]   Cover (SKIP_IMAGE_UPLOAD=1)");
  } else if (hasRelType(SPACE_PROPS.cover)) {
    console.log("  [skip]   Cover (already exists)");
  } else {
    try {
      const buf = await fetchResized(agent.cover_url, 1200, 400);
      const id  = await uploadImageToGeo(buf, agent.name, ops);
      ops.push(...Graph.createRelation({ fromEntity: agentGeoId, toEntity: id, type: SPACE_PROPS.cover }).ops);
      console.log(`  [create] Cover → ${id}`);
    } catch (e) { console.warn(`  ⚠️  cover failed: ${e}`); }
  }

  console.log(`  Ops for "${agent.name}": ${ops.length}`);
  allOps.push(...ops);
}

// ═════════════════════════════════════════════════════════════════════════════
// Publish
// ═════════════════════════════════════════════════════════════════════════════
const agentSummary = agents.map(a => a.name).join(", ");
console.log(`\n${"═".repeat(60)}`);
console.log(`ATG agent publish batch`);
console.log(`Agents: ${agentSummary}`);
console.log(`Space:  ${OUR_SPACE}`);
console.log(`Mode:   ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
console.log(`Ops:    ${allOps.length}`);
console.log(`${"═".repeat(60)}\n`);

if (allOps.length === 0) {
  console.log("Nothing to do — all already up to date.");
} else if (DRY_RUN) {
  printOps(allOps);
} else {
  await publishOps(allOps, `ATG: publish agents (${agentSummary})`);
  console.log("\nDone.");
  console.log(`View space: https://www.geobrowser.io/space/${OUR_SPACE}`);
}
