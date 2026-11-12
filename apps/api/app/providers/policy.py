"""供应商用途策略。

每个能力按用途给出 allowed / denied / unknown，unknown 不自动变成 allowed。
默认策略的取值理由写在 config/provider_policy.json 的 _note 字段里，可随核实结果修改。
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

USES = (
    "display_on_custom_map",
    "persist",
    "share",
    "export",
    "offline",
    "retain_reference",
    "compute",
)


@lru_cache
def load_policy(path: str) -> dict[str, Any]:
    file = Path(path)
    if not file.exists():
        return {}
    try:
        return json.loads(file.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def policy_for(provider: str, capability: str, path: str) -> dict[str, str]:
    data = load_policy(path)
    entry = data.get(provider, {}).get(capability, {})
    return {use: entry.get(use, "unknown") for use in USES}


def allowed(provider: str, capability: str, use: str, path: str) -> bool:
    return policy_for(provider, capability, path).get(use) == "allowed"


def public_policy(provider: str, capability: str, path: str) -> dict[str, Any]:
    data = load_policy(path)
    entry = data.get(provider, {}).get(capability, {})
    return {
        "uses": policy_for(provider, capability, path),
        "evidence_ref": entry.get("evidence_ref"),
        "allowed_fields": entry.get("allowed_fields", []),
        "attribution": entry.get("attribution"),
    }
