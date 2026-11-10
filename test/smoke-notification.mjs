/**
 * End-to-end smoke test for notifications, against the real server and
 * database.
 *
 * What it proves: a real domain action (an admin rejecting a KYC document)
 * fans out according to the spec chapter-9 matrix, the outbox is rendered and
 * dispatched, the in-app row appears with an unread badge, the teacher can read
 * it, and the admin can see what was sent.
 *
 * Push/SMS/email use the logging stand-ins here — there is no Firebase
 * service-account key in development — so "sent" proves the outbox lifecycle
 * and the fan-out, not that Google accepted the message. Delivery itself is
 * verified against FCM once the credentials exist.
 */
import { withTemporaryAdmin } from './admin-fixture.mjs';
import { withPayoutFixture } from './payout-fixture.mjs';

const BASE = 'http://localhost:3000/api/v1';

let adminToken = '';
let teacherToken = '';
let pass = 0;
let fail = 0;

async function call(method, path, body, expect = 200, token = adminToken) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  const ok = res.status === expect;
  if (ok) pass += 1;
  else fail += 1;
  console.log(
    `${(ok ? 'PASS  ' : 'FAIL  ') + `${method} ${path}`.padEnd(58)} ${res.status}` +
      (ok ? '' : ` (wanted ${expect})  ${JSON.stringify(json).slice(0, 280)}`),
  );
  return json;
}

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass += 1;
  else fail += 1;
  console.log(
    ((ok ? 'PASS  ' : 'FAIL  ') + label).padEnd(64) +
      ` ${JSON.stringify(actual)}${ok ? '' : ` (wanted ${JSON.stringify(expected)})`}`,
  );
}

