/**
 * Which of the five states a shop's plan is in.
 *
 * Only three of them are stored. `subscriptions.status` says trialing or
 * active; `grace` and `expired` are read off the expiry date and the
 * grace window, which is the same arithmetic RLS uses to decide whether
 * the shop's products are public. Keeping it derived is what makes
 * paying restore a shop instantly: one date moves, and the products
 * come back with no writes of their own.
 *
 * `pending` is not a subscription state at all — it is a payment the
 * seller says they have sent and the owner has not yet found. It sits
 * on top of whatever the subscription is really doing, because a seller
 * whose trial is running out while their transfer is unconfirmed is
 * still on trial.
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
 *   key      trial | pending | active | grace | expired
 *   days     days left in whatever the key counts, never negative
 *   pending  true when a transfer is waiting, whatever the key is
 */
export function planState(state, pending = false, now = Date.now()) {
  if (!state) {
    return { key: pending ? 'pending' : 'expired', days: 0, pending };
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
