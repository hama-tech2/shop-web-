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

export const GRACE_DAYS = 7;

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

/** True when the dashboard should carry a banner about the plan. */
export function bannerFor(plan, soonDays) {
  if (plan.key === 'expired') return 'hidden';
  if (plan.key === 'grace') return 'grace';
  if (plan.key === 'pending') return 'pending';
  if (plan.days <= soonDays) return 'soon';
  return null;
}
