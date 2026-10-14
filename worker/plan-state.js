/** Presentation of the database's effective entitlement; Free has no clock. */
export const GRACE_DAYS = 3;
const DAY = 86400000;
export function daysUntil(iso, from = Date.now()) {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : Math.ceil((at - from) / DAY);
}
export function planState(state, pending = false, now = Date.now()) {
  if (!state) return { key: 'unknown', days: 0, pending };
  if (state.tier === 'restricted' || state.status === 'suspended') return { key: 'suspended', days: 0, pending };
  if (state.paid_scheduled) return { key: 'scheduled', days: state.trial_days_left ?? 0, pending, scheduledPlan: state.plan };
  if (state.in_grace) return { key: 'grace', days: Math.max(0, daysUntil(state.grace_ends_at, now) ?? 0), pending };
  if (state.tier === 'free' || state.status === 'free' || state.plan === 'free') return { key: 'free', days: 0, pending };
  if (state.tier === 'paid') return { key: pending ? 'pending' : 'active', days: Math.max(0, state.days_left ?? daysUntil(state.expires_at, now) ?? 0), pending };
  return { key: 'unknown', days: 0, pending };
}
export function bannerFor(plan, schedule, dismissedAt = {}, now = Date.now()) {
  if (['free','scheduled','suspended','unknown'].includes(plan.key)) return null;
  if (plan.key === 'grace') return { kind: 'grace', days: plan.days, dismissible: false };
  if (plan.key === 'pending') return { kind: 'pending', days: plan.days, dismissible: false };
  const days = schedule.paidDays.slice().sort((a,b) => b-a);
  if (!days.length || plan.days > days[0]) return null;
  const kind = plan.days <= days[days.length-1] ? 'urgent' : 'soon';
  const cooldown = schedule.cooldown[kind];
  const closed = Date.parse(dismissedAt?.[kind] ?? '');
  if (!Number.isNaN(closed) && now-closed < cooldown*DAY) return null;
  return { kind, days: plan.days, dismissible: true, cooldown };
}
