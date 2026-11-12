"""导出 OpenAPI 供前端生成类型。用法：python scripts/gen_openapi.py"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from app.main import app  # noqa: E402

target = ROOT / "apps" / "web" / "openapi.json"
target.write_text(json.dumps(app.openapi(), ensure_ascii=False, indent=2), encoding="utf-8")
print(f"written {target}")
