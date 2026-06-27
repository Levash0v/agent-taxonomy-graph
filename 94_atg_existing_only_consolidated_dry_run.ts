/**
 * ATG clean AI space existing-only consolidated dry-run.
 *
 * Builds one reviewed proposal plan for the cards that already exist in the
 * clean AI space. It does not create missing agent cards. It enriches canonical
 * existing cards, cleans duplicate Agent typing, and prepares support nodes
 * only where needed for relations/blocks.
 *
 * Dry-run only:
 *   bun run 94_atg_existing_only_consolidated_dry_run.ts
 *
 * Optional image upload during dry-run:
 *   UPLOAD_IMAGES=1 bun run 94_atg_existing_only_consolidated_dry_run.ts
 */
import dotenv from "dotenv";
import { ContentIds, Graph, Position, type Op } from "@geoprotocol/geo-sdk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { extname, resolve } from "path";
import { gql, printOps } from "./src/functions.js";
import { COLLECTION_DATA_SOURCE, PROPERTIES, SPACE_PROPS, TYPES, VIEWS } from "./src/constants.js";

dotenv.config();

const TARGET_SPACE = process.env.TARGET_SPACE ?? process.env.SPACE_ID ?? "41e851610e13a19441c4d980f2f2ce6b";
const PLAN_PATH = process.env.PLAN_PATH ?? "geo_atg/atg_clean_ai_consolidated_patch_plan_2026-06-26.json";
const REUSE_MAP_PATH = process.env.REUSE_MAP_PATH ?? "geo_atg/atg_entity_reuse_map.clean_ai_draft_2026-06-18.json";
const UPLOAD_IMAGES = process.env.UPLOAD_IMAGES === "1";
const IMAGE_UPLOAD_LIMIT = Number.parseInt(process.env.IMAGE_UPLOAD_LIMIT ?? "0", 10);
const IMAGE_UPLOAD_OFFSET = Number.parseInt(process.env.IMAGE_UPLOAD_OFFSET ?? "0", 10);
const ALLOW_CREATE_SUPPORT = process.env.ALLOW_CREATE_SUPPORT !== "0";
const INCLUDE_CREATE_AGENTS = process.env.INCLUDE_CREATE_AGENTS === "1" || process.env.ATG_ALL_IN === "1";
const CODE_GENERATION_TARGET_ID = process.env.CODE_GENERATION_TARGET_ID ?? "";

const REL_TYPES = "8f151ba4de204e3c9cb499ddf96f48f1";
const REL_CAPABILITIES = "15f630ff5d87f0e3992fdd68567970fc";
const REL_COVER = SPACE_PROPS.cover;
const REL_DEVELOPERS = "b36bba262b6b45dabe8b6fe1d41f5f96";
const REL_FEATURES = "b3c9e2e050234801a0da05314326c439";
const REL_LICENSE_STATUS = "a79b63d453dd4938a3091ff448d36cbc";
const REL_MODELS = "968742a40c109c633de1c70a79587487";
const REL_PROTOCOLS = "27f4e74e301943a89dc573bbb6df8f00";
const REL_PROVIDED_BY = "9e6512b649d0daa76d9d6b0acd3ffdcc";
const REL_REPOSITORIES = "a25e04e2656f4700ba10e31b231b446a";
const REL_SW_LICENSES = "7fc423a18e304205988af467d1f8b84a";
const REL_USE_CASES = "a5d4d84003dd43e780d300770141388d";

const AGENT_TYPE_ID = "9069cd7680cabc7b5e7aace5bc0da4d3";
const TOOL_TYPE_ID = "fa464fe0c27b4d54bbac4caa20ca7781";
const PROJECT_TYPE_ID = TYPES.project;
const REPOSITORY_TYPE_ID = "2abc0316c1444ba9ac920e7c49337de5";
const COMM_PROTOCOL_TYPE_ID = "ecf7f8ea560f4c8bae62ef2329ae82c6";
const MODEL_TYPE_ID = "c7a4fc6d1afc53250a22d4209391dc79";
const LICENSE_TYPE_ID = "75cd9ef95879410e9ae061a1a716e8b5";
const CODE_GENERATION_CANONICAL_ID = "22b92f833dc24a3981468ad5c900c9d8";
const MODEL_TYPE_TYPE_ID = "6e754d32056a6071d034f589f2123d80";

const OPEN_SOURCE_ID = "2e267679d9b04444af89f9ba7134d7f2";
const MIT_ID = "aad29168dd2f4f7c825504835850826c";
const APACHE_2_ID = "752157c74ccc47c79fd8bba761b63b65";
const CANONICAL_CLAUDE_ID = "b78e920399ee42a3b5903fa9719fd30a";
const GPT_4O_ID = "63be2f22093e4732844206135831f8eb";
const GEMINI_ID = "aa74fb9ab37041008a7dc901a1d47e9c";
const OLLAMA_ID = "51c7b387a6f049338e07b849eb1136ef";

const PROP_GITHUB = "9eedefa860ae4ac19a04805054a4b094";
const PROP_DOCS = "a446528df6b24ecab04bc4dd7dedfbd9";
const PROP_X = "0d6259784b3c4b57a86fde45c997c73c";
const PROP_STARS = "a79523e6aaa5dfc0701711234df6af9d";
const PROP_RELEASE_DATE = "1170c5a68a015fb2addc44382fe7d0f5";
const PROP_ACTIVE = "ffab986cc06f6f288efae9db7c4a3fdc";
const PROP_SKILLS = "45509a98a0a2473ba727f7b170ed813b";

const REQUIRED_AGENT_TYPES = [PROJECT_TYPE_ID, AGENT_TYPE_ID, TOOL_TYPE_ID];

// Product affordances; all other capability slugs go to REL_CAPABILITIES.
const FEATURE_SLUGS = new Set([
  "model_routing",
  "prompt_caching",
  "parallel_tool_calls",
  "streaming",
  "structured_outputs",
  "function_calling",
  "live_preview",
  "multi_file_edits",
  "code_review",
  "git_integration",
  "plugin_extensions",
]);

const FIXED_TARGET_IDS: Record<string, string> = {
  "capability:deployment": "e86c157fbc114804a8b774686d712b23",
  "capability:multi_agent_orchestration": "a7e5eed43d354c6c8fbd06a130c125d6",
  "capability:evaluation": "302788bbdba54305af609fe2cc4f318e",
  "capability:web_search": "0f6d318db185469a82c4d0d063215b9e",
  "feature:plugin_extensions": "fcbd41fa6752442d9d4af51025497415",
  "feature:prompt_caching": "c24c77f699104357a2216ec1d657f74c",
  "feature:structured_outputs": "b30f6d24f6e542e7a63c88f05e659f16",
  "model:claude": CANONICAL_CLAUDE_ID,
  "model:gpt-4o": GPT_4O_ID,
  "model:gemini": GEMINI_ID,
  "model:ollama": OLLAMA_ID,
  "license:mit": MIT_ID,
  "license:apache-2.0": APACHE_2_ID,
};

