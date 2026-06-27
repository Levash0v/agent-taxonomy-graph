#!/usr/bin/env python3
"""Build a support/reuse bootstrap map for ATG B/C/D publication.

This is a read-only planning artifact. It does not publish to Geo.

The map resolves support taxonomy keys that are needed by B/C/D but are not
covered by the existing-only enrichment dry-run target map.
"""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
ATG = ROOT / "geo_atg"

PREFLIGHT_PATH = ATG / "atg_batch_publish_preflight_2026-06-26.json"
EXISTING_ONLY_PATH = ATG / "atg_existing_only_consolidated_dry_run_1782479933989.json"
PLAN_PATH = ATG / "atg_clean_ai_consolidated_patch_plan_2026-06-26.json"

OUT_JSON = ATG / "atg_support_bootstrap_map_2026-06-26.json"
OUT_MD = ATG / "atg_support_bootstrap_map_2026-06-26.md"

KIND_TO_TARGET_SPEC = {
    "benchmark": "Benchmarks",
    "capability": "Capabilities",
    "domain": "Domains",
    "feature": "Capabilities",
    "license": "Licenses",
    "memory": "MemoryTypes",
    "model": "Models",
    "protocol": "Protocols",
    "risk": "RiskTypes",
    "runtime": "Runtimes",
}

# Ontology policy decisions already used in ATG work:
# - noassertion is absence of license evidence, not a useful license relation.
# - MCP client/server are interop/protocol facets, not agent capabilities.
# - plugin_extensions is a product affordance, so it belongs to Features.
POLICY: dict[str, dict[str, str]] = {
    "license:noassertion": {
        "action": "skip",
        "reason": "NOASSERTION means license data is unavailable; do not create a license relation.",
    },
    "capability:mcp_client": {
        "action": "remap",
        "targetKey": "protocol:mcp",
        "reason": "MCP client belongs to Protocols / interop.",
    },
    "capability:deployment": {
        "action": "fixed_reuse",
        "targetId": "e86c157fbc114804a8b774686d712b23",
        "reason": "Existing clean AI-space Deployment entity was already fixed in the consolidated publisher.",
    },
    "capability:code_generation": {
        "action": "manual_review",
        "preferredId": "22b92f833dc24a3981468ad5c900c9d8",
        "candidateIds": "22b92f833dc24a3981468ad5c900c9d8,93c2389698d742d4b9c72e272078db35",
        "reason": "Clean AI-space has duplicate Code generation candidates; choose canonical before live publication.",
    },
    "capability:mcp_server": {
        "action": "remap",
        "targetKey": "protocol:mcp",
        "reason": "MCP server belongs to Protocols / interop.",
    },
    "capability:plugin_extensions": {
        "action": "remap",
        "targetKey": "feature:plugin_extensions",
        "reason": "Plugin extensions is a product affordance / ecosystem feature.",
    },
    "capability:model_routing": {
        "action": "remap",
        "targetKey": "feature:model_routing",
        "reason": "Model routing is a product affordance / routing feature.",
    },
    "capability:multi_file_edits": {
        "action": "remap",
        "targetKey": "feature:multi_file_edits",
        "reason": "Multi-file edits is a product affordance in the current Features split.",
    },
    "capability:live_preview": {
        "action": "remap",
        "targetKey": "feature:live_preview",
        "reason": "Live preview is a product affordance in the current Features split.",
    },
}

FEATURE_SPECS = {
    "plugin_extensions": {
        "name": "Plugin extensions",
        "description": "Extends agent capabilities through plugins, extensions, or packaged skills.",
    },
    "model_routing": {
        "name": "Model routing",
        "description": "Routes requests between multiple models or providers based on task, cost, availability, or fallback policy.",
    },
    "multi_file_edits": {
        "name": "Multi-file edits",
        "description": "Plans and applies coordinated edits across multiple files in one task.",
    },
    "live_preview": {
        "name": "Live preview",
        "description": "Shows a live preview of generated UI, code, or app output.",
    },
}

