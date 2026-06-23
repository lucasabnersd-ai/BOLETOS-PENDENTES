-- Enforce the BOLETOS role hierarchy and expose one narrowly-scoped RPC for
-- deleting a treatment. This migration is intentionally not applied by this
-- repository change; production rollout requires a separate approval.
--
-- The daily importer authenticates with a separate technical account. That
-- account must remain app_role=standard for the product hierarchy, but it keeps
-- one non-admin sync capability so the existing import flow can continue using
-- table inserts/deletes without receiving administrator UI privileges.

create schema if not exists boletos_private;

revoke all on schema boletos_private from public, anon, authenticated;

create or replace function boletos_private.enforce_boleto_app_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object(
      'app_role',
      case
        when lower(btrim(coalesce(new.email, ''))) = 'lucas.abnersd@gmail.com'
          then 'admin'
        else 'standard'
      end,
      'can_sync_boleto',
      case
        when lower(btrim(coalesce(new.email, ''))) = 'lucas.araujo@sdflorestal.com.br'
          then true
        else false
      end
    );

  return new;
end;
$function$;

revoke all on function boletos_private.enforce_boleto_app_role() from public, anon, authenticated;

create or replace function boletos_private.try_parse_jsonb(p_value text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
begin
  return coalesce(p_value, '{}')::jsonb;
exception
  when others then
    return '{}'::jsonb;
end;
$function$;

revoke all on function boletos_private.try_parse_jsonb(text) from public, anon, authenticated;

drop trigger if exists enforce_boleto_app_role on auth.users;

create trigger enforce_boleto_app_role
before insert or update of email, raw_app_meta_data
on auth.users
for each row
execute function boletos_private.enforce_boleto_app_role();

-- Backfill every existing account from the authoritative email. Authorization
-- data lives only in raw_app_meta_data/app_metadata, never user metadata.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object(
    'app_role',
    case
      when lower(btrim(coalesce(email, ''))) = 'lucas.abnersd@gmail.com'
        then 'admin'
      else 'standard'
    end,
    'can_sync_boleto',
    case
      when lower(btrim(coalesce(email, ''))) = 'lucas.araujo@sdflorestal.com.br'
        then true
      else false
    end
  )
where coalesce(raw_app_meta_data ->> 'app_role', '') is distinct from
    case
      when lower(btrim(coalesce(email, ''))) = 'lucas.abnersd@gmail.com'
        then 'admin'
      else 'standard'
    end
   or coalesce((raw_app_meta_data ->> 'can_sync_boleto')::boolean, false) is distinct from
    case
      when lower(btrim(coalesce(email, ''))) = 'lucas.araujo@sdflorestal.com.br'
        then true
      else false
    end;

alter table public.boleto_pendentes_items enable row level security;

-- Preserve the existing daily sync without making the technical account an
-- administrator. Existing admin policies remain in force for Lucas; these two
-- narrow policies add only INSERT/DELETE for the exact technical account JWT.
drop policy if exists "sync account can insert boleto items" on public.boleto_pendentes_items;
create policy "sync account can insert boleto items"
on public.boleto_pendentes_items
for insert
to authenticated
with check (
  lower(btrim(coalesce(auth.jwt() ->> 'email', ''))) = 'lucas.araujo@sdflorestal.com.br'
  and coalesce((auth.jwt() -> 'app_metadata' ->> 'can_sync_boleto')::boolean, false) is true
);

drop policy if exists "sync account can delete boleto items" on public.boleto_pendentes_items;
create policy "sync account can delete boleto items"
on public.boleto_pendentes_items
for delete
to authenticated
using (
  lower(btrim(coalesce(auth.jwt() ->> 'email', ''))) = 'lucas.araujo@sdflorestal.com.br'
  and coalesce((auth.jwt() -> 'app_metadata' ->> 'can_sync_boleto')::boolean, false) is true
);

alter table public.boleto_pendentes_audit enable row level security;

-- Deletion is available only through the checked RPC below. SELECT/INSERT
-- permissions and their existing RLS policies are intentionally unchanged.
revoke delete on table public.boleto_pendentes_audit from public, anon, authenticated;

create or replace function boletos_private.delete_boleto_pendentes_tratativa(
  p_audit_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_jwt_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  v_jwt_role text := coalesce(auth.jwt() -> 'app_metadata' ->> 'app_role', '');
  v_database_email text;
  v_database_role text;
  v_target record;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  select
    lower(btrim(coalesce(users.email, ''))),
    coalesce(users.raw_app_meta_data ->> 'app_role', '')
  into v_database_email, v_database_role
  from auth.users as users
  where users.id = v_user_id;

  if v_database_email is distinct from 'lucas.abnersd@gmail.com'
     or v_jwt_email is distinct from 'lucas.abnersd@gmail.com'
     or v_database_role is distinct from 'admin'
     or v_jwt_role is distinct from 'admin' then
    raise exception using
      errcode = '42501',
      message = 'Only the configured administrator can delete treatments.';
  end if;

  if nullif(btrim(coalesce(p_audit_id, '')), '') is null then
    return false;
  end if;

  select audit.*
  into v_target
  from public.boleto_pendentes_audit as audit
  where audit.id::text = btrim(p_audit_id)
    and audit.field_name = 'tratativa'
    and coalesce(boletos_private.try_parse_jsonb(audit.new_value) ->> 'action', '') = 'tratativa_insert'
  for update;

  if not found then
    return false;
  end if;

  -- Preserve an immutable tombstone with the removed content and trusted
  -- server-side attribution. The UI filters this field out of active history.
  insert into public.boleto_pendentes_audit (
    item_id,
    field_name,
    old_value,
    new_value
  )
  values (
    v_target.item_id,
    'tratativa_exclusao',
    v_target.new_value,
    jsonb_build_object(
      'action', 'tratativa_delete',
      'payload', jsonb_build_object(
        'deleted_audit_id', v_target.id::text,
        'deleted_by_user_id', v_user_id,
        'deleted_by_email', v_database_email,
        'deleted_by_role', v_database_role,
        'deleted_at', to_jsonb(timezone('utc', statement_timestamp())),
        'deleted_entry', boletos_private.try_parse_jsonb(v_target.new_value)
      )
    )::text
  );

  delete from public.boleto_pendentes_audit
  where id::text = v_target.id::text;

  return true;
end;
$function$;

revoke all on function boletos_private.delete_boleto_pendentes_tratativa(text)
  from public, anon, authenticated;
grant usage on schema boletos_private to authenticated;
grant execute on function boletos_private.delete_boleto_pendentes_tratativa(text)
  to authenticated;

-- Public RPC wrapper remains SECURITY INVOKER. The privileged implementation
-- stays outside the exposed public schema and repeats all authorization checks.
create or replace function public.delete_boleto_pendentes_tratativa(
  p_audit_id text
)
returns boolean
language sql
security invoker
set search_path = ''
as $function$
  select boletos_private.delete_boleto_pendentes_tratativa(p_audit_id);
$function$;

comment on function public.delete_boleto_pendentes_tratativa(text) is
  'Deletes one active treatment for the configured BOLETOS administrator and keeps an audit tombstone.';

revoke all on function public.delete_boleto_pendentes_tratativa(text)
  from public, anon;
grant execute on function public.delete_boleto_pendentes_tratativa(text)
  to authenticated;
