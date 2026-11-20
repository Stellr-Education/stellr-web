-- Retire account credits, step 2 of 2: CONTRACT (docs/PLAN-event-add-ons-2026-11-17.md,
-- Phase R; owner, 17 Nov 2026). Ships only once step 1's code
-- (20261117185900_retire_account_credits and its PR) is on production, so no deployed
-- code reads anything dropped here.
--
-- The owner confirmed no balances exist (Q22, Q23). This migration checks that itself
-- and refuses to run otherwise, so a balance or its history is never dropped unseen.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.account_credits WHERE remaining_cents > 0) THEN
    RAISE EXCEPTION 'retire_account_credits_contract: a live account credit balance exists; settle it first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.credit_redemptions WHERE status = 'reserved') THEN
    RAISE EXCEPTION 'retire_account_credits_contract: a credit reservation is open; settle it first';
  END IF;
  IF EXISTS (SELECT 1 FROM entitlements.account_credit_ledger GROUP BY member_id HAVING sum(amount_cents) <> 0) THEN
    RAISE EXCEPTION 'retire_account_credits_contract: an entitlements credit balance exists; settle it first';
  END IF;
  IF EXISTS (SELECT 1 FROM entitlements.bookings WHERE coalesce(credit_applied_cents, 0) <> 0) THEN
    RAISE EXCEPTION 'retire_account_credits_contract: a booking was part-paid in credit; decide how to keep that history first';
  END IF;
END $$;

-- public: new refunds are cash (or manual, or none) only. Refunds already issued as
-- credit stay as history (owner, 20 Nov 2026: production holds one, its credit fully
-- used); 'credit' is valid only on a row created before credits were retired.
ALTER TABLE public.event_refunds DROP COLUMN IF EXISTS account_credit_id;
ALTER TABLE public.event_refunds DROP COLUMN IF EXISTS credit_validity_days;
ALTER TABLE public.event_refunds DROP CONSTRAINT IF EXISTS event_refunds_refund_type_check;
ALTER TABLE public.event_refunds
  ADD CONSTRAINT event_refunds_refund_type_check CHECK (
    refund_type IN ('cash', 'manual_required', 'none')
    OR (refund_type = 'credit' AND created_at < timestamptz '2026-11-20 00:00:00+00')
  );

-- The one-refund-per-thing indexes counted cash or credit; now cash alone.
DROP INDEX IF EXISTS public.event_refunds_one_cancellation_per_participant;
CREATE UNIQUE INDEX IF NOT EXISTS event_refunds_one_cancellation_per_participant
  ON public.event_refunds (participant_id)
  WHERE kind = 'cancellation' AND refund_type = 'cash';
DROP INDEX IF EXISTS public.event_refunds_one_scholarship_per_registration;
CREATE UNIQUE INDEX IF NOT EXISTS event_refunds_one_scholarship_per_registration
  ON public.event_refunds (registration_id)
  WHERE kind = 'scholarship' AND refund_type = 'cash';

DROP TABLE IF EXISTS public.credit_redemptions;
DROP TABLE IF EXISTS public.account_credits;

-- entitlements: the quote loses credit_available (always 0 since step 1).
DROP FUNCTION IF EXISTS entitlements.fn_quote(uuid, uuid, text);
CREATE FUNCTION entitlements.fn_quote(p_member uuid, p_offering uuid, p_coupon text DEFAULT NULL::text)
  RETURNS TABLE(included_available boolean, base_cents integer, tier_discount_pct numeric, after_tier_cents integer, coupon_code text, coupon_applied boolean, coupon_discount_cents integer, net_cents integer, payable_cents integer)
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
    return query select true, 0, 0::numeric, 0, null::text, false, 0, 0, 0;
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
                      v_net, v_net;
end $$;
REVOKE EXECUTE ON FUNCTION entitlements.fn_quote(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION entitlements.fn_quote(uuid, uuid, text) TO service_role;

-- The old forms that took or issued credit; step 1's forms stay.
DROP FUNCTION IF EXISTS entitlements.fn_confirm_paid_booking(uuid, uuid, text, integer, integer, uuid);
DROP FUNCTION IF EXISTS entitlements.fn_refund_entitlement(uuid, text, integer);
DROP FUNCTION IF EXISTS entitlements.fn_credit_balance(uuid);
ALTER TABLE entitlements.bookings DROP COLUMN IF EXISTS credit_applied_cents;
DROP TABLE IF EXISTS entitlements.account_credit_ledger;
DROP TYPE IF EXISTS entitlements.credit_reason;