if (CODE_GENERATION_TARGET_ID) {
  FIXED_TARGET_IDS["capability:code_generation"] = CODE_GENERATION_TARGET_ID;
}

const CANONICAL_NAMES: Record<string, string> = {
  "capability:tool_use": "Tool use",
  "capability:browser_control": "Browser control",
  "capability:computer_use": "Computer use",
  "capability:file_system_access": "File system access",
  "capability:shell_execution": "Shell execution",
  "capability:terminal_access": "Terminal access",
  "capability:human_in_the_loop": "Human-in-the-loop",
  "capability:multi_agent_orchestration": "Multi-agent orchestration",
  "capability:persistent_memory": "Persistent memory",
  "capability:context_management": "Context management",
  "capability:workflow_orchestration": "Workflow orchestration",
  "capability:long_running_tasks": "Long-running tasks",
  "capability:state_management": "State management",
  "capability:observability_tracing": "Observability tracing",
  "feature:model_routing": "Model routing",
  "feature:multi_file_edits": "Multi-file edits",
  "feature:plugin_extensions": "Plugin extensions",
  "protocol:mcp": "Model Context Protocol (MCP)",
  "protocol:openai-tool-call": "OpenAI tool call format",
  "protocol:openapi": "OpenAPI / REST",
  "model:any": "Model-agnostic",
  "model:openai": "OpenAI model family",
  "model:grok-3": "Grok 3",
  "model:grok-3-mini": "Grok 3 Mini",
  "license:agpl-3.0": "GNU Affero GPL v3.0",
  "license:gpl-3.0": "GNU GPL v3.0",
  "license:proprietary": "Proprietary",
};

const plannedImageKeys = new Set<string>();
let plannedImageIndex = 0;
let uploadedImageCount = 0;

type ValueNode = {
  propertyId: string;
  text?: string | null;
  integer?: string | number | null;
  boolean?: boolean | null;
  date?: string | null;
};

type RelationNode = {
  id: string;
  typeId: string;
  toEntity: { id: string; name: string | null };
};

type EntityNode = {
  id: string;
  name: string;
  description?: string | null;
  values?: { nodes: ValueNode[] };
  relations?: { nodes: RelationNode[] };
};

type AgentRow = {
  id: string;
  name: string;
  description?: string | null;
  organization?: string | null;
  primary_category?: string | null;
  primary_use_case?: string | null;
  visibility_class?: string | null;
  license?: string | null;
  stars_at_collection?: number | null;
  release_date?: string | null;
  website_url?: string | null;
  github_url?: string | null;
  docs_url?: string | null;
  x_url?: string | null;
  capabilities?: string[];
  features?: string[];
  protocols?: string[];
  models?: string[];
  domains?: string[];
  skills_count?: number | null;
};

type OrgRow = {
  id?: string;
  slug?: string;
  name?: string;
  description?: string;
  web_url?: string;
  x_url?: string;
  source_url?: string;
};

type TargetSpec = {
  id: string;
  name: string;
  description?: string | null;
  source_url?: string | null;
  spec_url?: string | null;
  leaderboard_url?: string | null;
  url?: string | null;
};

type PlanRow = {
  agent_id: string;
  batch: string;
  name: string;
  action: string;
  canonical_entity_id?: string | null;
  relation_plan?: {
    missing_type_relations?: string[];
    blocks_missing?: string[];
  };
  visual?: {
    approved?: boolean;
    cover?: { path?: string | null; exists?: boolean };
    avatar?: { path?: string | null; exists?: boolean };
    live_cover_count?: number;
    live_avatar_count?: number;
  };
  edge_targets?: Record<string, TargetSpec[]>;
};

type Plan = {
  rows: PlanRow[];
  target_specs: Record<string, Record<string, TargetSpec>>;
  duplicate_cleanup: {
    name: string;
    canonical: string;
    cleanup_candidates: string[];
  }[];
};

type ReuseMap = {
  capabilities?: Record<string, string>;
  features?: Record<string, string>;
  protocols?: Record<string, string>;
  orgs?: Record<string, string>;
  agents?: Record<string, string>;
};

type ResolvedTarget = {
  id: string;
  name: string;
  status: "reuse" | "create";
  entity?: EntityNode;
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8")) as T;
}

function writeJson(path: string, value: unknown) {
  mkdirSync(resolve(process.cwd(), "geo_atg"), { recursive: true });
  writeFileSync(resolve(process.cwd(), path), JSON.stringify(value, jsonBigint, 2));
}

