from __future__ import annotations

import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
SYNC = REPO / "scripts" / "sync_excel_to_supabase.py"


class SyncSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = SYNC.read_text(encoding="utf-8")

    def test_delete_missing_has_mass_delete_guard(self) -> None:
        self.assertIn("--max-delete-ratio", self.source)
        self.assertIn("--force-large-delete", self.source)
        self.assertIn("Delecao automatica bloqueada por seguranca", self.source)
        self.assertIn("len(missing) > max_allowed", self.source)

    def test_sync_credentials_are_not_hardcoded_passwords(self) -> None:
        self.assertIn("read_windows_credential()", self.source)
        self.assertIn("BOLETOS_AUTH_PASSWORD", self.source)
        self.assertNotIn("service_role", self.source.lower())


if __name__ == "__main__":
    unittest.main()
