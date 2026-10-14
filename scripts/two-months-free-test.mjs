/** Compatibility entry point. The 60-day/one-image assertions are historical.
 * Current Worker coverage is shared with permanent-free-worker-test.mjs;
 * exact entitlement calendars/RLS are exercised by the isolated DB suites. */
await import('./permanent-free-worker-test.mjs');
