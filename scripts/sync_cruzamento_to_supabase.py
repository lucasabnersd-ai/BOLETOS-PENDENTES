from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path

from sync_excel_to_supabase import request_json


def load_crossing(path: Path) -> dict:
    text = path.read_text(encoding="utf-8-sig")
    marker = "window.CRUZAMENTO_DATA ="
    if marker not in text:
        raise ValueError("Arquivo nao contem window.CRUZAMENTO_DATA.")
    payload = text.split(marker, 1)[1].strip().rstrip(";")
    data = json.loads(payload)
    if not isinstance(data, dict):
        raise ValueError("Dados do cruzamento invalidos.")
    return data


def main() -> int:
    parser = argparse.ArgumentParser(description="Envia o cruzamento protegido de NFes ao Supabase.")
    parser.add_argument("--source", required=True, help="Arquivo cruzamento_data.js gerado localmente.")
    args = parser.parse_args()

    source = Path(args.source)
    if not source.exists():
        raise SystemExit(f"Arquivo nao encontrado: {source}")
    data = load_crossing(source)
    request_json(
        "POST",
        "/rest/v1/boleto_pendentes_cruzamento?on_conflict=key",
        [{"key": "latest_import", "value": data, "updated_at": dt.datetime.now(dt.timezone.utc).isoformat()}],
        prefer="resolution=merge-duplicates,return=minimal",
    )
    print(f"OK: {len(data.get('associados') or [])} cruzamentos sincronizados.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
