#!/usr/bin/env python3
"""Read-only preflight for ATG production batch publication.

The goal is to decide whether B/C/D can be proposed while the existing-only
enrichment proposal is still waiting in SLOW governance.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
ATG = ROOT / "geo_atg"
VISUALS = ATG / "visuals"

BATCHES = {
    "A": {
        "agents": ATG / "atg_agents_batchA_publish.json",
        "orgs": ATG / "atg_orgs_batchA_publish.json",
        "cover": VISUALS / "atg_showcase37_visual_manifest_2026-06-23.json",
        "avatar": VISUALS / "atg_showcase37_visual_manifest_2026-06-23.json",
    },
    "B": {
        "agents": ATG / "atg_agents_batchB_publish.json",
        "orgs": ATG / "atg_orgs_batchB_publish.json",
        "cover": VISUALS / "atg_batchB_cover_attach_manifest_2026-06-23.json",
        "avatar": VISUALS / "atg_batchB_avatar_attach_manifest_2026-06-23.json",
    },
    "C": {
        "agents": ATG / "atg_agents_batchC_publish.json",
        "orgs": ATG / "atg_orgs_batchC_publish.json",
        "cover": VISUALS / "atg_batchC_cover_attach_manifest_2026-06-24.json",
        "avatar": VISUALS / "atg_batchC_avatar_attach_manifest_2026-06-24.json",
    },
    "D": {
        "agents": ATG / "atg_agents_batchD_publish.json",
        "orgs": ATG / "atg_orgs_batchD_publish.json",
        "cover": VISUALS / "atg_batchD_cover_attach_manifest_2026-06-24.json",
        "avatar": VISUALS / "atg_batchD_avatar_attach_manifest_2026-06-24.json",
    },
}

LIVE_AUDIT = ATG / "atg_ai_space_live_agent_audit_2026-06-26.json"
EXISTING_ONLY = ATG / "atg_existing_only_consolidated_dry_run_1782479933989.json"

SPECIAL_RULES = {
    "Grok": "skip_if_already_in_batch_a_or_live",
    "Hermes Agent": "enrich_existing_only_keep_existing_visuals_unless_approved",
}


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def org_keys(org: dict[str, Any]) -> set[str]:
    return {str(v) for v in (org.get("id"), org.get("slug"), org.get("name")) if v}


def manifest_assets(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    data = load_json(path)
    if isinstance(data, dict) and isinstance(data.get("assets"), list):
        return data["assets"]
    if isinstance(data, dict) and isinstance(data.get("items"), list):
        return data["items"]
    if isinstance(data, dict) and isinstance(data.get("records"), list):
        return data["records"]
    if isinstance(data, list):
        return data
    return []


def asset_names(path: Path) -> tuple[set[str], list[dict[str, Any]]]:
    assets = manifest_assets(path)
    names: set[str] = set()
    checked: list[dict[str, Any]] = []
    for asset in assets:
        name = asset.get("target_entity_name") or asset.get("display_name") or asset.get("name") or asset.get("agent_name")
        agent_id = asset.get("agentId") or asset.get("agent_id")
        if name:
            names.add(str(name))
        if agent_id:
            names.add(str(agent_id))
        file_value = asset.get("file") or asset.get("path") or asset.get("cover_file") or asset.get("avatar_file")
        file_exists = None
        if file_value:
            file_exists = (ROOT / str(file_value)).exists()
        checked.append({
            "name": name,
            "agentId": agent_id,
            "file": file_value,
            "fileExists": file_exists,
        })
    return names, checked


def taxonomy_keys(agent: dict[str, Any]) -> set[str]:
    keys: set[str] = set()
    for slug in agent.get("capabilities") or []:
        keys.add(f"capability:{slug}")
    for slug in agent.get("features") or []:
        keys.add(f"feature:{slug}")
    for slug in agent.get("protocols") or []:
        keys.add(f"protocol:{slug}")
    for slug in agent.get("models") or []:
        keys.add(f"model:{slug}")
    for slug in agent.get("runtimes") or []:
        keys.add(f"runtime:{slug}")
    for slug in agent.get("domains") or []:
        keys.add(f"domain:{slug}")
    for slug in agent.get("memory_types") or []:
        keys.add(f"memory:{slug}")
    for slug in agent.get("risk_surface") or []:
        keys.add(f"risk:{slug}")
    license_slug = agent.get("license")
    if license_slug:
        keys.add(f"license:{str(license_slug).lower()}")
    return keys


def main() -> None:
    live = load_json(LIVE_AUDIT)
    existing = load_json(EXISTING_ONLY)

    live_rows = live.get("rows", [])
    live_by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in live_rows:
        live_by_name[row.get("name", "")].append(row)

    live_duplicate_names = {
        item["name"]: item.get("ids", [])
        for item in live.get("duplicates", [])
    }

    existing_only_names = {agent.get("name") for agent in existing.get("agents", [])}
    pending_targets = {
        f"{target.get('kind')}:{target.get('slug')}": target
        for target in existing.get("targets", [])
        if target.get("kind") and target.get("slug")
    }

    all_agents_by_batch: dict[str, list[dict[str, Any]]] = {}
    all_names: list[tuple[str, str, str]] = []
    report: dict[str, Any] = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "targetSpace": live.get("targetSpace"),
        "recommendation": {
            "canSubmitSlowBackToBack": True,
            "safeOrder": [
                "existing-only enrichment",
                "Batch B",
                "Batch C",
                "Batch D",
            ],
            "constraint": (
                "B/C/D must either wait for existing-only to be applied or use the "
                "same pending support target IDs from the existing-only dry-run."
            ),
            "fastMode": "not safe in clean AI space unless caller is editor",
        },
        "existingOnlyDependency": {
            "report": str(EXISTING_ONLY.relative_to(ROOT)),
            "agentsInExistingOnlyPlan": len(existing.get("agents", [])),
            "pendingSupportTargets": len(pending_targets),
            "opsPath": "ops/ops_atg_existing_only_consolidated_dry_run_1782479933989.json",
        },
        "batches": {},
        "crossBatchDuplicates": [],
        "globalMissingSupportKeys": [],
    }

    global_missing_support: Counter[str] = Counter()

    for batch, files in BATCHES.items():
        agents = load_json(files["agents"])
        orgs = load_json(files["orgs"])
        all_agents_by_batch[batch] = agents
        all_names.extend((batch, agent["id"], agent["name"]) for agent in agents)

        org_index = set()
        for org in orgs:
            org_index.update(org_keys(org))

        cover_names, cover_assets = asset_names(files["cover"])
        avatar_names, avatar_assets = asset_names(files["avatar"])

        missing_org_refs = []
        existing_live = []
        existing_only = []
        live_duplicates = []
        missing_cover = []
        missing_avatar = []
        missing_cover_file = []
        missing_avatar_file = []
        special = []
        support_keys: Counter[str] = Counter()
        missing_support: Counter[str] = Counter()

        cover_file_by_name = {a.get("name"): a for a in cover_assets if a.get("name")}
        avatar_file_by_name = {a.get("name"): a for a in avatar_assets if a.get("name")}

        for agent in agents:
            name = agent["name"]
            agent_id = agent["id"]
            org_ref = agent.get("organization")
            if org_ref and org_ref not in org_index:
                missing_org_refs.append({"agent": name, "agentId": agent_id, "orgRef": org_ref})

            if name in live_by_name:
                existing_live.append({
                    "name": name,
                    "agentId": agent_id,
                    "liveIds": [row.get("id") for row in live_by_name[name]],
                })
            if name in existing_only_names:
                existing_only.append({"name": name, "agentId": agent_id})
            if name in live_duplicate_names:
                live_duplicates.append({"name": name, "liveIds": live_duplicate_names[name]})
            if name in SPECIAL_RULES:
                special.append({"name": name, "rule": SPECIAL_RULES[name]})

            if name not in cover_names and agent_id not in cover_names:
                missing_cover.append({"name": name, "agentId": agent_id})
            if name not in avatar_names and agent_id not in avatar_names:
                missing_avatar.append({"name": name, "agentId": agent_id})

            cover_asset = cover_file_by_name.get(name)
            avatar_asset = avatar_file_by_name.get(name)
            if cover_asset and cover_asset.get("fileExists") is False:
                missing_cover_file.append(cover_asset)
            if avatar_asset and avatar_asset.get("fileExists") is False:
                missing_avatar_file.append(avatar_asset)

            for key in taxonomy_keys(agent):
                support_keys[key] += 1
                if key not in pending_targets:
                    missing_support[key] += 1
                    global_missing_support[key] += 1

        report["batches"][batch] = {
            "agents": len(agents),
            "orgs": len(orgs),
            "existingByExactName": len(existing_live),
            "existingByExactNameExamples": existing_live[:12],
            "inExistingOnlyPlan": len(existing_only),
            "inExistingOnlyPlanExamples": existing_only[:12],
            "liveDuplicateNames": live_duplicates,
            "missingOrgRefs": missing_org_refs,
            "missingCoverManifest": missing_cover,
            "missingAvatarManifest": missing_avatar,
            "missingCoverFiles": missing_cover_file,
            "missingAvatarFiles": missing_avatar_file,
            "specialRules": special,
            "taxonomyKeys": len(support_keys),
            "taxonomyKeysMissingFromExistingOnlyTargets": [
                {"key": key, "count": count}
                for key, count in missing_support.most_common()
            ],
        }

    name_counter = Counter(name for _, _, name in all_names)
    by_name = defaultdict(list)
    for batch, agent_id, name in all_names:
        if name_counter[name] > 1:
            by_name[name].append({"batch": batch, "agentId": agent_id})
    report["crossBatchDuplicates"] = [
        {"name": name, "rows": rows}
        for name, rows in sorted(by_name.items())
    ]
    report["globalMissingSupportKeys"] = [
        {"key": key, "count": count}
        for key, count in global_missing_support.most_common()
    ]

    out_json = ATG / "atg_batch_publish_preflight_2026-06-26.json"
    out_md = ATG / "atg_batch_publish_preflight_2026-06-26.md"
    out_json.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# ATG Batch Publish Preflight",
        "",
        f"Generated: `{report['generatedAt']}`",
        f"Target space: `{report['targetSpace']}`",
        "",
        "## Recommendation",
        "",
        "- SLOW proposals can be prepared/submitted close together only if B/C/D reuse the pending support IDs from the existing-only enrichment plan.",
        "- Safer order for applying proposals: existing-only enrichment -> Batch B -> Batch C -> Batch D.",
        "- Do not use FAST in the clean AI space unless the caller is an editor.",
        "- Do not publish raw B/C/D with the old core-only publisher as-is; it is not the full ATG ontology publisher.",
        "",
        "## Existing-only dependency",
        "",
        f"- Existing canonical agents in plan: `{report['existingOnlyDependency']['agentsInExistingOnlyPlan']}`",
        f"- Pending support targets in plan: `{report['existingOnlyDependency']['pendingSupportTargets']}`",
        f"- Ops path: `{report['existingOnlyDependency']['opsPath']}`",
        "",
        "## Batch summary",
        "",
        "| Batch | Agents | Existing exact names | Existing-only plan | Missing org refs | Missing cover manifest | Missing avatar manifest | Missing support keys |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for batch in BATCHES:
        b = report["batches"][batch]
        lines.append(
            f"| {batch} | {b['agents']} | {b['existingByExactName']} | {b['inExistingOnlyPlan']} | "
            f"{len(b['missingOrgRefs'])} | {len(b['missingCoverManifest'])} | "
            f"{len(b['missingAvatarManifest'])} | {len(b['taxonomyKeysMissingFromExistingOnlyTargets'])} |"
        )

    lines.extend(["", "## Special handling", ""])
    for batch in BATCHES:
        special = report["batches"][batch]["specialRules"]
        if special:
            lines.append(f"- Batch {batch}: " + "; ".join(f"{s['name']} -> {s['rule']}" for s in special))

    lines.extend(["", "## Blocking issues before reviewed ops", ""])
    for batch in BATCHES:
        b = report["batches"][batch]
        if b["missingOrgRefs"]:
            refs = ", ".join(f"{x['agent']} -> {x['orgRef']}" for x in b["missingOrgRefs"][:10])
            lines.append(f"- Batch {batch} missing org refs: {refs}")
        if b["missingCoverFiles"]:
            lines.append(f"- Batch {batch} has {len(b['missingCoverFiles'])} cover manifest files missing on disk.")
        if b["missingAvatarFiles"]:
            lines.append(f"- Batch {batch} has {len(b['missingAvatarFiles'])} avatar manifest files missing on disk.")

    if report["crossBatchDuplicates"]:
        lines.extend(["", "## Cross-batch duplicates", ""])
        for item in report["crossBatchDuplicates"]:
            rows = ", ".join(f"{r['batch']}:{r['agentId']}" for r in item["rows"])
            lines.append(f"- {item['name']}: {rows}")

    if report["globalMissingSupportKeys"]:
        lines.extend(["", "## Support keys not covered by existing-only target map", ""])
        lines.append("These need either reuse resolution or support creation in the batch proposal:")
        for item in report["globalMissingSupportKeys"][:80]:
            lines.append(f"- `{item['key']}` ({item['count']})")

    lines.extend([
        "",
        "## Output files",
        "",
        f"- JSON: `{out_json.relative_to(ROOT)}`",
        f"- Markdown: `{out_md.relative_to(ROOT)}`",
        "",
    ])
    out_md.write_text("\n".join(lines), encoding="utf-8")

    print(f"Wrote {out_json}")
    print(f"Wrote {out_md}")


if __name__ == "__main__":
    main()