function jsonBigint(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function normalizeName(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function slugToName(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map(part => part.length <= 3 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function validUrl(value: string | null | undefined): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim()) && !/https?:\/\/null/i.test(value);
}

function normalizeReleaseDate(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  if (/^\d{4}$/.test(raw)) return `${raw}-01-01`;
  return null;
}

function relationTargets(entity: EntityNode, relationType: string): Set<string> {
  return new Set((entity.relations?.nodes ?? []).filter(node => node.typeId === relationType).map(node => node.toEntity.id));
}

function relationNodes(entity: EntityNode, relationType: string): RelationNode[] {
  return (entity.relations?.nodes ?? []).filter(node => node.typeId === relationType);
}

function hasType(entity: EntityNode, typeId: string): boolean {
  return relationTargets(entity, REL_TYPES).has(typeId);
}

function blockNames(entity: EntityNode): Set<string> {
  return new Set(relationNodes(entity, PROPERTIES.blocks).map(node => node.toEntity.name ?? ""));
}

function valueNodes(entity: EntityNode, propertyId: string): ValueNode[] {
  return (entity.values?.nodes ?? []).filter(node => node.propertyId === propertyId);
}

function firstValue(entity: EntityNode, propertyId: string): unknown {
  const node = valueNodes(entity, propertyId)[0];
  if (!node) return undefined;
  return node.text ?? node.integer ?? node.boolean ?? node.date ?? undefined;
}

function hasNonEmptyValue(entity: EntityNode, propertyId: string): boolean {
  return valueNodes(entity, propertyId).some(node => {
    const value = node.text ?? node.integer ?? node.boolean ?? node.date;
    return value !== null && value !== undefined && String(value).trim() !== "";
  });
}

function mimeFromPath(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

async function queryEntitiesByIds(ids: string[], label: string): Promise<EntityNode[]> {
  const out: EntityNode[] = [];
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = unique(ids.slice(i, i + 40).filter(Boolean));
    if (chunk.length === 0) continue;
    const data = await gql(
      `query($space: UUID!, $ids: [UUID!]!) {
        entities(spaceId: $space first: 1000 filter: { id: { in: $ids } }) {
          id
          name
          description
          values(first: 1000) {
            nodes { propertyId text integer boolean date }
          }
          relations(first: 1000) {
            nodes { id typeId toEntity { id name } }
          }
        }
      }`,
      { space: TARGET_SPACE, ids: chunk },
      `${label}: ids ${i}-${i + chunk.length}`,
    );
    out.push(...((data?.entities ?? []) as EntityNode[]));
  }
  return out;
}

async function queryEntitiesByNames(names: string[], label: string): Promise<EntityNode[]> {
  const out: EntityNode[] = [];
  const normalized = unique(names.map(name => name.trim()).filter(Boolean));
  for (let i = 0; i < normalized.length; i += 40) {
    const chunk = normalized.slice(i, i + 40);
    const data = await gql(
      `query($space: UUID!, $names: [String!]!) {
        entities(spaceId: $space first: 1000 filter: { name: { in: $names } }) {
          id
          name
          description
          values(first: 1000) {
            nodes { propertyId text integer boolean date }
          }
          relations(first: 1000) {
            nodes { id typeId toEntity { id name } }
          }
        }
      }`,
      { space: TARGET_SPACE, names: chunk },
      `${label}: names ${i}-${i + chunk.length}`,
    );
    out.push(...((data?.entities ?? []) as EntityNode[]));
  }
  return out;
}

function indexByName(entities: EntityNode[]): Map<string, EntityNode[]> {
  const map = new Map<string, EntityNode[]>();
  for (const entity of entities) {
    const key = normalizeName(entity.name);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(entity);
  }
  return map;
}

function addRelIfMissing(
  ops: Op[],
  entity: EntityNode,
  from: string,
  to: string,
  type: string,
): "added" | "existing" {
  if (relationTargets(entity, type).has(to)) return "existing";
  ops.push(...Graph.createRelation({ fromEntity: from, toEntity: to, type }).ops);
  entity.relations ??= { nodes: [] };
  entity.relations.nodes.push({ id: `local-${ops.length}`, typeId: type, toEntity: { id: to, name: null } });
  return "added";
}

function addEntityValues(ops: Op[], agent: AgentRow, entity: EntityNode, reportItem: Record<string, unknown>) {
  const values: any[] = [];
  const unset: { property: string }[] = [];

  const textFields: [string, string | null | undefined, string][] = [
    [PROPERTIES.web_url, agent.website_url, "Website"],
    [PROP_GITHUB, agent.github_url, "GitHub"],
    [PROP_DOCS, agent.docs_url, "Docs"],
    [PROP_X, agent.x_url, "X"],
  ];

  const valueActions: Record<string, unknown>[] = [];
  for (const [property, rawValue, label] of textFields) {
    if (validUrl(rawValue)) {
      const current = firstValue(entity, property);
      if (String(current ?? "") !== rawValue) {
        values.push({ property, type: "text", value: rawValue });
        valueActions.push({ field: label, action: "set", value: rawValue });
      }
      continue;
    }

    const currentValues = valueNodes(entity, property);
    const hasBadNull = currentValues.some(node => {
      const value = node.text ?? "";
      return value === "null" || value === "https://null" || value === "http://null";
    });
    if (hasBadNull) {
      unset.push({ property });
      valueActions.push({ field: label, action: "unset_bad_null" });
    }
  }

  if (Number.isInteger(agent.stars_at_collection) && (agent.stars_at_collection ?? 0) > 0) {
    const stars = BigInt(agent.stars_at_collection!);
    if (String(firstValue(entity, PROP_STARS) ?? "") !== String(stars)) {
      values.push({ property: PROP_STARS, type: "integer", value: stars });
      valueActions.push({ field: "GitHub stars", action: "set_integer", value: agent.stars_at_collection });
    }
  } else if (!validUrl(agent.github_url) && valueNodes(entity, PROP_STARS).some(node => String(node.integer ?? node.text ?? "") === "0")) {
    unset.push({ property: PROP_STARS });
    valueActions.push({ field: "GitHub stars", action: "unset_zero_without_github" });
  }

  const releaseDate = normalizeReleaseDate(agent.release_date);
  if (releaseDate && String(firstValue(entity, PROP_RELEASE_DATE) ?? "") !== releaseDate) {
    values.push({ property: PROP_RELEASE_DATE, type: "date", value: releaseDate });
    valueActions.push({ field: "Release date", action: "set_date", value: releaseDate });
  }

  if (firstValue(entity, PROP_ACTIVE) !== true) {
    values.push({ property: PROP_ACTIVE, type: "boolean", value: true });
    valueActions.push({ field: "Actively maintained", action: "set_true" });
  }

  if (Number.isInteger(agent.skills_count) && (agent.skills_count ?? 0) > 0) {
    const skills = BigInt(agent.skills_count!);
    if (String(firstValue(entity, PROP_SKILLS) ?? "") !== String(skills)) {
      values.push({ property: PROP_SKILLS, type: "integer", value: skills });
      valueActions.push({ field: "Skills count", action: "set_integer", value: agent.skills_count });
    }
  }

  if (values.length > 0 || unset.length > 0) {
    ops.push(...Graph.updateEntity({ id: entity.id, values, unset }).ops);
  }
  reportItem.valueActions = valueActions;
}

function repoNameFromUrl(url: string): string {
  const match = url.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!match) return url;
  return `${match[1]}/${match[2].replace(/\.git$/, "")}`;
}

function specUrl(spec: TargetSpec): string | null {
  return spec.source_url ?? spec.spec_url ?? spec.leaderboard_url ?? spec.url ?? null;
}

function typeIdsForKind(kind: string): string[] {
  switch (kind) {
    case "repo": return [REPOSITORY_TYPE_ID];
    case "org": return [PROJECT_TYPE_ID];
    case "protocol": return [COMM_PROTOCOL_TYPE_ID];
    case "model": return [MODEL_TYPE_ID];
    case "license": return [LICENSE_TYPE_ID];
    case "benchmark": return [TYPES.dataset];
    default: return [TYPES.topic];
  }
}

function supportVisualPaths(kind: string, slug: string): { cover?: string; avatar?: string } {
  if (kind === "repo") {
    const genericRepoCover = "geo_atg/visuals/generated/repository-generic-cover.png";
    return {
      cover: existsSync(resolve(process.cwd(), genericRepoCover)) ? genericRepoCover : undefined,
    };
  }
  const dashed = slug.replace(/_/g, "-");
  const paths = [
    {
      cover: `geo_atg/visuals/generated/taxonomy_bootstrap/${kind}-${dashed}-cover.png`,
      avatar: `geo_atg/visuals/generated/taxonomy_bootstrap/${kind}-${dashed}-avatar.png`,
    },
    {
      cover: `geo_atg/visuals/generated/taxonomy_bootstrap/${kind}-${slug}-cover.png`,
      avatar: `geo_atg/visuals/generated/taxonomy_bootstrap/${kind}-${slug}-avatar.png`,
    },
    {
      cover: `geo_atg/visuals/generated/taxonomy_bootstrap_runtime/${kind}-${dashed}-cover.png`,
      avatar: `geo_atg/visuals/generated/taxonomy_bootstrap_runtime/${kind}-${dashed}-avatar.png`,
    },
    {
      cover: `geo_atg/visuals/generated/taxonomy_bootstrap_runtime/${kind}-${slug}-cover.png`,
      avatar: `geo_atg/visuals/generated/taxonomy_bootstrap_runtime/${kind}-${slug}-avatar.png`,
    },
    {
      cover: `geo_atg/visuals/generated/${kind}-${dashed}-cover.png`,
      avatar: `geo_atg/visuals/generated/derived_avatars/${kind}-${dashed}-avatar.png`,
    },
  ];
  const cover = paths.map(path => path.cover).find(path => existsSync(resolve(process.cwd(), path)));
  const avatar = paths.map(path => path.avatar).find(path => existsSync(resolve(process.cwd(), path)));
  return { cover, avatar };
}

async function maybeAttachImage(
  ops: Op[],
  entity: EntityNode,
  relationType: string,
  file: string | undefined,
  label: string,
  report: Record<string, unknown>[],
) {
  if (!file) return;
  if (!existsSync(resolve(process.cwd(), file))) return;
  if (relationTargets(entity, relationType).size > 0) return;
  const imageKey = `${entity.id}:${relationType}:${file}`;
  if (plannedImageKeys.has(imageKey)) return;
  plannedImageKeys.add(imageKey);
  const sequence = plannedImageIndex++;

  if (!UPLOAD_IMAGES) {
    report.push({ entityId: entity.id, entityName: entity.name, relationType, file, status: "planned_upload_skipped", label, sequence });
    return;
  }

  if (sequence < IMAGE_UPLOAD_OFFSET) {
    report.push({ entityId: entity.id, entityName: entity.name, relationType, file, status: "upload_offset_skipped", label, sequence });
    return;
  }
  if (IMAGE_UPLOAD_LIMIT > 0 && uploadedImageCount >= IMAGE_UPLOAD_LIMIT) {
    report.push({ entityId: entity.id, entityName: entity.name, relationType, file, status: "upload_limit_skipped", label, sequence });
    return;
  }

  uploadedImageCount++;
  console.log(`  [image ${sequence}] upload ${label}: ${entity.name} ← ${file}`);
  const absolutePath = resolve(process.cwd(), file);
  const data = readFileSync(absolutePath);
  const b64 = `data:${mimeFromPath(absolutePath)};base64,${data.toString("base64")}`;
  const { id, ops: imageOps } = await Graph.createImage({
    url: b64,
    name: `${entity.name} ${label}`,
    network: "TESTNET",
  });
  ops.push(...imageOps);
  ops.push(...Graph.createRelation({ fromEntity: entity.id, toEntity: id, type: relationType }).ops);
  entity.relations ??= { nodes: [] };
  entity.relations.nodes.push({ id: `local-${ops.length}`, typeId: relationType, toEntity: { id, name: `${entity.name} ${label}` } });
  report.push({ entityId: entity.id, entityName: entity.name, relationType, file, status: "attached", imageId: id, label, sequence });
}

function makeTargetSpec(kind: string, slug: string, spec?: TargetSpec): TargetSpec {
  const key = `${kind}:${slug}`;
  return {
    id: slug,
    name: CANONICAL_NAMES[key] ?? spec?.name ?? slugToName(slug),
    description: spec?.description ?? "",
    source_url: spec?.source_url ?? spec?.spec_url ?? spec?.leaderboard_url ?? spec?.url ?? null,
  };
}

function candidateNames(kind: string, slug: string, spec: TargetSpec): string[] {
  const key = `${kind}:${slug}`;
  const names = kind === "model"
    ? [CANONICAL_NAMES[key], spec.name].filter(Boolean) as string[]
    : [CANONICAL_NAMES[key], spec.name, slugToName(slug)].filter(Boolean) as string[];
  if (kind === "capability") {
    if (slug === "tool_use") names.push("Tool use / function calling");
    if (slug === "browser_control") names.push("Browser / web automation");
    if (slug === "file_system_access") names.push("File system access");
    if (slug === "shell_execution") names.push("Shell / terminal execution");
  }
  if (kind === "protocol" && slug === "mcp") names.push("MCP");
  return unique(names);
}

function preferredTypeForKind(kind: string): string | null {
  switch (kind) {
    case "repo": return REPOSITORY_TYPE_ID;
    case "org": return PROJECT_TYPE_ID;
    case "protocol": return COMM_PROTOCOL_TYPE_ID;
    case "model": return MODEL_TYPE_ID;
    case "license": return LICENSE_TYPE_ID;
    case "benchmark": return TYPES.dataset;
    default: return null;
  }
}

async function main() {
  console.log(INCLUDE_CREATE_AGENTS
    ? "\nATG all-in consolidated dry-run builder"
    : "\nATG existing-only consolidated dry-run builder");
  console.log(`Target space: ${TARGET_SPACE}`);
  console.log(`Plan:         ${PLAN_PATH}`);
  console.log(`Upload images: ${UPLOAD_IMAGES ? "yes" : "no"}`);
  if (UPLOAD_IMAGES) {
    console.log(`Image offset: ${IMAGE_UPLOAD_OFFSET}`);
    console.log(`Image limit:  ${IMAGE_UPLOAD_LIMIT > 0 ? IMAGE_UPLOAD_LIMIT : "none"}`);
  }

  const plan = readJson<Plan>(PLAN_PATH);
  const reuseMap = existsSync(resolve(process.cwd(), REUSE_MAP_PATH))
    ? readJson<ReuseMap>(REUSE_MAP_PATH)
    : {};
  const agents = new Map<string, AgentRow>();
  for (const batch of ["A", "B", "C", "D"]) {
    for (const agent of readJson<AgentRow[]>(`geo_atg/atg_agents_batch${batch}_publish.json`)) {
      agents.set(agent.id, agent);
    }
  }

  const orgs = new Map<string, OrgRow>();
  for (const file of [
    "geo_atg/atg_orgs_batchA_fixed.json",
    "geo_atg/atg_orgs_batchA_publish.json",
    "geo_atg/atg_orgs_batchB_publish.json",
    "geo_atg/atg_orgs_batchC_publish.json",
    "geo_atg/atg_orgs_batchD_publish.json",
    "geo_atg/atg_orgs_remaining95_publish.json",
  ]) {
    if (!existsSync(resolve(process.cwd(), file))) continue;
    for (const org of readJson<OrgRow[]>(file)) {
      const id = org.id ?? org.slug;
      if (id && !orgs.has(id)) orgs.set(id, org);
      else if (id && file.includes("fixed")) orgs.set(id, org);
    }
  }

  const uniqueRows: PlanRow[] = [];
  const seenCanonical = new Set<string>();
  const seenCreateAgent = new Set<string>();
  const batchRank: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
  for (const row of [...plan.rows].sort((a, b) => (batchRank[a.batch] ?? 9) - (batchRank[b.batch] ?? 9))) {
    if (row.action === "enrich_existing" && row.canonical_entity_id) {
      if (seenCanonical.has(row.canonical_entity_id)) continue;
      seenCanonical.add(row.canonical_entity_id);
      uniqueRows.push(row);
      continue;
    }
    if (INCLUDE_CREATE_AGENTS && row.action === "create_agent") {
      if (seenCreateAgent.has(row.agent_id)) continue;
      seenCreateAgent.add(row.agent_id);
      uniqueRows.push(row);
    }
  }

  const canonicalIds = uniqueRows.map(row => row.canonical_entity_id!).filter(Boolean);
  const cleanupIds = plan.duplicate_cleanup.flatMap(item => item.cleanup_candidates);
  const reuseIds = [
    ...Object.values(FIXED_TARGET_IDS),
    ...Object.values(reuseMap.capabilities ?? {}),
    ...Object.values(reuseMap.features ?? {}),
    ...Object.values(reuseMap.protocols ?? {}),
    ...Object.values(reuseMap.orgs ?? {}),
  ];
  console.log("Reading live existing agents and known targets...");
  const liveEntities = await queryEntitiesByIds(unique([...canonicalIds, ...cleanupIds, ...reuseIds]), "read existing agents/known targets");
  const liveById = new Map(liveEntities.map(entity => [entity.id, entity]));
  const createRows = uniqueRows.filter(row => row.action === "create_agent");
  const liveCreateNameCandidates = INCLUDE_CREATE_AGENTS
    ? await queryEntitiesByNames(createRows.map(row => row.name), "guard existing create-agent names")
    : [];
  const liveCreateByName = indexByName(liveCreateNameCandidates);

  const supportNameCandidates: string[] = [];
  for (const row of uniqueRows) {
    const agent = agents.get(row.agent_id);
    if (!agent) continue;
    if (validUrl(agent.github_url)) supportNameCandidates.push(repoNameFromUrl(agent.github_url));

    const org = agent.organization ? orgs.get(agent.organization) : null;
    if (org?.name) supportNameCandidates.push(org.name);
    else if (agent.organization) supportNameCandidates.push(slugToName(agent.organization));

    for (const slug of agent.capabilities ?? []) {
      if (slug === "mcp_client" || slug === "mcp_server") continue;
      if (slug === "code_generation" && !CODE_GENERATION_TARGET_ID) continue;
      const kind = FEATURE_SLUGS.has(slug) ? "feature" : "capability";
      const spec = makeTargetSpec(kind, slug, plan.target_specs[kind === "feature" ? "Capabilities" : "Capabilities"]?.[slug]);
      supportNameCandidates.push(...candidateNames(kind, slug, spec));
    }
    for (const slug of agent.features ?? []) {
      const spec = makeTargetSpec("feature", slug, plan.target_specs.Capabilities?.[slug]);
      supportNameCandidates.push(...candidateNames("feature", slug, spec));
    }
    for (const slug of unique([
      ...(agent.protocols ?? []),
      ((agent.capabilities ?? []).includes("mcp_client") || (agent.capabilities ?? []).includes("mcp_server")) ? "mcp" : "",
    ])) {
      if (!slug) continue;
      const spec = makeTargetSpec("protocol", slug, plan.target_specs.Protocols?.[slug]);
      supportNameCandidates.push(...candidateNames("protocol", slug, spec));
    }
    for (const slug of agent.models ?? []) {
      const spec = makeTargetSpec("model", slug, plan.target_specs.Models?.[slug]);
      supportNameCandidates.push(...candidateNames("model", slug, spec));
    }
    for (const slug of agent.domains ?? []) {
      const spec = makeTargetSpec("domain", slug, plan.target_specs.Domains?.[slug]);
      supportNameCandidates.push(...candidateNames("domain", slug, spec));
    }
    const license = (agent.license ?? "").toLowerCase();
    if (license && license !== "noassertion") {
      const spec = makeTargetSpec("license", license, plan.target_specs.Licenses?.[license]);
      supportNameCandidates.push(...candidateNames("license", license, spec));
      supportNameCandidates.push(license === "proprietary" ? "Proprietary" : "Open source");
    }
    for (const targets of Object.values(row.edge_targets ?? {})) {
      for (const target of targets) supportNameCandidates.push(target.name);
    }
  }

  console.log("Reading reusable support targets by name...");
  const supportEntities = await queryEntitiesByNames(supportNameCandidates, "read/reuse support targets");
  for (const entity of liveEntities) {
    if (!supportEntities.some(item => item.id === entity.id)) supportEntities.push(entity);
  }
  const byName = indexByName(supportEntities);
  const targetRegistry = new Map<string, ResolvedTarget>();
  const recordedTargetKeys = new Set<string>();
  const canonicalAgentByName = new Map<string, string>();
  for (const row of uniqueRows) {
    if (row.canonical_entity_id) canonicalAgentByName.set(normalizeName(row.name), row.canonical_entity_id);
  }

  function reuseIdFor(kind: string, slug: string): string | undefined {
    if (kind === "capability") return reuseMap.capabilities?.[slug];
    if (kind === "feature") return reuseMap.features?.[slug];
    if (kind === "protocol") return reuseMap.protocols?.[slug];
    if (kind === "org") return reuseMap.orgs?.[slug];
    return undefined;
  }

  function recordTarget(key: string, kind: string, slug: string, resolved: ResolvedTarget) {
    if (recordedTargetKeys.has(key)) return;
    recordedTargetKeys.add(key);
    manifest.targets.push({
      kind,
      slug,
      name: resolved.name,
      id: resolved.id,
      status: resolved.status,
    });
  }

  function findExisting(names: string[], kind?: string): EntityNode | null {
    const typeId = kind ? preferredTypeForKind(kind) : null;
    for (const name of names) {
      const candidates = byName.get(normalizeName(name)) ?? [];
      if (kind === "org") {
        const canonicalAgentId = canonicalAgentByName.get(normalizeName(name));
        if (canonicalAgentId) {
          const canonicalEntity = liveById.get(canonicalAgentId) ?? candidates.find(item => item.id === canonicalAgentId);
          if (canonicalEntity) return canonicalEntity;
        }
      }
      if (typeId) {
        const typed = candidates.find(item => hasType(item, typeId));
        if (typed) return typed;
        if (kind === "model" || kind === "license" || kind === "repo" || kind === "protocol") continue;
      }
      const hit = candidates[0];
      if (hit) return hit;
    }
    return null;
  }

  async function resolveSupport(kind: string, slug: string, specInput?: TargetSpec | null): Promise<ResolvedTarget | null> {
    const key = `${kind}:${slug}`;
    if (targetRegistry.has(key)) return targetRegistry.get(key)!;
    const fixed = FIXED_TARGET_IDS[key] ?? reuseIdFor(kind, slug);
    if (fixed) {
      const entity = liveById.get(fixed) ?? supportEntities.find(item => item.id === fixed);
      const resolved = { id: fixed, name: entity?.name ?? CANONICAL_NAMES[key] ?? slugToName(slug), status: "reuse" as const, entity };
      targetRegistry.set(key, resolved);
      recordTarget(key, kind, slug, resolved);
      return resolved;
    }

    const spec = makeTargetSpec(kind, slug, specInput ?? undefined);
    const existing = findExisting(candidateNames(kind, slug, spec), kind);
    if (existing) {
      const resolved = { id: existing.id, name: existing.name, status: "reuse" as const, entity: existing };
      targetRegistry.set(key, resolved);
      recordTarget(key, kind, slug, resolved);
      return resolved;
    }

    if (!ALLOW_CREATE_SUPPORT) return null;

    const values = validUrl(specUrl(spec))
      ? [{ property: PROPERTIES.web_url, type: "text" as const, value: specUrl(spec)! }]
      : [];
    const { id, ops: createOps } = Graph.createEntity({
      name: spec.name,
      description: spec.description ?? undefined,
      types: typeIdsForKind(kind),
      values,
    });
    ops.push(...createOps);
    const entity: EntityNode = { id, name: spec.name, description: spec.description, relations: { nodes: [] }, values: { nodes: [] } };
    byName.set(normalizeName(spec.name), [entity]);
    const resolved = { id, name: spec.name, status: "create" as const, entity };
    targetRegistry.set(key, resolved);
    recordTarget(key, kind, slug, resolved);
    return resolved;
  }

  async function resolveOrg(agent: AgentRow): Promise<ResolvedTarget | null> {
    if (!agent.organization) return null;
    const org = orgs.get(agent.organization);
    const name = org?.name || slugToName(agent.organization);
    const key = `org:${agent.organization}`;
    if (targetRegistry.has(key)) return targetRegistry.get(key)!;
    const pinned = reuseIdFor("org", agent.organization);
    if (pinned) {
      const entity = liveById.get(pinned) ?? supportEntities.find(item => item.id === pinned);
      const resolved = { id: pinned, name: entity?.name ?? name, status: "reuse" as const, entity };
      targetRegistry.set(key, resolved);
      recordTarget(key, "org", agent.organization, resolved);
      return resolved;
    }
    const existing = findExisting([name, agent.organization], "org");
    if (existing) {
      const resolved = { id: existing.id, name: existing.name, status: "reuse" as const, entity: existing };
      targetRegistry.set(key, resolved);
      recordTarget(key, "org", agent.organization, resolved);
      return resolved;
    }
    if (!ALLOW_CREATE_SUPPORT) return null;
    const values = validUrl(org?.web_url) ? [{ property: PROPERTIES.web_url, type: "text" as const, value: org!.web_url! }] : [];
    if (validUrl(org?.x_url)) values.push({ property: PROP_X, type: "text" as const, value: org!.x_url! });
    const { id, ops: createOps } = Graph.createEntity({
      name,
      description: org?.description ?? `${name} is a maintainer/provider represented in the Agent Taxonomy Graph.`,
      types: [PROJECT_TYPE_ID],
      values,
    });
    ops.push(...createOps);
    const entity: EntityNode = { id, name, description: org?.description, relations: { nodes: [] }, values: { nodes: [] } };
    byName.set(normalizeName(name), [entity]);
    const resolved = { id, name, status: "create" as const, entity };
    targetRegistry.set(key, resolved);
    recordTarget(key, "org", agent.organization, resolved);
    return resolved;
  }

  async function resolveRepository(agent: AgentRow): Promise<ResolvedTarget | null> {
    if (!validUrl(agent.github_url)) return null;
    const name = repoNameFromUrl(agent.github_url);
    const key = `repo:${name}`;
    if (targetRegistry.has(key)) return targetRegistry.get(key)!;
    const existing = findExisting([name], "repo");
    if (existing) {
      const resolved = { id: existing.id, name: existing.name, status: "reuse" as const, entity: existing };
      targetRegistry.set(key, resolved);
      recordTarget(key, "repo", name, resolved);
      return resolved;
    }
    if (!ALLOW_CREATE_SUPPORT) return null;
    const { id, ops: createOps } = Graph.createEntity({
      name,
      description: `GitHub repository for ${agent.name}.`,
      types: [REPOSITORY_TYPE_ID],
      values: [{ property: PROPERTIES.web_url, type: "text", value: agent.github_url }],
    });
    ops.push(...createOps);
    const entity: EntityNode = { id, name, description: `GitHub repository for ${agent.name}.`, relations: { nodes: [] }, values: { nodes: [] } };
    byName.set(normalizeName(name), [entity]);
    const resolved = { id, name, status: "create" as const, entity };
    targetRegistry.set(key, resolved);
    recordTarget(key, "repo", name, resolved);
    return resolved;
  }

  async function attachSupportVisual(kind: string, slug: string, target: ResolvedTarget) {
    if (!target.entity) return;
    const paths = supportVisualPaths(kind, slug);
    await maybeAttachImage(ops, target.entity, REL_COVER, paths.cover, "cover", manifest.imageActions);
    await maybeAttachImage(ops, target.entity, ContentIds.AVATAR_PROPERTY, paths.avatar, "avatar", manifest.imageActions);
  }

  const ops: Op[] = [];
  const manifest = {
    mode: INCLUDE_CREATE_AGENTS ? "all_in_dry_run_only" : "existing_only_dry_run_only",
    targetSpace: TARGET_SPACE,
    planPath: PLAN_PATH,
    uploadImages: UPLOAD_IMAGES,
    allowCreateSupport: ALLOW_CREATE_SUPPORT,
    agents: [] as Record<string, unknown>[],
    targets: [] as Record<string, unknown>[],
    duplicateCleanup: [] as Record<string, unknown>[],
    supportTypeFixes: [] as Record<string, unknown>[],
    imageActions: [] as Record<string, unknown>[],
    skipped: [] as Record<string, unknown>[],
    totals: {
      batchRowsExisting: plan.rows.filter(row => row.action === "enrich_existing").length,
      uniqueCanonicalAgents: uniqueRows.length,
      includedCreateRows: uniqueRows.filter(row => row.action === "create_agent").length,
      excludedCreateRows: INCLUDE_CREATE_AGENTS ? 0 : plan.rows.filter(row => row.action === "create_agent").length,
      valueUpdates: 0,
      relationsAdded: 0,
      relationsExisting: 0,
      blocksAdded: 0,
      blocksExisting: 0,
      duplicateAgentTypeDeletes: 0,
      supportCreated: 0,
      supportReused: 0,
      manualReviewSkipped: 0,
      ops: 0,
    },
  };

  console.log("Building ops...");
  for (const cleanup of plan.duplicate_cleanup) {
    for (const entityId of cleanup.cleanup_candidates) {
      const entity = liveById.get(entityId);
      if (!entity) {
        manifest.skipped.push({ type: "duplicate_cleanup", entityId, reason: "missing_live_entity" });
        continue;
      }
      const typeRel = relationNodes(entity, REL_TYPES).find(node => node.toEntity.id === AGENT_TYPE_ID);
      if (!typeRel) continue;
      ops.push(...Graph.deleteRelation({ id: typeRel.id }).ops);
      manifest.duplicateCleanup.push({
        name: cleanup.name,
        canonical: cleanup.canonical,
        duplicate: entityId,
        deletedRelation: typeRel.id,
      });
      manifest.totals.duplicateAgentTypeDeletes += 1;
    }
  }

  if (CODE_GENERATION_TARGET_ID === CODE_GENERATION_CANONICAL_ID) {
    const entity = supportEntities.find(item => item.id === CODE_GENERATION_CANONICAL_ID) ?? liveById.get(CODE_GENERATION_CANONICAL_ID);
    if (entity) {
      const supportTypeFix = {
        entityId: entity.id,
        name: entity.name,
        addedTopicType: false,
        deletedModelTypeRelation: null as string | null,
      };
      const topicTypeRel = relationNodes(entity, REL_TYPES).find(node => node.toEntity.id === TYPES.topic);
      if (!topicTypeRel) {
        ops.push(...Graph.createRelation({ fromEntity: entity.id, toEntity: TYPES.topic, type: REL_TYPES }).ops);
        supportTypeFix.addedTopicType = true;
        entity.relations ??= { nodes: [] };
        entity.relations.nodes.push({ id: `local-type-${entity.id}-${TYPES.topic}`, typeId: REL_TYPES, toEntity: { id: TYPES.topic, name: "Topic" } });
      }
      const modelTypeRel = relationNodes(entity, REL_TYPES).find(node => node.toEntity.id === MODEL_TYPE_TYPE_ID);
      if (modelTypeRel) {
        ops.push(...Graph.deleteRelation({ id: modelTypeRel.id }).ops);
        supportTypeFix.deletedModelTypeRelation = modelTypeRel.id;
        entity.relations!.nodes = entity.relations!.nodes.filter(node => node.id !== modelTypeRel.id);
      }
      if (supportTypeFix.addedTopicType || supportTypeFix.deletedModelTypeRelation) {
        manifest.supportTypeFixes ??= [];
        manifest.supportTypeFixes.push(supportTypeFix);
      }
    } else {
      manifest.skipped.push({
        type: "support_type_fix",
        entityId: CODE_GENERATION_CANONICAL_ID,
        reason: "code_generation canonical entity not found in live/support cache",
      });
    }
  }

  for (const row of uniqueRows) {
    const agent = agents.get(row.agent_id);
    let entity = row.canonical_entity_id ? liveById.get(row.canonical_entity_id) : null;
    if (!agent) {
      manifest.skipped.push({ agentId: row.agent_id, reason: "missing_batch_agent" });
      continue;
    }

    if (!entity && row.action === "create_agent" && INCLUDE_CREATE_AGENTS) {
      const existing = (liveCreateByName.get(normalizeName(row.name)) ?? []).find(candidate => hasType(candidate, AGENT_TYPE_ID));
      if (existing) {
        entity = existing;
        manifest.skipped.push({
          agentId: row.agent_id,
          name: row.name,
          reason: "create_row_reused_existing_live_name",
          entityId: existing.id,
        });
      } else {
        const { id, ops: createOps } = Graph.createEntity({
          name: agent.name,
          description: agent.description,
          types: REQUIRED_AGENT_TYPES,
        });
        ops.push(...createOps);
        entity = {
          id,
          name: agent.name,
          description: agent.description,
          values: { nodes: [] },
          relations: {
            nodes: REQUIRED_AGENT_TYPES.map(typeId => ({ id: `local-type-${id}-${typeId}`, typeId: REL_TYPES, toEntity: { id: typeId, name: null } })),
          },
        };
        liveById.set(id, entity);
      }
    }

    if (!entity) {
      manifest.skipped.push({ agentId: row.agent_id, reason: "missing_live_entity" });
      continue;
    }

    const agentReport: Record<string, unknown> = {
      agentId: agent.id,
      name: agent.name,
      entityId: entity.id,
      batch: row.batch,
      action: row.action,
      relationsAdded: 0,
      blocksAdded: 0,
    };

    const beforeOps = ops.length;
    addEntityValues(ops, agent, entity, agentReport);
    if (ops.length > beforeOps) manifest.totals.valueUpdates += 1;

    for (const typeId of REQUIRED_AGENT_TYPES) {
      const status = addRelIfMissing(ops, entity, entity.id, typeId, REL_TYPES);
      if (status === "added") {
        manifest.totals.relationsAdded++;
        agentReport.relationsAdded = Number(agentReport.relationsAdded) + 1;
      } else {
        manifest.totals.relationsExisting++;
      }
    }

    const org = await resolveOrg(agent);
    if (org) {
      for (const relType of [REL_DEVELOPERS, REL_PROVIDED_BY]) {
        const status = addRelIfMissing(ops, entity, entity.id, org.id, relType);
        if (status === "added") {
          manifest.totals.relationsAdded++;
          agentReport.relationsAdded = Number(agentReport.relationsAdded) + 1;
        } else {
          manifest.totals.relationsExisting++;
        }
      }
    }

    const repo = await resolveRepository(agent);
    if (repo) {
      const status = addRelIfMissing(ops, entity, entity.id, repo.id, REL_REPOSITORIES);
      if (status === "added") {
        manifest.totals.relationsAdded++;
        agentReport.relationsAdded = Number(agentReport.relationsAdded) + 1;
      } else {
        manifest.totals.relationsExisting++;
      }
      await attachSupportVisual("repo", repo.name, repo);
    }

    const capabilitySlugs = new Set(agent.capabilities ?? []);
    const protocolSlugs = new Set(agent.protocols ?? []);
    if (capabilitySlugs.has("mcp_client") || capabilitySlugs.has("mcp_server")) protocolSlugs.add("mcp");

    for (const slug of capabilitySlugs) {
      if (slug === "mcp_client" || slug === "mcp_server") continue;
      if (slug === "code_generation" && !CODE_GENERATION_TARGET_ID) {
        manifest.skipped.push({
          agentId: agent.id,
          name: agent.name,
          type: "manual_review",
          key: "capability:code_generation",
          reason: "clean AI-space has duplicate Code generation candidates; set CODE_GENERATION_TARGET_ID to include this relation",
        });
        manifest.totals.manualReviewSkipped += 1;
        continue;
      }
      const kind = FEATURE_SLUGS.has(slug) ? "feature" : "capability";
      const relType = kind === "feature" ? REL_FEATURES : REL_CAPABILITIES;
      const target = await resolveSupport(kind, slug, makeTargetSpec(kind, slug, plan.target_specs.Capabilities?.[slug]));
      if (!target) continue;
      const status = addRelIfMissing(ops, entity, entity.id, target.id, relType);
      if (status === "added") {
        manifest.totals.relationsAdded++;
        agentReport.relationsAdded = Number(agentReport.relationsAdded) + 1;
      } else {
        manifest.totals.relationsExisting++;
      }
      await attachSupportVisual(kind, slug, target);
    }

    for (const slug of agent.features ?? []) {
      const target = await resolveSupport("feature", slug, makeTargetSpec("feature", slug, plan.target_specs.Capabilities?.[slug]));
      if (!target) continue;
      const status = addRelIfMissing(ops, entity, entity.id, target.id, REL_FEATURES);
      if (status === "added") {
        manifest.totals.relationsAdded++;
        agentReport.relationsAdded = Number(agentReport.relationsAdded) + 1;
      } else {
        manifest.totals.relationsExisting++;
      }
      await attachSupportVisual("feature", slug, target);
    }

    for (const slug of protocolSlugs) {
      const target = await resolveSupport("protocol", slug, makeTargetSpec("protocol", slug, plan.target_specs.Protocols?.[slug]));
      if (!target) continue;
      const status = addRelIfMissing(ops, entity, entity.id, target.id, REL_PROTOCOLS);
      if (status === "added") {
        manifest.totals.relationsAdded++;
        agentReport.relationsAdded = Number(agentReport.relationsAdded) + 1;
      } else {
        manifest.totals.relationsExisting++;
      }
      await attachSupportVisual("protocol", slug, target);
    }

    for (const slug of agent.models ?? []) {
      const target = await resolveSupport("model", slug, makeTargetSpec("model", slug, plan.target_specs.Models?.[slug]));
      if (!target) continue;
      const status = addRelIfMissing(ops, entity, entity.id, target.id, REL_MODELS);
      if (status === "added") {
        manifest.totals.relationsAdded++;
        agentReport.relationsAdded = Number(agentReport.relationsAdded) + 1;
      } else {
        manifest.totals.relationsExisting++;
      }
    }

    for (const slug of agent.domains ?? []) {
      const target = await resolveSupport("domain", slug, makeTargetSpec("domain", slug, plan.target_specs.Domains?.[slug]));
      if (!target) continue;
      const status = addRelIfMissing(ops, entity, entity.id, target.id, REL_USE_CASES);
      if (status === "added") {
        manifest.totals.relationsAdded++;
        agentReport.relationsAdded = Number(agentReport.relationsAdded) + 1;
      } else {
        manifest.totals.relationsExisting++;
      }
    }

    const licenseSlug = (agent.license ?? "").toLowerCase();
    if (licenseSlug && licenseSlug !== "noassertion") {
      if (licenseSlug === "proprietary") {
        const statusEntity = await resolveSupport("license", "proprietary", makeTargetSpec("license", "proprietary"));
        if (statusEntity) {
          const status = addRelIfMissing(ops, entity, entity.id, statusEntity.id, REL_LICENSE_STATUS);
          if (status === "added") manifest.totals.relationsAdded++; else manifest.totals.relationsExisting++;
        }
      } else {
        const target = await resolveSupport("license", licenseSlug, makeTargetSpec("license", licenseSlug, plan.target_specs.Licenses?.[licenseSlug]));
        if (target) {
          const status = addRelIfMissing(ops, entity, entity.id, target.id, REL_SW_LICENSES);
          if (status === "added") manifest.totals.relationsAdded++; else manifest.totals.relationsExisting++;
        }
        const status = addRelIfMissing(ops, entity, entity.id, OPEN_SOURCE_ID, REL_LICENSE_STATUS);
        if (status === "added") manifest.totals.relationsAdded++; else manifest.totals.relationsExisting++;
      }
    }

    const blockItems = new Map<string, { kind: string; slug: string; spec: TargetSpec }[]>();
    const addBlockItem = (blockName: string, kind: string, spec: TargetSpec) => {
      if (!blockItems.has(blockName)) blockItems.set(blockName, []);
      blockItems.get(blockName)!.push({ kind, slug: spec.id, spec });
    };
    for (const spec of row.edge_targets?.Edges_Runtimes ?? []) addBlockItem("Runtimes", "runtime", spec);
    for (const spec of row.edge_targets?.Edges_MemoryTypes ?? []) addBlockItem("Memory types", "memory", spec);
    for (const spec of row.edge_targets?.Edges_RiskSurface ?? []) addBlockItem("Risks", "risk", spec);
    for (const spec of row.edge_targets?.Edges_RiskMitigations ?? []) addBlockItem("Risks", "risk", spec);
    for (const spec of row.edge_targets?.Edges_Benchmarks ?? []) addBlockItem("Benchmarks", "benchmark", spec);

    const existingBlockNames = blockNames(entity);
    for (const [blockName, items] of blockItems) {
      if (existingBlockNames.has(blockName)) {
        manifest.totals.blocksExisting++;
        continue;
      }
      const targetIds: string[] = [];
      for (const item of items) {
        const target = await resolveSupport(item.kind, item.slug, item.spec);
        if (!target) continue;
        targetIds.push(target.id);
        await attachSupportVisual(item.kind, item.slug, target);
      }
      const uniqueTargetIds = unique(targetIds);
      if (uniqueTargetIds.length === 0) continue;
      const { id: blockId, ops: blockOps } = Graph.createEntity({
        name: blockName,
        types: [TYPES.data_block],
        relations: {
          [PROPERTIES.data_source_type]: { toEntity: COLLECTION_DATA_SOURCE },
          [PROPERTIES.collection_item]: uniqueTargetIds.map(toEntity => ({ toEntity })),
        },
      });
      ops.push(...blockOps);
      ops.push(...Graph.createRelation({
        fromEntity: entity.id,
        toEntity: blockId,
        type: PROPERTIES.blocks,
        position: Position.generateBetween(null, null),
        entityRelations: { [PROPERTIES.view]: { toEntity: VIEWS.list } },
      }).ops);
      existingBlockNames.add(blockName);
      manifest.totals.blocksAdded++;
      agentReport.blocksAdded = Number(agentReport.blocksAdded) + 1;
    }

    if (row.visual?.approved) {
      const coverPath = row.visual.cover?.exists ? row.visual.cover.path ?? undefined : undefined;
      const avatarPath = row.visual.avatar?.exists ? row.visual.avatar.path ?? undefined : undefined;
      await maybeAttachImage(ops, entity, REL_COVER, relationTargets(entity, REL_COVER).size === 0 ? coverPath : undefined, "cover", manifest.imageActions);
      await maybeAttachImage(ops, entity, ContentIds.AVATAR_PROPERTY, relationTargets(entity, ContentIds.AVATAR_PROPERTY).size === 0 ? avatarPath : undefined, "avatar", manifest.imageActions);
    }

    manifest.agents.push(agentReport);
  }

  manifest.totals.supportCreated = new Set(
    manifest.targets.filter(item => item.status === "create").map(item => item.id as string),
  ).size;
  manifest.totals.supportReused = new Set(
    manifest.targets.filter(item => item.status === "reuse").map(item => item.id as string),
  ).size;
  manifest.totals.ops = ops.length;
  const stamp = Date.now();
  const reportPrefix = INCLUDE_CREATE_AGENTS ? "atg_all_in_consolidated_dry_run" : "atg_existing_only_consolidated_dry_run";
  const opsPrefix = INCLUDE_CREATE_AGENTS ? "ops_atg_all_in_consolidated_dry_run" : "ops_atg_existing_only_consolidated_dry_run";
  const reportPath = `geo_atg/${reportPrefix}_${stamp}.json`;
  writeJson(reportPath, manifest);
  printOps(ops, "ops", `${opsPrefix}_${stamp}.json`);

  console.log(INCLUDE_CREATE_AGENTS
    ? "\nATG clean AI all-in consolidated dry-run"
    : "\nATG clean AI existing-only consolidated dry-run");
  console.log(`Target space: ${TARGET_SPACE}`);
  console.log(`Plan:         ${PLAN_PATH}`);
  console.log(`Agents:       ${manifest.totals.uniqueCanonicalAgents}`);
  console.log(`Excluded new: ${manifest.totals.excludedCreateRows}`);
  console.log(`Upload images: ${UPLOAD_IMAGES ? "yes" : "no (image ops planned but skipped)"}`);
  console.log(`Ops:          ${ops.length}`);
  console.log(`Report:       ${reportPath}`);
  console.log("\nDry-run only. No proposal was submitted.");
}

await main();
