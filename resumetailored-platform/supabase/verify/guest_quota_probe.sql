-- Production probe for the guest quota functions (migration 0048).
--
-- Paste the whole script into the Supabase SQL editor of the PRODUCTION project and run it.
-- It calls the real guest_quota_reserve / guest_quota_refund / guest_spend_add exactly the way the app
-- does (as `service_role`), checks the results and the rows they leave in guest_quotas, tries one call
-- as `anon` (which must be refused), and prints one row per check. Everything it writes uses the throwaway
-- tool name 'zz-probe' (and the date 2000-01-01 for spend) and is deleted at the end, so it is safe to
-- re-run and touches no real guest's allowance.
--
-- Read the result: every row's `pass` must be true. If the script itself errors, the error text IS the
-- finding (e.g. "permission denied for function …", "function … does not exist").

delete from public.guest_quotas where tool = 'zz-probe';
delete from public.guest_spend  where day = date '2000-01-01';

create temp table if not exists probe (step int, check_name text, expected text, actual text);
truncate probe;

do $$
declare
  r      text;
  n      bigint;
  before bigint;
  d      date := current_date;
begin
  -- 1-2: first use is allowed, the second use by the same guest hits the cap (limit 1)
  set local role service_role;
  r := public.guest_quota_reserve('zz-guest-1', 'ip:zz-probe', d, 'zz-probe', 1, 10);
  reset role;
  insert into probe values (1, 'reserve #1 (first use)', 'ok', r);

  set local role service_role;
  r := public.guest_quota_reserve('zz-guest-1', 'ip:zz-probe', d, 'zz-probe', 1, 10);
  reset role;
  insert into probe values (2, 'reserve #2, same guest (THE CAP)', 'guest_cap', r);

  -- 3-4: the rows the app relies on exist with the right counts
  select count into n from public.guest_quotas where guest_id = 'zz-guest-1' and day = d and tool = 'zz-probe';
  insert into probe values (3, 'guest row count after 2 attempts', '1', coalesce(n::text, 'no row'));
  select count into n from public.guest_quotas where guest_id = 'ip:zz-probe' and day = d and tool = 'zz-probe';
  insert into probe values (4, 'ip-ceiling row count after 2 attempts (only the allowed one is charged)', '1', coalesce(n::text, 'no row'));

  -- 5: a different guest on the same address is a separate allowance
  set local role service_role;
  r := public.guest_quota_reserve('zz-guest-2', 'ip:zz-probe', d, 'zz-probe', 1, 10);
  reset role;
  insert into probe values (5, 'reserve, other guest, same ip', 'ok', r);

  -- 6: the per-address ceiling (limit 2 here) rejects a third guest and does not charge them
  set local role service_role;
  r := public.guest_quota_reserve('zz-guest-3', 'ip:zz-probe', d, 'zz-probe', 1, 2);
  reset role;
  insert into probe values (6, 'reserve, third guest, ip ceiling of 2', 'ip_cap', r);
  select count into n from public.guest_quotas where guest_id = 'zz-guest-3' and day = d and tool = 'zz-probe';
  insert into probe values (7, 'the rejected guest ends uncharged (charge undone, row left at 0)', '0', coalesce(n::text, 'no row'));

  -- 8-9: refund gives the use back, and the guest can reserve again
  set local role service_role;
  perform public.guest_quota_refund('zz-guest-1', 'ip:zz-probe', d, 'zz-probe');
  reset role;
  select count into n from public.guest_quotas where guest_id = 'zz-guest-1' and day = d and tool = 'zz-probe';
  insert into probe values (8, 'guest row count after refund', '0', coalesce(n::text, 'no row'));
  set local role service_role;
  r := public.guest_quota_reserve('zz-guest-1', 'ip:zz-probe', d, 'zz-probe', 1, 10);
  reset role;
  insert into probe values (9, 'reserve after refund', 'ok', r);

  -- 10: spend counter (on a dummy date, so today's real total is untouched)
  set local role service_role;
  before := public.guest_spend_add(date '2000-01-01', 0);
  n := public.guest_spend_add(date '2000-01-01', 1500);
  reset role;
  insert into probe values (10, 'guest_spend_add adds exactly what it is given', '1500', (n - before)::text);

  -- 11: the browser-visible key must NOT be able to call it
  begin
    set local role anon;
    r := public.guest_quota_reserve('zz-guest-anon', 'ip:zz-probe', d, 'zz-probe', 1, 10);
    reset role;
    insert into probe values (11, 'anon calling guest_quota_reserve', 'permission denied', 'CALL SUCCEEDED (anon can call it!)');
  exception when insufficient_privilege then
    reset role;
    insert into probe values (11, 'anon calling guest_quota_reserve', 'permission denied', 'permission denied');
  end;
end
$$;

delete from public.guest_quotas where tool = 'zz-probe';
delete from public.guest_spend  where day = date '2000-01-01';

select step, check_name, expected, actual, (expected = actual) as pass
from probe
order by step;
