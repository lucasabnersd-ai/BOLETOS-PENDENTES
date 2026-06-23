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

create or replace function boletos_private.enforce_boleto_item_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_database_email text;
  v_database_role text;
  v_can_sync_boleto boolean;
begin
  if v_user_id is null then
    return new;
  end if;

  select
    lower(btrim(coalesce(users.email, ''))),
    coalesce(users.raw_app_meta_data ->> 'app_role', 'standard'),
    coalesce((users.raw_app_meta_data ->> 'can_sync_boleto')::boolean, false)
  into v_database_email, v_database_role, v_can_sync_boleto
  from auth.users as users
  where users.id = v_user_id;

  if coalesce(v_database_role, '') <> 'admin'
     and coalesce(v_can_sync_boleto, false) is not true
     and (
       to_jsonb(new)
         - 'tratado_pendente'
         - 'last_changed_by'
         - 'last_changed_at'
         - 'updated_at'
       is distinct from
       to_jsonb(old)
         - 'tratado_pendente'
         - 'last_changed_by'
         - 'last_changed_at'
         - 'updated_at'
     ) then
    raise exception 'Somente administrador ou conta tecnica pode alterar campos protegidos dos boletos.'
      using errcode = '42501';
  end if;

  if old.tratado_pendente is distinct from new.tratado_pendente
     or old.last_changed_by is distinct from new.last_changed_by
     or old.last_changed_at is distinct from new.last_changed_at then
    new.last_changed_by := coalesce(nullif(v_database_email, ''), 'Sistema');
    new.last_changed_at := statement_timestamp();
  end if;

  return new;
end;
$function$;

revoke all on function boletos_private.enforce_boleto_item_actor() from public, anon, authenticated;

drop trigger if exists enforce_boleto_item_actor on public.boleto_pendentes_items;

create trigger enforce_boleto_item_actor
before update on public.boleto_pendentes_items
for each row
execute function boletos_private.enforce_boleto_item_actor();

create or replace function boletos_private.enforce_boleto_audit_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_database_email text;
  v_database_role text;
  v_new_value jsonb;
  v_payload jsonb;
begin
  if v_user_id is null or new.field_name = 'tratativa_exclusao' then
    return new;
  end if;

  select
    lower(btrim(coalesce(users.email, ''))),
    coalesce(users.raw_app_meta_data ->> 'app_role', 'standard')
  into v_database_email, v_database_role
  from auth.users as users
  where users.id = v_user_id;

  v_new_value := boletos_private.try_parse_jsonb(new.new_value);
  if jsonb_typeof(v_new_value) is distinct from 'object' then
    return new;
  end if;

  v_payload := v_new_value -> 'payload';
  if jsonb_typeof(v_payload) is distinct from 'object' then
    v_payload := '{}'::jsonb;
  end if;

  v_payload := v_payload || jsonb_build_object(
    'changed_by', coalesce(nullif(v_database_email, ''), 'Sistema'),
    'changed_by_user_id', v_user_id,
    'changed_by_email', coalesce(nullif(v_database_email, ''), null),
    'changed_by_role', coalesce(nullif(v_database_role, ''), 'standard'),
    'changed_at', to_jsonb(timezone('utc', statement_timestamp()))
  );

  new.new_value := (v_new_value || jsonb_build_object('payload', v_payload))::text;
  return new;
end;
$function$;

revoke all on function boletos_private.enforce_boleto_audit_actor() from public, anon, authenticated;

drop trigger if exists enforce_boleto_audit_actor on public.boleto_pendentes_audit;

create trigger enforce_boleto_audit_actor
before insert on public.boleto_pendentes_audit
for each row
execute function boletos_private.enforce_boleto_audit_actor();

-- Deletion is available only through the checked RPC below. SELECT/INSERT
-- permissions and their existing RLS policies are intentionally unchanged.
revoke delete on table public.boleto_pendentes_audit from public, anon, authenticated;
revoke update on table public.boleto_pendentes_audit from public, anon, authenticated;
revoke update on table public.boleto_pendentes_items from anon;

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
