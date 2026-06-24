/**
 * Replace existing agent Cover relations with curated official cover images.
 *
 * Unlike 47_atg_attach_visuals.ts, this script deletes current Cover relations
 * for the target cards before attaching the new cover. Use only for reviewed
 * replacement manifests.
 *
 *   VISUAL_REPLACE_MANIFEST=geo_atg/visuals/atg_visual_manifest_showcase30_replace_generated_covers_2026-06-12.json DRY_RUN=1 bun run 60_atg_replace_agent_covers.ts
 *   DAO_VOTING_MODE=FAST VISUAL_REPLACE_MANIFEST=... bun run 60_atg_replace_agent_covers.ts
 */
import dotenv from "dotenv";
import { Graph, type Op } from "@geoprotocol/geo-sdk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { extname, resolve } from "path";
import { gql, printOps, publishOps } from "./src/functions.js";

dotenv.config();

const DRY_RUN = process.env.DRY_RUN === "1";
const MANIFEST_PATH =
  process.env.VISUAL_REPLACE_MANIFEST ??
  "geo_atg/visuals/atg_visual_manifest_showcase30_replace_generated_covers_2026-06-12.json";

const REL_COVER = "34f535072e6b42c5a84443981a77cfa2";
const REL_TYPES = "8f151ba4de204e3c9cb499ddf96f48f1";
const AGENT_TYPE_ID = "9069cd7680cabc7b5e7aace5bc0da4d3";

type VisualAsset = {
  id: string;
  target_entity_name: string;
  target_kind: string;
  relation: "cover";
  file: string;
  source_url?: string;
  prompt?: string;
};

type VisualManifest = {
  version: string;
  space_id: string;
  assets: VisualAsset[];
};

type EntityLookup = {
  id: string;
  name: string;
  relations: {
    nodes: {
      id: string;
      typeId: string;
      toEntity: { id: string; name: string | null };
    }[];
  };
};

function mimeFromPath(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

function hasType(entity: EntityLookup, typeId: string): boolean {
  return entity.relations.nodes.some(node => node.typeId === REL_TYPES && node.toEntity.id === typeId);
}

async function queryEntityByName(spaceId: string, name: string, targetKind: string): Promise<EntityLookup | null> {
  const nameCandidates = Array.from(new Set([
    name,
    name.toLowerCase(),
    name.replace(/\s+/g, "-").toLowerCase(),
  ]));
  const data = await gql(`{
    entities(spaceId: "${spaceId}" filter: { name: { in: ${JSON.stringify(nameCandidates)} } }) {
      id
      name
      relations { nodes { id typeId toEntity { id name } } }
    }
  }`, undefined, `lookup "${name}"`);
  const entities = ((data?.entities ?? []) as EntityLookup[]);
  const candidateSet = new Set(nameCandidates.map(v => v.toLowerCase()));
  const exact = entities.filter(e => candidateSet.has(e.name.toLowerCase()));
  if (targetKind === "agent") {
    return exact.find(e => hasType(e, AGENT_TYPE_ID)) ?? exact[0] ?? null;
  }
  return exact[0] ?? null;
}

function coverRelations(entity: EntityLookup): { id: string; imageId: string; imageName: string | null }[] {
  return entity.relations.nodes
    .filter(node => node.typeId === REL_COVER)
    .map(node => ({ id: node.id, imageId: node.toEntity.id, imageName: node.toEntity.name }));
}

async function createImageOps(asset: VisualAsset, ops: Op[]): Promise<string> {
  const absolutePath = resolve(process.cwd(), asset.file);
  const data = readFileSync(absolutePath);
  const b64 = `data:${mimeFromPath(absolutePath)};base64,${data.toString("base64")}`;
  const { id, ops: imageOps } = await Graph.createImage({
    url: b64,
    name: `${asset.target_entity_name} cover`,
    network: "TESTNET",
  });
  ops.push(...imageOps);
  return id;
}

const manifest: VisualManifest = JSON.parse(readFileSync(resolve(process.cwd(), MANIFEST_PATH), "utf8"));

console.log("\nATG cover replacement");
console.log(`Space:    ${manifest.space_id}`);
console.log(`Mode:     ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
console.log(`Manifest: ${MANIFEST_PATH}`);
console.log(`Assets:   ${manifest.assets.length}\n`);

const ops: Op[] = [];
const report = {
  version: manifest.version,
  mode: DRY_RUN ? "dry_run" : "live",
  assets: [] as Record<string, unknown>[],
  totals: {
    selected: manifest.assets.length,
    replaced: 0,
    attachedWithoutExisting: 0,
    deletedCoverRelations: 0,
    missingFile: 0,
    missingEntity: 0,
    ops: 0,
  },
};

for (const asset of manifest.assets) {
  console.log(`▸ ${asset.id} → ${asset.target_entity_name}`);
  const absolutePath = resolve(process.cwd(), asset.file);
  if (!existsSync(absolutePath)) {
    console.log(`  [missing-file] ${asset.file}`);
    report.totals.missingFile++;
    report.assets.push({ id: asset.id, status: "missing_file", file: asset.file });
    continue;
  }

  const entity = await queryEntityByName(manifest.space_id, asset.target_entity_name, asset.target_kind);
  if (!entity) {
    console.log(`  [missing-entity] ${asset.target_entity_name}`);
    report.totals.missingEntity++;
    report.assets.push({ id: asset.id, status: "missing_entity", target: asset.target_entity_name });
    continue;
  }

  const existingCovers = coverRelations(entity);
  for (const rel of existingCovers) {
    ops.push(...Graph.deleteRelation({ id: rel.id }).ops);
    console.log(`  [delete] old Cover relation ${rel.id} → ${rel.imageName ?? rel.imageId}`);
  }
  report.totals.deletedCoverRelations += existingCovers.length;

  const imageId = await createImageOps(asset, ops);
  ops.push(...Graph.createRelation({ fromEntity: entity.id, toEntity: imageId, type: REL_COVER }).ops);
  console.log(`  [add] new Cover image → ${imageId}`);

  if (existingCovers.length > 0) report.totals.replaced++;
  else report.totals.attachedWithoutExisting++;

  report.assets.push({
    id: asset.id,
    status: existingCovers.length > 0 ? "replace" : "attach_without_existing",
    entityId: entity.id,
    deletedCoverRelations: existingCovers,
    imageId,
    file: asset.file,
  });
}

report.totals.ops = ops.length;

console.log("\nTotals:");
console.log(JSON.stringify(report.totals, null, 2));

mkdirSync(resolve(process.cwd(), "geo_atg/visuals"), { recursive: true });
const reportPath = resolve(
  process.cwd(),
  `geo_atg/visuals/atg_cover_replace_report_${DRY_RUN ? "dry_run" : "live"}_${Date.now()}.json`,
);
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\nReport: ${reportPath}\n`);

if (ops.length === 0) {
  console.log("Nothing to publish.");
} else if (DRY_RUN) {
  printOps(ops);
} else {
  await publishOps(ops, "ATG showcase-30: replace generated covers with official covers");
  console.log(`\nView space: https://www.geobrowser.io/space/${manifest.space_id}`);
}
