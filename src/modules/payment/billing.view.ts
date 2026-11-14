import type {
  Booking,
  Invoice,
  Refund,
  Service,
} from '../../generated/prisma/client';

type InvoiceRow = Invoice & {
  booking: Pick<Booking, 'id' | 'code' | 'sessionCount' | 'type'> & {
    service: Pick<Service, 'name'> | null;
  };
};

type RefundRow = Refund & {
  booking: Pick<Booking, 'id' | 'code'> & {
    service: Pick<Service, 'name'> | null;
  };
};

/**
 * Money leaves as a **number**, never a Prisma `Decimal`.
 *
 * A Decimal serialises through the envelope as `{"s":1,"e":2,"d":[499]}` and
 * the page renders `[object Object]`. Same conversion as `plan.view.ts`.
 */
const rupees = (value: Invoice['total']) => Number(value);

/**
 * The GST lines, as the invoice stored them.
 *
 * `taxBreakup` is JSON because the CGST/SGST/IGST split varies by state, so it
 * is passed through untouched rather than flattened into fixed fields — a
 * flattening here would quietly drop IGST on an inter-state invoice.
 */
const breakup = (value: Invoice['taxBreakup']) =>
  (value ?? null) as Record<string, number> | null;

/**
 * One row of the Billing History table.
 *
 * `description` is **derived from the booking**, not stored: every invoice in
 * this API is raised against a booking (service + session count), because
 * there is no recurring plan charge to invoice. The demo's "Plus Plan ·
 * Monthly" wording has nothing behind it.
 */
export function toInvoiceRow(invoice: InvoiceRow) {
  const service = invoice.booking.service?.name ?? 'Session';
  const sessions = invoice.booking.sessionCount;

  return {
    id: invoice.id,
    invoiceNo: invoice.invoiceNo,
    issuedAt: invoice.issuedAt,
    description:
      sessions > 1 ? `${service} · ${sessions} sessions` : service,
    bookingId: invoice.booking.id,
    bookingCode: invoice.booking.code,
    taxableValue: rupees(invoice.taxableValue),
    taxBreakup: breakup(invoice.taxBreakup),
    total: rupees(invoice.total),
    pdfUrl: invoice.pdfUrl,
  };
}

/**
 * One card in "Your recent requests".
 *
 * `slabApplied` is carried through because it is the only honest answer to
 * "why this amount" — the refund policy slab that produced it (PDF 3.5).
 */
export function toRefundRow(refund: RefundRow) {
  return {
    id: refund.id,
    bookingId: refund.booking.id,
    bookingCode: refund.booking.code,
    service: refund.booking.service?.name ?? null,
    amount: rupees(refund.amount),
    mode: refund.mode,
    status: refund.status,
    slabApplied: refund.slabApplied,
    requestedAt: refund.createdAt,
    processedAt: refund.processedAt,
  };
}
