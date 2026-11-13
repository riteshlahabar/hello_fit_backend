/**
 * The seven website pages wired on 11 Nov, checked through the site's own
 * origin: each is served, each no longer ships the demo's sample content, and
 * each mounts its live component (the server HTML shows that component's
 * loading state, because every one of these pages is token-gated and fetches
 * in the browser).
 *
 * This is the cheap half of the proof. What the components render *after* the
 * fetch is covered by smoke:web-profile, -notifications, -reviews and
 * -checkout, which drive the same endpoints against the real database.
 *
 *   SMOKE_SITE_URL=http://localhost:3001 npm run smoke:web-pages
 */
import { smoke } from './smoke-harness.mjs';

const SITE = process.env.SMOKE_SITE_URL ?? 'http://localhost:3001';
const s = smoke();

/**
 * One page: served, free of every string in `gone`, and showing `mounted`.
 * The demo strings are the assertion that matters — they are what "connected"
 * means on a page whose markup is otherwise unchanged.
 */
async function page(path, { gone, mounted }) {
  const html = await fetch(SITE + path).then((r) => r.text());

  s.check(`${path} served`, html.length > 1000, true);

  for (const text of gone) {
    s.check(`${path} — demo "${text.slice(0, 32)}" gone`, html.includes(text), false);
  }

  if (mounted) s.check(`${path} — live component mounted`, html.includes(mounted), true);
}

s.section('profile and settings');

await page('/profile', {
  gone: ['Aarohi', 'aarohi@example.com', 'Sample email for this prototype', 'Baner, Pune, Maharashtra'],
  mounted: 'Loading your details',
});

s.section('notifications');

await page('/notifications', {
  gone: ['Sneha Patil', 'HF-28419', 'sample notification data', 'Demo customer portal'],
  mounted: 'Loading your notifications',
});

s.section('reviews');

await page('/reviews', {
  gone: ['128 sample reviews', 'illustrative sample content', 'Sam Patel'],
  mounted: 'Loading your reviews',
});

s.section('booking');

// The mounted marker is the **Suspense fallback**, not the wizard's own
// "Loading services". `BookingWizard` reads `?service=` through
// `useSearchParams` so the homepage search can preselect a service, and Next
// refuses to prerender that without a boundary — so the server now serves the
// boundary's copy and the wizard's loading state appears only in the browser.
await page('/booking', {
  gone: ['Personal Yoga Session', 'Mon, 02 Nov 2026', 'Sneha Patil', '₹600'],
  mounted: 'Loading the booking form',
});

s.section('checkout');

await page('/checkout', {
  gone: ['no real payment will be processed', 'Payment not processed in prototype', 'Sneha Patil', '4.9 (120 reviews)'],
  mounted: 'Loading your booking',
});

s.section('booking confirmed');

await page('/booking-confirmed', {
  gone: ['HF-261103-4827', 'demonstration confirmation', 'Paid via UPI · Demo', 'Sample location'],
});

s.section('session details');

await page('/session-details', {
  gone: ['FULL BODY', 'Sneha Patil', 'Session details are sample content', 'Demo prototype'],
});

s.section('the pages that are deliberately still static');

// Billing is the demo's membership page and refunds is a support-request
// form: "membership" has zero hits in the v3 PDF and there is no ticket or
// refund-request table. Asserted so a later session does not assume they were
// missed — they are waiting on the client.
for (const path of ['/billing', '/refunds']) {
  const html = await fetch(SITE + path).then((r) => r.text());
  s.check(`${path} still served`, html.length > 1000, true);
}

s.done();