NAME_OVERRIDES = {
    "capability:vector_rag": "Vector RAG",
    "runtime:api": "API",
}


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def planned_id(key: str) -> str:
    return hashlib.md5(f"atg-support:{key}".encode("utf-8")).hexdigest()


def split_key(key: str) -> tuple[str, str]:
    kind, slug = key.split(":", 1)
    return kind, slug


def normalize_name(slug: str) -> str:
    parts = slug.replace("-", "_").split("_")
    return " ".join(part.capitalize() for part in parts if part)


def target_specs(plan: dict[str, Any]) -> dict[str, dict[str, Any]]:
    specs: dict[str, dict[str, Any]] = {}
    raw = plan.get("target_specs", {})
    for kind, section in KIND_TO_TARGET_SPEC.items():
        values = raw.get(section, {})
        if not isinstance(values, dict):
            continue
        for slug, spec in values.items():
            key = f"{kind}:{slug}"
            specs[key] = {
                "kind": kind,
                "slug": slug,
                "name": spec.get("name") or normalize_name(slug),
                "description": spec.get("description") or "",
                "source": "clean_ai_consolidated_patch_plan.target_specs",
            }
    for slug, spec in FEATURE_SPECS.items():
        specs[f"feature:{slug}"] = {
            "kind": "feature",
            "slug": slug,
            "name": spec["name"],
            "description": spec["description"],
            "source": "feature_split_policy",
        }
    return specs


