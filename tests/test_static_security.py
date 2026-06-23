from __future__ import annotations

import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
FORBIDDEN_STATIC_ASSETS = ("data/initial.json", "update-meta.json")


class StaticSecurityTests(unittest.TestCase):
    def test_financial_snapshots_are_ignored_and_absent(self) -> None:
        ignored = (REPO / ".gitignore").read_text(encoding="utf-8").splitlines()
        normalized = {line.strip().lstrip("/") for line in ignored}

        for relative_path in FORBIDDEN_STATIC_ASSETS:
            with self.subTest(path=relative_path):
                self.assertIn(relative_path, normalized)
                self.assertFalse((REPO / relative_path).exists())

    def test_sync_does_not_write_static_financial_assets(self) -> None:
        source = (REPO / "scripts" / "sync_excel_to_supabase.py").read_text(encoding="utf-8")

        for relative_path in FORBIDDEN_STATIC_ASSETS:
            with self.subTest(path=relative_path):
                self.assertNotIn(Path(relative_path).name, source)
        self.assertNotIn("write_snapshot(", source)

    def test_publish_command_never_stages_financial_assets(self) -> None:
        source = (REPO / "ATUALIZAR_BOLETOS_PENDENTES.cmd").read_text(encoding="utf-8")

        for relative_path in FORBIDDEN_STATIC_ASSETS:
            with self.subTest(path=relative_path):
                self.assertNotIn(relative_path.replace("/", "\\"), source)

    def test_panel_title_is_uppercase(self) -> None:
        html = (REPO / "index.html").read_text(encoding="utf-8")

        self.assertNotIn("Painel de Boletos Pendentes", html)
        self.assertGreaterEqual(html.count("PAINEL DE BOLETOS PENDENTES"), 3)

    def test_csv_formula_guard_handles_leading_whitespace(self) -> None:
        source = (REPO / "app.js").read_text(encoding="utf-8")

        self.assertIn('formulaProbe = text.replace(/^[\\s\\u0000-\\u001f]+/, "")', source)
        self.assertIn('typeof value === "string" && /^[=+\\-@]/.test(formulaProbe)', source)
        self.assertNotIn('/^[=+\\-@]/.test(text)', source)


if __name__ == "__main__":
    unittest.main()
