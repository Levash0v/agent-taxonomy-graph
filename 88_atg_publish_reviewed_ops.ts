/**
 * Publish a reviewed ATG ops file exactly as produced by a dry-run.
 *
 * This avoids rebuilding random entity IDs between review and live publish.
 *
 * Required:
 *   CONFIRM_LIVE=1
 *   DEMO_SPACE_ID=a070b8c196f28118335186ec4b4abce7
 *   TARGET_SPACE=a070b8c196f28118335186ec4b4abce7
 *   OPS_PATH=ops/ops_....json
 *
 * Optional:
 *   PROPOSAL_NAME="ATG: publish 5 remaining agent cards"
 */
import dotenv from "dotenv";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import type { Op } from "@geoprotocol/geo-sdk";
import { publishOps } from "./src/functions.js";

dotenv.config();

const STAGING_SPACE = "a070b8c196f28118335186ec4b4abce7";
const OPS_PATH = process.env.OPS_PATH;
const TARGET_SPACE = process.env.TARGET_SPACE ?? process.env.DEMO_SPACE_ID;
const DEMO_SPACE_ID = process.env.DEMO_SPACE_ID;
const CONFIRM_LIVE = process.env.CONFIRM_LIVE === "1";
const PROPOSAL_NAME = process.env.PROPOSAL_NAME ?? "ATG: publish reviewed ops";

function hexIdToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function restoreSerializedOps(value: unknown): unknown {
  if (typeof value === "string" && /^[0-9a-f]{32}$/i.test(value)) {
    return hexIdToBytes(value);
  }
  if (Array.isArray(value)) return value.map(restoreSerializedOps);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.type === "integer" && typeof record.value === "string" && /^-?\d+$/.test(record.value)) {
      return {
        ...Object.fromEntries(
          Object.entries(record).map(([key, item]) => [key, key === "value" ? item : restoreSerializedOps(item)]),
        ),
        value: BigInt(record.value),
      };
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, restoreSerializedOps(item)]),
    );
  }
  return value;
}

function assertGuards(): string {
  if (!CONFIRM_LIVE) throw new Error("Refusing to publish: set CONFIRM_LIVE=1.");
  if (!OPS_PATH) throw new Error("OPS_PATH is required.");
  if (!DEMO_SPACE_ID) throw new Error("DEMO_SPACE_ID is required because publishOps uses it as target space.");
  if (!TARGET_SPACE) throw new Error("TARGET_SPACE or DEMO_SPACE_ID is required.");
  if (TARGET_SPACE !== DEMO_SPACE_ID) {
    throw new Error(`TARGET_SPACE (${TARGET_SPACE}) must match DEMO_SPACE_ID (${DEMO_SPACE_ID}).`);
  }
  if (TARGET_SPACE !== STAGING_SPACE && process.env.ALLOW_NON_STAGING !== "1") {
    throw new Error(`Refusing to publish outside staging ${STAGING_SPACE}.`);
  }
  const resolved = resolve(process.cwd(), OPS_PATH);
  if (!existsSync(resolved)) throw new Error(`Ops file not found: ${OPS_PATH}`);
  return resolved;
}

const opsFile = assertGuards();
const serialized = JSON.parse(readFileSync(opsFile, "utf8"));
const ops = restoreSerializedOps(serialized) as Op[];
if (!Array.isArray(ops) || ops.length === 0) {
  throw new Error(`Ops file is empty or invalid: ${OPS_PATH}`);
}

console.log("\nATG reviewed ops live publish");
console.log(`Target space: ${TARGET_SPACE}`);
console.log(`Ops file:     ${OPS_PATH}`);
console.log(`Ops count:    ${ops.length}`);
console.log(`Proposal:     ${PROPOSAL_NAME}`);

const tx = await publishOps(ops, PROPOSAL_NAME);
console.log(`Published transaction: ${tx}`);
console.log(`View space: https://www.geobrowser.io/space/${TARGET_SPACE}`);
