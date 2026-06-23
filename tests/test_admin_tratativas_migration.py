import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "20260622205903_admin_roles_delete_tratativa.sql"


class AdminTratativasMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8")
        cls.normalized = re.sub(r"\s+", " ", cls.sql.lower()).strip()

    def test_role_hierarchy_uses_only_trusted_app_metadata(self):
        self.assertIn("raw_app_meta_data", self.normalized)
        self.assertIn("app_metadata", self.normalized)
        self.assertNotIn("raw_user_meta_data", self.normalized)
        self.assertNotIn("user_metadata", self.normalized)
        self.assertGreaterEqual(self.normalized.count("lucas.abnersd@gmail.com"), 5)
        self.assertGreaterEqual(self.normalized.count("lucas.araujo@sdflorestal.com.br"), 4)
        self.assertIn("else 'standard'", self.normalized)
        self.assertIn("can_sync_boleto", self.normalized)
        self.assertIn("before insert or update of email, raw_app_meta_data", self.normalized)

    def test_daily_sync_keeps_non_admin_limited_capability(self):
        self.assertIn("sync account can insert boleto items", self.normalized)
        self.assertIn("sync account can delete boleto items", self.normalized)
        self.assertIn("for insert", self.normalized)
        self.assertIn("for delete", self.normalized)
        self.assertIn("can_sync_boleto", self.normalized)
        self.assertNotIn(
            "when lower(btrim(coalesce(new.email, ''))) = 'lucas.araujo@sdflorestal.com.br' then 'admin'",
            self.normalized,
        )
        self.assertNotIn(
            "when lower(btrim(coalesce(email, ''))) = 'lucas.araujo@sdflorestal.com.br' then 'admin'",
            self.normalized,
        )

    def test_direct_delete_is_revoked(self):
        self.assertIn(
            "revoke delete on table public.boleto_pendentes_audit from public, anon, authenticated",
            self.normalized,
        )
        self.assertNotRegex(
            self.normalized,
            r"grant\s+delete\s+on\s+(?:table\s+)?public\.boleto_pendentes_audit",
        )

    def test_rpc_has_safe_privilege_boundary(self):
        self.assertIn(
            "create or replace function public.delete_boleto_pendentes_tratativa( p_audit_id text )",
            self.normalized,
        )
        self.assertIn("security invoker set search_path = ''", self.normalized)
        self.assertIn(
            "security definer set search_path = ''",
            self.normalized,
        )
        self.assertIn("create or replace function boletos_private.try_parse_jsonb(p_value text)", self.normalized)
        self.assertIn(
            "revoke all on function public.delete_boleto_pendentes_tratativa(text) from public, anon",
            self.normalized,
        )
        self.assertIn(
            "grant execute on function public.delete_boleto_pendentes_tratativa(text) to authenticated",
            self.normalized,
        )

    def test_rpc_checks_database_and_jwt_identity(self):
        self.assertIn("v_user_id uuid := auth.uid()", self.normalized)
        self.assertIn("auth.jwt() ->> 'email'", self.normalized)
        self.assertIn("auth.jwt() -> 'app_metadata' ->> 'app_role'", self.normalized)
        self.assertIn("from auth.users as users", self.normalized)
        self.assertIn("errcode = '42501'", self.normalized)

    def test_only_active_treatments_can_be_deleted_and_tombstone_is_kept(self):
        self.assertIn("audit.field_name = 'tratativa'", self.normalized)
        self.assertIn("boletos_private.try_parse_jsonb(audit.new_value) ->> 'action'", self.normalized)
        self.assertIn("'tratativa_insert'", self.normalized)
        self.assertIn("'tratativa_exclusao'", self.normalized)
        self.assertIn("'deleted_entry', boletos_private.try_parse_jsonb(v_target.new_value)", self.normalized)
        self.assertIn(")::text", self.normalized)
        self.assertLess(
            self.normalized.index("insert into public.boleto_pendentes_audit"),
            self.normalized.index("delete from public.boleto_pendentes_audit"),
        )


if __name__ == "__main__":
    unittest.main()
