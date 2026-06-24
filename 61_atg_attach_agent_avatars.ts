/**
 * Attach local avatar images to existing ATG agent cards.
 *
 * Run:
 *   DRY_RUN=1 bun run 61_atg_attach_agent_avatars.ts
 *   DAO_VOTING_MODE=FAST AVATAR_MANIFEST=... bun run 61_atg_attach_agent_avatars.ts
 */
import dotenv from "dotenv";
import { ContentIds, Graph, type Op } from "@geoprotocol/geo-sdk";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { extname, resolve } from "path";
import { publishOps, printOps, gql } from "./src/functions.js";

dotenv.config();

const DRY_RUN = process.env.DRY_RUN === "1";
const MANIFEST_PATH =
  process.env.AVATAR_MANIFEST ??
  "geo_atg/visuals/atg_visual_manifest_showcase30_missing_avatars_2026-06-12.json";

type AvatarAsset = {
  id: string;
  target_entity_id: string;
  target_entity_name: string;
  file: string;
};

type AvatarManifest = {
  version: string;
  space_id: string;
  assets: AvatarAsset[];
};

function mimeFromPath(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

async function readAvatarTargets(spaceId: string, entityId: string): Promise<Set<string>> {
  const data = await gql(`{
    entities(spaceId: "${spaceId}" filter: { id: { in: ["${entityId}"] } }) {
      id
      name
      relations { nodes { typeId toEntity { id name } } }
    }
  }`, undefined, `read avatar for ${entityId}`);
  const nodes: { typeId: string; toEntity: { id: string } }[] =
    data?.entities?.[0]?.relations?.nodes ?? [];
  return new Set(
    nodes
      .filter(node => node.typeId === ContentIds.AVATAR_PROPERTY)
      .map(node => node.toEntity.id),
  );
}

async function createImageOps(asset: AvatarAsset, ops: Op[]): Promise<string> {
  const absolutePath = resolve(process.cwd(), asset.file);
  const data = readFileSync(absolutePath);
  const b64 = `data:${mimeFromPath(absolutePath)};base64,${data.toString("base64")}`;
  const { id, ops: imageOps } = await Graph.createImage({
    url: b64,
    name: `${asset.target_entity_name} avatar`,
    network: "TESTNET",
  });
  ops.push(...imageOps);
  return id;
}

const manifest: AvatarManifest = JSON.parse(readFileSync(resolve(process.cwd(), MANIFEST_PATH), "utf8"));

console.log("\nATG avatar attacher");
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
    attached: 0,
    missingFile: 0,
    alreadyHasAvatar: 0,
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

  const existingAvatars = await readAvatarTargets(manifest.space_id, asset.target_entity_id);
  if (existingAvatars.size > 0 && process.env.ADD_SECOND_AVATAR !== "1") {
    console.log(`  [skip] entity already has Avatar (${existingAvatars.size})`);
    report.totals.alreadyHasAvatar++;
    report.assets.push({ id: asset.id, status: "already_has_avatar", entityId: asset.target_entity_id });
    continue;
  }

  const imageId = await createImageOps(asset, ops);
  ops.push(
    ...Graph.createRelation({
      fromEntity: asset.target_entity_id,
      toEntity: imageId,
      type: ContentIds.AVATAR_PROPERTY,
    }).ops,
  );
  console.log(`  [add] Avatar image → ${imageId}`);
  report.totals.attached++;
  report.assets.push({
    id: asset.id,
    status: "attach",
    entityId: asset.target_entity_id,
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
  `geo_atg/visuals/atg_avatar_attach_report_${DRY_RUN ? "dry_run" : "live"}_${Date.now()}.json`,
);
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\nReport: ${reportPath}\n`);

if (ops.length === 0) {
  console.log("Nothing to publish.");
} else if (DRY_RUN) {
  printOps(ops);
} else {
  await publishOps(ops, "ATG showcase-30: attach missing agent avatars");
  console.log(`\nView space: https://www.geobrowser.io/space/${manifest.space_id}`);
}
