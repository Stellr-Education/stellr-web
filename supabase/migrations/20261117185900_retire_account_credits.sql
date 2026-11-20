-- Retire account credits, step 1 of 2: EXPAND (docs/PLAN-event-add-ons-2026-11-17.md, Phase R;
-- owner, 17 Nov 2026).
--
-- Account credit, money held for a member in place of a cash refund and spent at a
-- later Checkout, is no longer offered. Two stores held it: public.account_credits
-- (+ credit_redemptions) and entitlements.account_credit_ledger. Mentoring "session
-- credits" are membership allowances, not money, and are untouched (Q21).
--
-- This step only adds what the new code calls, and is safe under the code running
-- today: nothing is dropped. The new code stops reading and writing credit
-- (lib/refunds, lib/scholarship-refund.ts, lib/entitlements.ts, the webhook and
-- membership checkout). Step 2 (CONTRACT) drops the tables, columns, old function
-- signatures and the 'credit' refund type, and ships in a later release, once this
-- code is on production, so no deployed code ever reads a dropped object.
--
--   fn_quote               keeps its columns; credit_available is always 0 and
--                          payable is the net price (step 2 drops the column)
--   fn_confirm_paid_booking a 5-argument form without a credit amount, beside the
--                          old 6-argument one (step 2 drops the old one)
--   fn_refund_entitlement  a 1-argument form that never issues credit, beside the
--                          old one (step 2 drops the old one)
--   fn_cancel_cohort,      no longer look at credit_applied_cents
--   fn_release_one_booking

-- The quote no longer subtracts a credit balance: payable is the net price.
CREATE OR REPLACE FUNCTION entitlements.fn_quote(p_member uuid, p_offering uuid, p_coupon text DEFAULT NULL::text)
  RETURNS TABLE(included_available boolean, base_cents integer, tier_discount_pct numeric, after_tier_cents integer, coupon_code text, coupon_applied boolean, coupon_discount_cents integer, net_cents integer, credit_available integer, payable_cents integer)
  LANGUAGE plpgsql STABLE
  SET search_path TO 'entitlements', 'public'
AS $$
declare
  o entitlements.offerings%rowtype;
  v_kind entitlements.entitlement_kind;
  v_base int; v_tier numeric; v_after int;
  c entitlements.discounts; v_coupon_cut int := 0; v_applied boolean := false;
  v_net int;
begin
  select * into o from entitlements.offerings where id = p_offering;
  v_kind := case o.type
              when 'coaching_session' then 'coaching_session'::entitlements.entitlement_kind
              when 'mentoring_cohort' then 'cohort_access'::entitlements.entitlement_kind
              when 'call_series'      then 'call_series'::entitlements.entitlement_kind
              when 'training_content' then 'training_access'::entitlements.entitlement_kind
            end;

  if entitlements.fn_allocation_balance(p_member, v_kind, p_offering, o.type) > 0 then
    return query select true, 0, 0::numeric, 0, null::text, false, 0, 0, 0, 0;
    return;
  end if;

  v_base  := coalesce(entitlements.fn_base_price_cents(p_offering), 0);
  v_tier  := entitlements.fn_tier_discount_pct(p_member, o.type);
  v_after := round(v_base * (1 - v_tier/100.0))::int;

  if p_coupon is not null then
    c := entitlements.fn_validate_coupon(p_coupon, o.type);
    if c.id is not null then
      v_applied := true;
      if c.discount_type = 'percent' then
        v_coupon_cut := round(v_after * (c.percent/100.0))::int;
      else
        v_coupon_cut := least(c.amount_cents, v_after);
      end if;
    end if;
  end if;

  v_net := greatest(v_after - v_coupon_cut, 0);
  return query select false, v_base, v_tier, v_after,
                      case when v_applied then c.code else null end, v_applied, v_coupon_cut,
                      v_net, 0, v_net;