def main() -> None:
    preflight = load_json(PREFLIGHT_PATH)
    existing_only = load_json(EXISTING_ONLY_PATH)
    plan = load_json(PLAN_PATH)

    specs = target_specs(plan)
    existing_targets = {
        f"{target.get('kind')}:{target.get('slug')}": target
        for target in existing_only.get("targets", [])
        if target.get("kind") and target.get("slug")
    }

    missing_keys = [item["key"] for item in preflight.get("globalMissingSupportKeys", [])]
    key_counts = {item["key"]: item["count"] for item in preflight.get("globalMissingSupportKeys", [])}

    entries: dict[str, dict[str, Any]] = {}
    reverse_refs: dict[str, list[str]] = defaultdict(list)

    def resolve(key: str, root_key: str | None = None) -> dict[str, Any]:
        if key in entries:
            return entries[key]

        if key in POLICY:
            policy = POLICY[key]
            if policy["action"] == "fixed_reuse":
                kind, slug = split_key(key)
                spec = specs.get(key, {})
                entry = {
                    "key": key,
                    "action": "fixed_reuse",
                    "id": policy["targetId"],
                    "kind": kind,
                    "slug": slug,
                    "name": spec.get("name") or normalize_name(slug),
                    "description": spec.get("description") or "",
                    "count": key_counts.get(key, 0),
                    "reason": policy["reason"],
                }
                entries[key] = entry
                return entry
            if policy["action"] == "manual_review":
                kind, slug = split_key(key)
                spec = specs.get(key, {})
                entry = {
                    "key": key,
                    "action": "manual_review",
                    "preferredId": policy["preferredId"],
                    "candidateIds": policy["candidateIds"].split(","),
                    "kind": kind,
                    "slug": slug,
                    "name": spec.get("name") or normalize_name(slug),
                    "description": spec.get("description") or "",
                    "count": key_counts.get(key, 0),
                    "reason": policy["reason"],
                }
                entries[key] = entry
                return entry
            if policy["action"] == "skip":
                entry = {
                    "key": key,
                    "action": "skip",
                    "count": key_counts.get(key, 0),
                    "reason": policy["reason"],
                }
                entries[key] = entry
                return entry
            if policy["action"] == "remap":
                target_key = policy["targetKey"]
                target = resolve(target_key, root_key=key)
                reverse_refs[target_key].append(key)
                entry = {
                    "key": key,
                    "action": "remap",
                    "count": key_counts.get(key, 0),
                    "targetKey": target_key,
                    "targetId": target.get("id"),
                    "targetAction": target.get("action"),
                    "reason": policy["reason"],
                }
                entries[key] = entry
                return entry

        if key in existing_targets:
            target = existing_targets[key]
            entry = {
                "key": key,
                "action": "pending_existing_only",
                "id": target["id"],
                "name": target.get("name"),
                "count": key_counts.get(key, 0),
                "existingOnlyStatus": target.get("status"),
                "reason": "Covered by existing-only enrichment proposal target map.",
            }
            entries[key] = entry
            return entry

        kind, slug = split_key(key)
        spec = specs.get(key)
        if not spec:
            spec = {
                "kind": kind,
                "slug": slug,
                "name": NAME_OVERRIDES.get(key) or normalize_name(slug),
                "description": "",
                "source": "fallback_slug_name",
            }
        if key in NAME_OVERRIDES:
            spec = {**spec, "name": NAME_OVERRIDES[key]}

        entry = {
            "key": key,
            "action": "create_support",
            "id": planned_id(key),
            "kind": kind,
            "slug": slug,
            "name": spec["name"],
            "description": spec.get("description") or "",
            "count": key_counts.get(key, 0),
            "source": spec.get("source"),
            "reason": "Needed by B/C/D and not covered by existing-only target map.",
        }
        entries[key] = entry
        return entry

    for key in missing_keys:
        resolve(key)

    # Ensure remap target entries are present in the output even when the target
    # was not directly in the missing list.
    for refs in list(reverse_refs.values()):
        for ref in refs:
            if ref not in entries:
                resolve(ref)

    ordered_entries = [entries[key] for key in sorted(entries)]
    summary = defaultdict(int)
    for entry in ordered_entries:
        summary[entry["action"]] += 1

    output = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourcePreflight": str(PREFLIGHT_PATH.relative_to(ROOT)),
        "existingOnlyReport": str(EXISTING_ONLY_PATH.relative_to(ROOT)),
        "policy": {
            "noassertion": "skip relation",
            "mcp_client": "remap to protocol:mcp",
            "mcp_server": "remap to protocol:mcp",
            "plugin_extensions": "remap to feature:plugin_extensions",
            "model_routing": "remap to feature:model_routing",
            "multi_file_edits": "remap to feature:multi_file_edits",
            "live_preview": "remap to feature:live_preview",
            "deployment": "reuse fixed clean AI-space entity",
            "code_generation": "manual review duplicate candidates before live",
        },
        "summary": dict(sorted(summary.items())),
        "entries": ordered_entries,
    }
    OUT_JSON.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# ATG Support / Reuse Bootstrap Map",
        "",
        f"Generated: `{output['generatedAt']}`",
        f"Source preflight: `{output['sourcePreflight']}`",
        f"Existing-only report: `{output['existingOnlyReport']}`",
        "",
        "## Policy",
        "",
        "- `license:noassertion` is skipped; it means missing evidence, not a useful license node.",
        "- `capability:mcp_client` and `capability:mcp_server` remap to `protocol:mcp`.",
        "- `plugin_extensions`, `model_routing`, `multi_file_edits`, and `live_preview` remap to Features.",
        "- `capability:deployment` reuses the fixed clean AI-space entity.",
        "- `capability:code_generation` is marked manual-review because clean AI-space has duplicate candidates.",
        "",
        "## Summary",
        "",
    ]
    for action, count in sorted(summary.items()):
        lines.append(f"- `{action}`: {count}")

    lines.extend([
        "",
        "## Entries",
        "",
        "| Key | Action | Target / ID | Name | Count |",
        "|---|---|---|---|---:|",
    ])
    for entry in ordered_entries:
        target = entry.get("targetKey") or entry.get("id") or ""
        lines.append(
            f"| `{entry['key']}` | `{entry['action']}` | `{target}` | "
            f"{entry.get('name', '')} | {entry.get('count', 0)} |"
        )

    lines.extend([
        "",
        "## Output files",
        "",
        f"- JSON: `{OUT_JSON.relative_to(ROOT)}`",
        f"- Markdown: `{OUT_MD.relative_to(ROOT)}`",
        "",
    ])
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")

    print(f"Wrote {OUT_JSON}")
    print(f"Wrote {OUT_MD}")
    print(json.dumps(output["summary"], indent=2))


if __name__ == "__main__":
    main()
