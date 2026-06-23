-- Project-wide Supabase advisor hardening.
--
-- 1) rls_auto_enable() is an event-trigger helper and must not be callable
-- through the public REST/RPC API by anon/authenticated clients.
-- 2) SE2 helper functions keep their existing behavior but pin search_path to
-- avoid role-mutable path resolution.

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

alter function public.se2_email_autorizado() set search_path = '';
alter function public.se2_touch_atualizado_em() set search_path = '';
