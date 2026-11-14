/**
 * Billing History and Refunds, wired — Phase 4, 13 Nov 2026.
 *
 * Both pages fetch with a token in the browser, so the server HTML holds the
 * shell and not the rows. That makes the **negative** assertions the valuable
 * ones here: a page still serving `HF-INV-0024` and `demo@upi` looks entirely
 * healthy, and is the exact failure this phase exists to end.
 *
 * The second group proves the fetch really shipped, by following the page's own
 * script tags and looking for the API path inside them — the bundle-marker
 * technique `smoke-web-dashboard` uses, because a build that dropped the
 * component would serve identical HTML.
 *
 * The third group is about **honesty**: the demo promised a renewal date, an
 * auto-renew switch and a saved payment method, and the client's 13 Nov
 * decision is that nothing recurs. Those must not merely be unwired — they
 * must be gone, or the page is lying about the customer's money.
 *
 *   SMOKE_SITE_URL=http://localhost:3001 npm run smoke:web-billing
 */
import { smoke } from './smoke-harness.mjs';

const SITE = process.env.SMOKE_SITE_URL ?? 'http://localhost:3001';
const s = smoke();

const get = (path) => fetch(`${SITE}${path}`).then((r) => r.text());

/** Follows the page's script tags looking for `needle`. */
async function inBundle(html, needle) {
  const chunks = [...html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]);

  for (const chunk of chunks) {
    const code = await fetch(SITE + chunk).then((r) => (r.ok ? r.text() : ''));
    if (code.includes(needle)) return true;
  }

  return false;
}

s.section('both pages are served');

const billing = await get('/billing');
const refunds = await get('/refunds');

s.check('billing served', billing.length > 1000, true);
s.check('refunds served', refunds.length > 1000, true);
s.check('billing keeps its scope', billing.includes('data-hf-page="billing"'), true);
s.check('refunds keeps its scope', refunds.includes('data-hf-page="refunds"'), true);

s.section('the invented invoices are gone');

for (const fake of [
  'HF-INV-0024',
  'HF-INV-0019',
  'HF-INV-0012',
  'HF-INV-0008',
  'Plus Plan · Monthly',
  'Plus Plan · First month',
  'sample price',
]) {
  s.check(`no "${fake}"`, billing.includes(fake), false);
}

s.section('the table the client designed is still there');

for (const column of ['Invoice', 'Date', 'Description', 'Amount', 'Status', 'Receipt']) {
  s.check(`column ${column}`, billing.includes(`<th>${column}</th>`), true);
}

s.check('export button kept', billing.includes('id="downloadAll"'), true);
s.check('tbody is the live one', billing.includes('id="billingRows"'), true);

s.section('nothing on the page claims a recurring charge');

// The client's decision, 13 Nov 2026: choosing a plan charges nothing. A
// renewal date or an auto-renew switch would be a promise about their money.
for (const gone of [
  'Auto-renew',
  'Next billing date',
  'Turn off auto-renew',
  'Cancel membership',
  'Upcoming renewal',
  'Expected charge',
  'demo@upi',
  'Add another payment method',
  'HF-M-10482',
  'hello@example.com',
  'Monthly subscription',
  'Billing cycle',
]) {
  s.check(`no "${gone}"`, billing.includes(gone), false);
}

s.check('no demo-action modal', billing.includes('Confirm demo action'), false);
s.check('no prototype disclaimer', billing.includes('Prototype only:'), false);

s.section('billing reads the live API');

s.check(
  'invoices path in the bundle',
  await inBundle(billing, '/app/customer/invoices'),
  true,
);

s.section('the invented refund requests are gone');

for (const fake of [
  'RF-10024',
  'RF-10031',
  'HF-28104',
  'Refresh demo',
  'Cancellation confirmed',
  'Refund query relating to a previous membership payment',
]) {
  s.check(`no "${fake}"`, refunds.includes(fake), false);
}

// The form had no table behind it — no refund-request and no support-ticket
// model exists. A form that says "submitted" and drops the text is worse than
// no form. Flagged to the client rather than faked.
s.check('the dead request form is gone', refunds.includes('id="requestForm"'), false);
s.check('and its submit button', refunds.includes('Submit request →'), false);
s.check('no demo notice', refunds.includes('Demo notice:'), false);

s.section('refunds keeps the policy content and reads the API');

s.check('request list kept', refunds.includes('id="requestList"'), true);
s.check('refresh button kept', refunds.includes('id="refreshRequests"'), true);
s.check('policy band kept', refunds.includes('Before you submit'), true);
s.check('status guide kept', refunds.includes('Request status guide'), true);
s.check(
  'refunds path in the bundle',
  await inBundle(refunds, '/app/customer/refunds'),
  true,
);

s.section('every dead link on both pages is now a route');

s.check('billing: support is a link', billing.includes('href="/support-tickets"'), true);
s.check('billing: plans is a link', billing.includes('href="/plans"'), true);
s.check('refunds: help is a link', refunds.includes('href="/help"'), true);
s.check('billing: no #footer left', billing.includes('href="#footer"'), false);
s.check('refunds: no #footer left', refunds.includes('href="#footer"'), false);

s.section('saved trainers finally renders its list');

// Found while doing Phase 4: `SavedBoard` was written on 13 Nov and never
// mounted, so Phase 2's page served the demo's empty `<div id="grid">`.
const saved = await get('/saved-trainers');
s.check('saved-trainers served', saved.length > 1000, true);
s.check('the empty demo grid is gone', saved.includes('<div class="grid" id="grid"></div>'), false);
s.check(
  'favourites path in the bundle',
  await inBundle(saved, '/favourites'),
  true,
);

s.done();
