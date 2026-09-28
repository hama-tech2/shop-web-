/**
 * Which state a shop's plan is in.
 *
 * Six answers, and every one of them is read off dates the database
 * handed over rather than computed here:
 *
 *   trial      the free month is running, nothing bought yet
 *   scheduled  the free month is running and a plan is already bought,
 *              waiting to start the day it ends
 *   active     a paid plan is running
 *   grace      past the expiry, products still up for the grace days
 *   expired    past that. Products are hidden. Nothing is deleted.
 *   pending    a hand-made transfer the owner has not yet found
 *
 * `pending` is not a subscription state at all. It sits on top of
 * whatever the subscription is really doing, because a seller whose
 * free month is running out while their transfer is unconfirmed is
 * still on their free month.
 *
 * Nothing in here decides anything. subscription_state() in the
 * database answers "is the trial running", "is a plan scheduled" and
 * "when does entitlement end", and this turns those into the word a
 * screen needs. A browser must never be the thing that decides whether
 * somebody's free month is over.
 */

export const GRACE_DAYS = 3;

const DAY = 86400000;

/** Whole days from `from` to `iso`, rounded up. Negative once past. */
export function daysUntil(iso, from = Date.now()) {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  return Math.ceil((at - from) / DAY);
}

/**
 * `state` is a row from the subscription_state RPC; `pending` is true
 * when the shop has a payment_intent waiting on the owner.
 *
 * Returns:
 *   key      free | pending | active | grace | expired
 *   days     days left in whatever the key counts, never negative
 *   pending  true when a transfer is waiting, whatever the key is
 */
export function planState(state, pending = false, now = Date.now()) {
  if (!state) {
    return { key: pending ? 'pending' : 'expired', days: 0, pending };
  }

  // No plan at all, and no free month either: the trial ledger could not
  // be read when the shop was made. Rare, and not the same thing as the
  // free month having run out, so it is not drawn as a countdown that
  // reached zero.
  if (state.status === 'none' || state.plan === 'none') {
    return { key: 'none', days: 0, pending };
  }

  // A row still stored as the old permanent Free plan: the transition in
  // migration 20260927090000 has not run yet, or this shop is suspended
  // or banned and was left alone by it on purpose.
  if (state.status === 'free' || state.plan === 'free') {
    return { key: 'trial', days: state.trial_days_left ?? 0, pending, legacyFree: true };
  }

  // The free month, which the database has already decided about. A
  // plan bought during it is scheduled, not running: the seller has
  // both, and the screen has to be able to say so.
  if (state.on_trial) {
    const days = Number.isInteger(state.trial_days_left) ? state.trial_days_left : 0;
    if (pending) return { key: 'pending', days, pending, onTrial: true };
    return {
      key: state.paid_scheduled ? 'scheduled' : 'trial',
      days,
      pending,
      onTrial: true,
      scheduledPlan: state.paid_scheduled ? state.plan : null,
    };
  }

  const left = daysUntil(state.expires_at, now);
  const days = left === null ? 0 : left;

  // Past the expiry date: grace while the products are still up,
  // expired once they are not. subscription_state hands back the exact
  // moment grace ends; the constant is only a fallback for a caller
  // that has the expiry date and nothing else.
  if (days <= 0) {
    const graceLeft = state.grace_ends_at
      ? daysUntil(state.grace_ends_at, now)
      : days + GRACE_DAYS;
    return graceLeft > 0
      ? { key: 'grace', days: graceLeft, pending }
      : { key: 'expired', days: 0, pending };
  }

  // A pending transfer is what the seller most wants to know about, so
  // it wins the headline while the plan is still running.
  if (pending) return { key: 'pending', days, pending };

  // Past the free month, still inside the entitlement: a paid plan
  // running. A row still on plan 'trial' at this point has a trial that
  // has not been swept yet, and is what the grace branch above catches
  // once its date passes.
  return { key: state.plan === 'trial' ? 'trial' : 'active', days, pending };
}

/**
 * Which renewal banner belongs on the seller's own screens, if any.
 *
 * Returns { kind, days, dismissible, cooldown } or null.
 *
 *   soon    amber, closes, comes back after `cooldown` days
 *   urgent  amber, closes, comes back the next day
 *   grace   red, cannot be closed — the shop is about to go dark
 *   hidden  red, cannot be closed — the products are already gone
 *
 * A shop is warned at different points depending on what it is on: a
 * one-month trial gets two warnings, a six- or twelve-month plan gets
 * three, because a seller who last thought about billing in March needs
 * more than three days' notice in September.
 *
 * `dismissedAt` is a map of kind -> ISO timestamp, read from the
 * database rather than the browser: a seller who closes a banner on
 * their phone should not meet it again on a laptop, and clearing site
 * data must not be a way to lose the warning.
 */
export function bannerFor(plan, schedule, dismissedAt = {}, now = Date.now()) {
  // A plan bought during the free month needs no warning: it starts the
  // day the month ends and the seller has already done the thing a
  // banner would be asking them to do.
  if (plan.key === 'scheduled') return null;
  if (plan.key === 'free') return null;
  // A row the transition left on the old permanent Free plan, which
  // means a suspended or banned shop. It carries no real day count, so
  // a countdown off it would be an invented deadline.
  if (plan.legacyFree) return null;
  if (plan.key === 'expired') {
    return { kind: 'hidden', days: 0, dismissible: false };
  }
  if (plan.key === 'grace') {
    return { kind: 'grace', days: plan.days, dismissible: false };
  }
  if (plan.key === 'pending') {
    return { kind: 'pending', days: plan.days, dismissible: false };
  }

  // Which thresholds apply, largest first. `trial` is the free month;
  // anything else the seller has paid for.
  const days = (plan.key === 'trial' ? schedule.trialDays : schedule.paidDays)
    .slice()
    .sort((a, b) => b - a);
  if (!days.length || plan.days > days[0]) return null;

  // The last threshold is the urgent one; everything before it is soon.
  const last = days[days.length - 1];
  const kind = plan.days <= last ? 'urgent' : 'soon';
  const cooldown = schedule.cooldown[kind];

  // Closed recently enough that it should stay closed. Never for good:
  // once the cooldown passes it is back, and the urgent one is back the
  // next day for as long as the plan is nearly over.
  const closed = Date.parse(dismissedAt?.[kind] ?? '');
  if (!Number.isNaN(closed) && now - closed < cooldown * 86400000) return null;

  return { kind, days: plan.days, dismissible: true, cooldown };
}
