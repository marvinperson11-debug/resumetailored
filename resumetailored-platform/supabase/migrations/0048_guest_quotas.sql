-- Guest (signed-out) free-tier quotas + the global anonymous spend ceiling.
--
-- Visitors can try the free tools without an account (lib/guest.ts). Each guest is an
-- opaque HMAC id — never a raw IP — and gets a small per-tool, per-day allowance. Two
-- rows are charged per reservation, both in this table:
--   guest_id = '<hmac(ip + cookie)>'  the guest's own allowance
--   guest_id = 'ip:<hmac(ip)>'        a looser per-IP ceiling, so a client that discards
--                                     the rt_guest cookie cannot mint a new identity (and a
--                                     new allowance) on every request
--
-- Access is server-only: RLS is on with no policies, and the functions are executable by
-- the service role alone. The anon key ships in the browser bundle, so a function left
-- callable by `anon` would let anyone refund their own quota or inflate the spend counter.

create table if not exists public.guest_quotas (
  guest_id text   not null,
  day      date   not null,
  tool     text   not null,
  count    int    not null default 0 check (count >= 0),
  primary key (guest_id, day, tool)
);

-- Anonymous Claude spend per UTC day, in micro-USD (1e-6 dollar) so it stays an integer.
create table if not exists public.guest_spend (
  day       date   primary key,
  micro_usd bigint not null default 0 check (micro_usd >= 0)
);

alter table public.guest_quotas enable row level security;
alter table public.guest_spend  enable row level security;

-- Charge one use to the guest AND to its IP ceiling, atomically, or charge neither.
-- Returns 'ok', 'guest_cap' (the guest is out) or 'ip_cap' (the address is out).
-- Each upsert is a single statement whose WHERE only lets the increment through while
-- count < limit, so two concurrent requests cannot both take the last slot.
create or replace function public.guest_quota_reserve(
  p_guest    text,
  p_ip_key   text,
  p_day      date,
  p_tool     text,
  p_limit    int,
  p_ip_limit int
) returns text
language plpgsql
as $$
declare
  v int;
begin
  insert into public.guest_quotas as q (guest_id, day, tool, count)
  values (p_guest, p_day, p_tool, 1)
  on conflict (guest_id, day, tool) do update set count = q.count + 1
    where q.count < p_limit
  returning q.count into v;
  if v is null then
    return 'guest_cap';
  end if;

  insert into public.guest_quotas as q (guest_id, day, tool, count)
  values (p_ip_key, p_day, p_tool, 1)
  on conflict (guest_id, day, tool) do update set count = q.count + 1
    where q.count < p_ip_limit
  returning q.count into v;
  if v is null then
    -- Undo the guest's own charge so a rejected request costs nothing.
    update public.guest_quotas
       set count = greatest(count - 1, 0)
     where guest_id = p_guest and day = p_day and tool = p_tool;
    return 'ip_cap';
  end if;

  return 'ok';
end;
$$;

-- Give a use back (the Claude call failed, or the upload could not be read).
create or replace function public.guest_quota_refund(
  p_guest  text,
  p_ip_key text,
  p_day    date,
  p_tool   text
) returns void
language sql
as $$
  update public.guest_quotas
     set count = greatest(count - 1, 0)
   where day = p_day and tool = p_tool and guest_id in (p_guest, p_ip_key);
$$;

-- Add one generation's cost to today's anonymous total; returns the new total.
create or replace function public.guest_spend_add(
  p_day   date,
  p_micro bigint
) returns bigint
language sql
as $$
  insert into public.guest_spend as s (day, micro_usd)
  values (p_day, greatest(p_micro, 0))
  on conflict (day) do update set micro_usd = s.micro_usd + greatest(p_micro, 0)
  returning s.micro_usd;
$$;

revoke all on function public.guest_quota_reserve(text, text, date, text, int, int) from public, anon, authenticated;
revoke all on function public.guest_quota_refund(text, text, date, text)            from public, anon, authenticated;
revoke all on function public.guest_spend_add(date, bigint)                          from public, anon, authenticated;
grant execute on function public.guest_quota_reserve(text, text, date, text, int, int) to service_role;
grant execute on function public.guest_quota_refund(text, text, date, text)            to service_role;
grant execute on function public.guest_spend_add(date, bigint)                          to service_role;
