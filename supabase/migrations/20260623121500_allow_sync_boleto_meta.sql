-- Allow the narrow daily-sync account to update only the load metadata.
--
-- The operator-facing users remain standard/admin only. This policy keeps the
-- technical sync capability tied to the trusted app_metadata claim
-- `can_sync_boleto=true` and the exact sync email.

drop policy if exists "sync account can write boleto meta" on public.boleto_pendentes_meta;
drop policy if exists "sync account can insert boleto meta" on public.boleto_pendentes_meta;
drop policy if exists "sync account can update boleto meta" on public.boleto_pendentes_meta;

create policy "sync account can insert boleto meta"
on public.boleto_pendentes_meta
for insert
to authenticated
with check (
  lower(btrim(coalesce(auth.jwt() ->> 'email', ''))) = 'lucas.araujo@sdflorestal.com.br'
  and coalesce((auth.jwt() -> 'app_metadata' ->> 'can_sync_boleto')::boolean, false) is true
);

create policy "sync account can update boleto meta"
on public.boleto_pendentes_meta
for update
to authenticated
using (
  lower(btrim(coalesce(auth.jwt() ->> 'email', ''))) = 'lucas.araujo@sdflorestal.com.br'
  and coalesce((auth.jwt() -> 'app_metadata' ->> 'can_sync_boleto')::boolean, false) is true
)
with check (
  lower(btrim(coalesce(auth.jwt() ->> 'email', ''))) = 'lucas.araujo@sdflorestal.com.br'
  and coalesce((auth.jwt() -> 'app_metadata' ->> 'can_sync_boleto')::boolean, false) is true
);
