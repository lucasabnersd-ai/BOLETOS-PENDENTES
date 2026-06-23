import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "app.js").read_text(encoding="utf-8")
STYLES = (ROOT / "styles.css").read_text(encoding="utf-8")


class AdminTreatmentsFrontendTests(unittest.TestCase):
    def test_admin_requires_app_metadata_role_and_exact_normalized_email(self):
        self.assertIn('const ADMIN_EMAIL = "lucas.abnersd@gmail.com";', APP)
        self.assertIn('user?.app_metadata?.app_role === "admin"', APP)
        self.assertIn('normalizedEmail(user) === ADMIN_EMAIL', APP)
        self.assertNotIn("user_metadata", APP)

    def test_standard_users_do_not_receive_delete_action(self):
        self.assertIn('"Acesso padrão"', APP)
        self.assertIn('state.role === "admin" && treatment.auditId', APP)
        self.assertIn('data-action="delete-treatment"', APP)

    def test_delete_uses_rpc_and_never_direct_table_delete(self):
        self.assertIn('supabase.rpc("delete_boleto_pendentes_tratativa"', APP)
        self.assertIn("if (deleted !== true)", APP)
        self.assertNotIn('.from(AUDIT_TABLE).delete()', APP)
        self.assertIn("window.confirm", APP)
        self.assertIn("await loadTreatments()", APP)

    def test_delete_button_has_dedicated_styles(self):
        self.assertIn(".treatment-delete-button", STYLES)


if __name__ == "__main__":
    unittest.main()
