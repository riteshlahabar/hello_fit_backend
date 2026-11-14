/**
 * Billing History and Refunds — Phase 4, 13 Nov 2026.
 *
 * The assertion that matters is **the isolation one**. Both lists filter
 * through `booking.customerId`, and an invoice carries a name, a GST number
 * and an amount — so a missing filter here is not a cosmetic bug, it is one
 * customer reading another's tax document. The second customer at the end
 * exists only to prove that.
 *
 * The second-most-valuable assertions are the `typeof === 'number'` ones.
 * Prisma returns `Decimal` for money, which serialises as
 * `{"s":1,"e":2,"d":[499]}` and renders as `[object Object]` — a bug that
 * type-checks, passes a build, and only shows up on the page.
 *
 *   npm run smoke:billing
 */
import { smoke } from './smoke-harness.mjs';

const s = smoke();
const stamp = String(Date.now()).slice(-6);
const BREAKUP = { cgst: 22.5, sgst: 22.5 };

s.section('a customer with no money history');

const { mobile } = await s.loginCustomer();

const noInvoices = await s.call('GET', '/app/customer/invoices', undefined, 200, 'customer');
s.check('200 with an array', Array.isArray(noInvoices?.data), true);
s.check('empty flagged', noInvoices?.meta?.empty, true);
s.check('and a message supplied', typeof noInvoices?.message, 'string');
s.check('page 1 by default', noInvoices?.meta?.page, 1);

const noRefunds = await s.call('GET', '/app/customer/refunds', undefined, 200, 'customer');
s.check('refunds: array too', Array.isArray(noRefunds?.data), true);
s.check('refunds: empty flagged', noRefunds?.meta?.empty, true);

s.section('fixtures: a paid booking, its invoice, and a refund against it');

const made = await s.cleanup(async (db) => {
  const user = await db.user.findFirst({ where: { mobile }, select: { id: true } });
  const profile = await db.customerProfile.findFirst({ where: { userId: user.id }, select: { id: true } });
  const service = await db.service.findFirst({ where: { isActive: true, deletedAt: null } });

  const address = await db.address.create({
    data: { customerId: profile.id, label: 'Home', line1: 'Billing Lane', pincode: '411045', isDefault: true },
  });

  // sessionCount 3 on purpose: it is what makes `description` plural.
  const booking = await db.booking.create({
    data: {
      code: `HF-BILL-${stamp}`,
      customerId: profile.id,
      serviceId: service.id,
      addressId: address.id,
      type: 'PACKAGE',
      sessionCount: 3,
      grossAmount: 1500,
      tax: 45,
      payable: 1545,
      paymentStatus: 'PAID',
    },
  });

  const invoice = await db.invoice.create({
    data: {
      bookingId: booking.id,
      invoiceNo: `HF-INV-${stamp}`,
      taxableValue: 1500,
      taxBreakup: BREAKUP,
      total: 1545,
      pdfUrl: 'https://example.test/invoice.pdf',
    },
  });

  const refund = await db.refund.create({
    data: {
      bookingId: booking.id,
      amount: 500,
      slabApplied: 'MORE_THAN_24H',
      mode: 'WALLET',
      status: 'COMPLETED',
      processedAt: new Date(),
    },
  });

  return {
    profileId: profile.id,
    bookingId: booking.id,
    addressId: address.id,
    invoiceId: invoice.id,
    refundId: refund.id,
    serviceName: service.name,
  };
});

s.section('the Billing History row');

const invoices = await s.call('GET', '/app/customer/invoices', undefined, 200, 'customer');
s.check('one invoice', invoices?.data?.length, 1);
s.check('not flagged empty', invoices?.meta?.empty, false);
s.check('total counted', invoices?.meta?.total, 1);

const row = invoices?.data?.[0];
s.check('invoice number', row?.invoiceNo, `HF-INV-${stamp}`);
s.check('booking code quoted', row?.bookingCode, `HF-BILL-${stamp}`);
s.check('total is a number, not a Decimal', typeof row?.total, 'number');
s.check('and the right number', row?.total, 1545);
s.check('taxable value is a number', typeof row?.taxableValue, 'number');
s.check('GST breakup passed through whole', row?.taxBreakup, BREAKUP);
s.check('receipt link carried', typeof row?.pdfUrl, 'string');
s.check('issued date present', typeof row?.issuedAt, 'string');

// The demo's "Plus Plan · Monthly" has nothing behind it: an invoice in this
// API is always against a booking, so the description is the service.
s.check('description names the service', row?.description?.startsWith(made.serviceName), true);
s.check('and pluralises the package', row?.description?.includes('3 sessions'), true);

s.section('the Refunds card');

const refunds = await s.call('GET', '/app/customer/refunds', undefined, 200, 'customer');
s.check('one refund', refunds?.data?.length, 1);

const refund = refunds?.data?.[0];
s.check('amount is a number', typeof refund?.amount, 'number');
s.check('and the right number', refund?.amount, 500);
s.check('status carried', refund?.status, 'COMPLETED');
s.check('mode carried', refund?.mode, 'WALLET');
s.check('the slab says why this amount', refund?.slabApplied, 'MORE_THAN_24H');
s.check('booking code quoted', refund?.bookingCode, `HF-BILL-${stamp}`);
s.check('service named', refund?.service, made.serviceName);
s.check('requested timestamp', typeof refund?.requestedAt, 'string');
s.check('processed timestamp', typeof refund?.processedAt, 'string');

s.section('paging');

const page2 = await s.call('GET', '/app/customer/invoices?page=2', undefined, 200, 'customer');
s.check('page 2 is empty, not an error', page2?.data?.length, 0);
s.check('page echoed', page2?.meta?.page, 2);
s.check('pages computed', page2?.meta?.pages, 1);
s.check('page size stated', page2?.meta?.pageSize, 20);

await s.call('GET', '/app/customer/invoices?page=0', undefined, 400, 'customer');
await s.call('GET', '/app/customer/invoices?page=abc', undefined, 400, 'customer');
await s.call('GET', '/app/customer/refunds?page=0', undefined, 400, 'customer');

s.section('another customer sees none of it');

// Re-logging in replaces the customer bearer, which is the whole point: the
// next two calls are the same routes as a different person.
await s.loginCustomer();

const otherInvoices = await s.call('GET', '/app/customer/invoices', undefined, 200, 'customer');
s.check('no leaked invoices', otherInvoices?.data?.length, 0);

const otherRefunds = await s.call('GET', '/app/customer/refunds', undefined, 200, 'customer');
s.check('no leaked refunds', otherRefunds?.data?.length, 0);

s.section('what must not be reachable');

await s.noToken('GET', '/app/customer/invoices');
await s.noToken('GET', '/app/customer/refunds');

// Read-only by design: invoices are raised by InvoiceService when a payment
// settles and refunds by RefundService on cancellation. A customer-facing
// create would be a second, competing source of money records.
await s.call('POST', '/app/customer/invoices', {}, 404, 'customer');
await s.call('POST', '/app/customer/refunds', {}, 404, 'customer');

s.section('cleanup');

await s.cleanup(async (db) => {
  await db.refund.delete({ where: { id: made.refundId } });
  await db.invoice.delete({ where: { id: made.invoiceId } });
  await db.booking.delete({ where: { id: made.bookingId } });
  await db.address.delete({ where: { id: made.addressId } });
});

s.done();