end $$;
REVOKE EXECUTE ON FUNCTION entitlements.fn_quote(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION entitlements.fn_quote(uuid, uuid, text) TO service_role;

-- A paid booking without a credit amount (the old 6-argument form stays until step 2).
CREATE OR REPLACE FUNCTION entitlements.fn_confirm_paid_booking(p_member uuid, p_offering uuid, p_stripe_payment text, p_amount_charged_cents integer, p_participant uuid DEFAULT NULL::uuid)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'entitlements', 'public'
AS $$
declare o entitlements.offerings%rowtype; v_kind entitlements.entitlement_kind; ent_id uuid; b_id uuid;
begin
  select * into o from entitlements.offerings where id = p_offering for update;
  if o.status <> 'open' then raise exception 'Offering % not open', p_offering; end if;
  v_kind := case o.type
              when 'coaching_session' then 'coaching_session'::entitlements.entitlement_kind
              when 'mentoring_cohort' then 'cohort_access'::entitlements.entitlement_kind
              when 'call_series'      then 'call_series'::entitlements.entitlement_kind
              when 'training_content' then 'training_access'::entitlements.entitlement_kind
            end;
  if o.type = 'mentoring_cohort' and o.capacity is not null then
    if o.seats_taken >= o.capacity then raise exception 'Cohort full'; end if;
    update entitlements.offerings set seats_taken = seats_taken + 1,
           status = case when seats_taken + 1 >= capacity then 'full' else status end
     where id = p_offering;
  end if;
  insert into entitlements.entitlements(member_id, kind, scope_type, offering_id, quantity_total, quantity_remaining, source, source_ref, refundable, status, expires_at)
  values (p_member, v_kind, 'specific_offering', p_offering, 1, 0, 'purchased', p_stripe_payment, true, 'consumed', entitlements.fn_purchase_expiry())
  returning id into ent_id;
  insert into entitlements.bookings(member_id, offering_id, consumed_entitlement_id, amount_charged_cents, stripe_payment_id, status)
  values (p_member, p_offering, ent_id, p_amount_charged_cents, p_stripe_payment, 'reserved')
  returning id into b_id;
  return b_id;
end $$;
REVOKE EXECUTE ON FUNCTION entitlements.fn_confirm_paid_booking(uuid, uuid, text, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION entitlements.fn_confirm_paid_booking(uuid, uuid, text, integer, uuid) TO service_role;

-- Cancelling a cohort restores free allocations; paid bookings are refunded to the
-- card by the caller (lib/entitlements.ts cancelCohortViaLedger).
CREATE OR REPLACE FUNCTION entitlements.fn_cancel_cohort(p_offering uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'entitlements', 'public'
AS $$
declare b entitlements.bookings%rowtype; o entitlements.offerings%rowtype; v_restore int;
begin
  select * into o from entitlements.offerings where id = p_offering;
  if o.type = 'mentoring_cohort' then
    select greatest(1, coalesce(mc.planned_sessions, 1)) into v_restore
      from public.mentoring_cohorts mc where mc.id = o.cohort_id;
  else
    v_restore := 1;
  end if;
  for b in select * from entitlements.bookings where offering_id = p_offering and status = 'reserved'
  loop
    -- Restore drawn allocations only (free/included bookings). PAID bookings
    -- are refunded to the card by the caller.
    if coalesce(b.amount_charged_cents, 0) = 0 and b.consumed_entitlement_id is not null then
      update entitlements.entitlements
         set quantity_remaining = quantity_remaining + v_restore, status = 'active',
             expires_at = greatest(coalesce(expires_at, now()), now() + interval '90 days')
       where id = b.consumed_entitlement_id;
    end if;
    update entitlements.bookings set status = 'cancelled' where id = b.id;
  end loop;
  update entitlements.offerings set seats_taken = 0, status = 'cancelled' where id = p_offering;
end $$;
REVOKE EXECUTE ON FUNCTION entitlements.fn_cancel_cohort(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION entitlements.fn_cancel_cohort(uuid) TO service_role;

CREATE OR REPLACE FUNCTION entitlements.fn_release_one_booking(p_member uuid, p_offering uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'entitlements', 'public'
AS $$
declare b entitlements.bookings%rowtype;
begin
  select * into b from entitlements.bookings
   where member_id = p_member and offering_id = p_offering and status = 'reserved'
     and coalesce(amount_charged_cents, 0) = 0
   order by created_at desc
   for update skip locked limit 1;
  if b.id is null then return false; end if;
  if b.consumed_entitlement_id is not null then
    update entitlements.entitlements
       set quantity_remaining = quantity_remaining + 1,
           status = case when status = 'consumed' then 'active' else status end
     where id = b.consumed_entitlement_id;
  end if;
  update entitlements.bookings set status = 'cancelled' where id = b.id;
  return true;
end $$;
REVOKE EXECUTE ON FUNCTION entitlements.fn_release_one_booking(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION entitlements.fn_release_one_booking(uuid, uuid) TO service_role;

-- A refunded entitlement is marked refunded; the money goes back to the card, never to a
-- balance (the old 3-argument form stays until step 2).
CREATE OR REPLACE FUNCTION entitlements.fn_refund_entitlement(p_entitlement uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'entitlements', 'public'
AS $$
declare e entitlements.entitlements%rowtype;
begin
  select * into e from entitlements.entitlements where id = p_entitlement;
  if e.id is null then raise exception 'Entitlement not found'; end if;
  if not e.refundable then raise exception 'Granted entitlement % is not refundable', p_entitlement; end if;
  update entitlements.entitlements set status = 'refunded', quantity_remaining = 0 where id = p_entitlement;
end $$;
REVOKE EXECUTE ON FUNCTION entitlements.fn_refund_entitlement(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION entitlements.fn_refund_entitlement(uuid) TO service_role;