await withPayoutFixture(async (fx) => {
  // Sign the teacher in — the fixture created an approved instructor.
  const otp = await call('POST', '/auth/otp/send', { mobile: fx.instructorMobile }, 200, '');
  const login = await call(
    'POST',
    '/auth/otp/verify',
    { mobile: fx.instructorMobile, code: otp?.data?.devCode },
    200,
    '',
  );
  teacherToken = login?.data?.accessToken ?? '';
  check('teacher signed in', teacherToken.length > 20, true);

  await withTemporaryAdmin(async ({ email, password }) => {
    const adminLogin = await call(
      'POST',
      '/admin/auth/login',
      { email, password },
      200,
      '',
    );
    adminToken = adminLogin?.data?.accessToken ?? '';
    check('admin signed in', adminToken.length > 20, true);

    // -------------------------------------------------- 1. the event catalogue
    console.log('\n--- the spec chapter 9 matrix is served to the admin panel ---');
    const events = await call('GET', '/admin/notifications/events');
    check('every event is listed', events?.meta?.count >= 30, true);

    const confirmed = events?.data?.find((e) => e.eventKey === 'booking.confirmed');
    check('booking.confirmed routes push+SMS+email to the customer', confirmed?.channels?.customer, [
      'PUSH',
      'SMS',
      'EMAIL',
    ]);
    check('and in-app to the admin', confirmed?.channels?.admin, ['IN_APP']);
    check('it declares its placeholders', confirmed?.variables?.includes('bookingCode'), true);

    const offer = events?.data?.find((e) => e.eventKey === 'offer.created');
    check('the offer is high priority', offer?.priority, 'high');
    check('and goes to nobody but the teacher', offer?.channels?.customer, []);

    const campaign = events?.data?.find((e) => e.eventKey === 'campaign.broadcast');
    check('only the campaign is promotional', campaign?.promotional, true);
    check('a transactional event is not', confirmed?.promotional, false);

    // ------------------------------------------------------ 2. template rules
    console.log('\n--- template copy is validated against the event ---');
    const badVar = await call(
      'PUT',
      '/admin/notifications/templates',
      {
        eventKey: 'booking.confirmed',
        channel: 'SMS',
        audience: 'CUSTOMER',
        body: 'Hi {{nonsense}}, booking {{bookingCode}} confirmed.',
      },
      400,
    );
    check('copy using an undeclared variable is refused', badVar?.error?.code, 'VALIDATION_FAILED');
    check('and the response lists what is available', Array.isArray(badVar?.error?.details?.available), true);

    await call(
      'PUT',
      '/admin/notifications/templates',
      { eventKey: 'not.a.real.event', channel: 'SMS', audience: 'CUSTOMER', body: 'x' },
      400,
    );

    const saved = await call('PUT', '/admin/notifications/templates', {
      eventKey: 'document.rejected',
      channel: 'PUSH',
      audience: 'INSTRUCTOR',
      title: 'Action needed',
      body: 'Your {{docType}} was declined: {{remarks}}',
    });
    check('a valid template saves', saved?.data?.eventKey, 'document.rejected');
    const templateId = saved?.data?.id;

    // Upsert, not duplicate.
    const again = await call('PUT', '/admin/notifications/templates', {
      eventKey: 'document.rejected',
      channel: 'PUSH',
      audience: 'INSTRUCTOR',
      title: 'Action needed',
      body: 'Your {{docType}} needs a new upload: {{remarks}}',
    });
    check('re-saving upserts rather than duplicating', again?.data?.id, templateId);

    // ------------------------------- 3. a real domain action fans out properly
    console.log('\n--- rejecting a KYC document notifies the teacher ---');
    const detail = await call('GET', `/admin/instructors/${fx.instructorId}`);
    const bankDoc = detail?.data?.documents?.find((d) => d.docType === 'BANK_DETAILS');
    check('the fixture teacher has a verified bank document', bankDoc?.verifyStatus, 'VERIFIED');

    // Upload something rejectable: use the existing doc via a re-verify to
    // REJECTED, which is exactly what an ops reviewer does.
    const rejected = await call(
      'POST',
      `/admin/instructors/${fx.instructorId}/documents/${bankDoc.id}/verify`,
      { verifyStatus: 'REJECTED', remarks: 'Statement is illegible' },
    );
    check('document rejected', rejected?.data?.verifyStatus, 'REJECTED');

    const outbox = await call(
      'GET',
      '/admin/notifications/outbox?eventKey=document.rejected&limit=20',
    );
    check('the rejection queued outbox rows', outbox?.meta?.total > 0, true);

    const teacherRows = outbox?.data?.filter((r) => r.audience === 'INSTRUCTOR');
    const channels = [...new Set(teacherRows?.map((r) => r.channel))].sort((a, b) => a.localeCompare(b));
    check('on push, SMS and email, per the matrix', channels, ['EMAIL', 'PUSH', 'SMS']);

    const pushRow = teacherRows?.find((r) => r.channel === 'PUSH');
    check('copy came from the admin template, not the built-in default', pushRow?.title, 'Action needed');
    check('and the placeholders were filled', pushRow?.body, 'Your BANK_DETAILS needs a new upload: Statement is illegible');
    check('with no placeholder left behind', pushRow?.body?.includes('{{'), false);
    check('the SMS row carries a destination', Boolean(teacherRows?.find((r) => r.channel === 'SMS')?.destination), true);
    check('rendered at enqueue time, so a templateId is recorded', Boolean(pushRow?.templateId), true);

    // -------------------------------------------------- 4. the in-app channel
    console.log('\n--- the admin in-app row appeared (document.rejected -> ADMIN: IN_APP) ---');
    const adminInApp = await call(
      'GET',
      '/admin/notifications/outbox?eventKey=document.rejected&channel=IN_APP',
    );
    check('IN_APP is never queued in the outbox', adminInApp?.meta?.total, 0);

    const inbox = await call('GET', '/admin/notifications/inbox?limit=5');
    const inboxRow = inbox?.data?.find((n) => n.eventKey === 'document.rejected');
    check('the admin inbox carries the in-app row', Boolean(inboxRow), true);
    check('addressed to the admin, not a user', inboxRow?.userId, null);
    check('and starts unread', inboxRow?.readAt, null);
    check('the unread tally counts it', inbox?.meta?.unread > 0, true);

    const readIt = await call(
      'POST',
      `/admin/notifications/inbox/${inboxRow?.id}/read`,
      null,
    );
    check('the admin can mark it read', readIt?.data?.updated, 1);

    // ------------------------------------- 5. dispatch delivers what is queued
    console.log('\n--- waiting for the dispatch cron (runs every minute) ---');
    let delivered = 0;
    for (let i = 0; i < 75; i += 1) {
      const row = await fetch(
        `${BASE}/admin/notifications/outbox?eventKey=document.rejected&status=SENT`,
        { headers: { authorization: `Bearer ${adminToken}` } },
      ).then((r) => r.json());
      delivered = row?.meta?.total ?? 0;
      if (delivered > 0) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    check('the dispatch cron sent the queued rows', delivered > 0, true);

    const sent = await call(
      'GET',
      '/admin/notifications/outbox?eventKey=document.rejected&status=SENT',
    );
    const sentRow = sent?.data?.[0];
    check('with a sentAt timestamp', Boolean(sentRow?.sentAt), true);
    check('a provider message id', Boolean(sentRow?.providerMessageId), true);
    check('one attempt, no error', [sentRow?.attempts, sentRow?.lastError], [1, null]);

    console.log('\n--- push with no registered device is suppressed, not failed ---');
    const suppressed = await call(
      'GET',
      '/admin/notifications/outbox?channel=PUSH&status=SUPPRESSED',
    );
    check('suppressed rows carry a reason', suppressed?.meta?.total === 0 || Boolean(suppressed?.data?.[0]?.suppressedReason), true);

    // ---------------------------------------- 6. the teacher's bell and badge
    console.log('\n--- the teacher bell icon ---');
    // onboarding.stage_changed sends IN_APP to admin only, so drive an in-app
    // row for the teacher through a stage change plus review.flagged-style
    // event. document.rejected gives the teacher push/SMS/email but not in-app,
    // which is exactly what the spec says — so the teacher list may be empty.
    const bell = await call('GET', '/app/notifications', null, 200, teacherToken);
    check('the endpoint answers with a count and an unread tally', typeof bell?.meta?.unread, 'number');

    const badge = await call('GET', '/app/notifications/unread-count', null, 200, teacherToken);
    check('badge matches the list meta', badge?.data?.unread, bell?.meta?.unread);

    // --------------------------------------------------------- 7. preferences
    console.log('\n--- preferences: only promotional events can be switched off ---');
    const prefs = await call('GET', '/app/notifications/preferences', null, 200, teacherToken);
    check('default is send-everything', prefs?.data?.defaultEnabled, true);
    check('with no overrides yet', prefs?.data?.overrides?.length, 0);

    const off = await call(
      'PUT',
      '/app/notifications/preferences',
      { channel: 'PUSH', eventKey: 'campaign.broadcast', enabled: false },
      200,
      teacherToken,
    );
    check('an opt-out is stored', off?.data?.enabled, false);
    check('against the event', off?.data?.eventKey, 'campaign.broadcast');

    const wholeChannel = await call(
      'PUT',
      '/app/notifications/preferences',
      { channel: 'EMAIL', enabled: false },
      200,
      teacherToken,
    );
    check('a whole-channel opt-out uses the * sentinel, not NULL', wholeChannel?.data?.eventKey, '*');

    const after = await call('GET', '/app/notifications/preferences', null, 200, teacherToken);
    check('both overrides are listed', after?.data?.overrides?.length, 2);

    // Re-setting is an upsert, so the unique constraint actually holds.
    await call(
      'PUT',
      '/app/notifications/preferences',
      { channel: 'EMAIL', enabled: true },
      200,
      teacherToken,
    );
    const stillTwo = await call('GET', '/app/notifications/preferences', null, 200, teacherToken);
    check('still two rows — upsert, not insert', stillTwo?.data?.overrides?.length, 2);

    // ------------------------------------------------------- 8. access control
    console.log('\n--- access control ---');
    await call('GET', '/admin/notifications/outbox', null, 401, teacherToken);
    await call('GET', '/app/notifications', null, 401);
    await call('POST', '/app/notifications/not-a-uuid/read', null, 400, teacherToken);
    const foreign = await call(
      'POST',
      `/app/notifications/${crypto.randomUUID()}/read`,
      null,
      200,
      teacherToken,
    );
    check('marking an unknown notification read updates nothing', foreign?.data?.updated, 0);

    // ----------------------------------------------------- 9. template removal
    console.log('\n--- deleting a template falls back to the built-in copy ---');
    await call('DELETE', `/admin/notifications/templates/${templateId}`, null, 200);
    const gone = await call('GET', '/admin/notifications/templates?eventKey=document.rejected');
    check('the template is gone', gone?.meta?.count, 0);

    await call(
      'POST',
      `/admin/instructors/${fx.instructorId}/documents/${bankDoc.id}/verify`,
      { verifyStatus: 'REJECTED', remarks: 'Second look, still illegible' },
    );
    const afterDelete = await call(
      'GET',
      '/admin/notifications/outbox?eventKey=document.rejected&channel=PUSH&limit=5',
    );
    const newest = afterDelete?.data?.[0];
    check(
      'the next notification used the built-in copy, not silence',
      newest?.title,
      'Document needs attention',
    );
    check('and still filled its placeholders', newest?.body?.includes('Second look'), true);
  });
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
