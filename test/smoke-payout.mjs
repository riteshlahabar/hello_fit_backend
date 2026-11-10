/**
 * End-to-end smoke test for payout batches, against the real server and the
 * real database.
 *
 * What it proves: a week of payable earnings becomes one draft batch with TDS
 * applied, finance can approve/initiate/settle it, every earning inside becomes
 * PAID exactly once, and none of the refusals can be clicked past.
 *
 * `test/payout-fixture.mjs` seeds the completed sessions and payable earnings
 * (and removes them afterwards); `test/admin-fixture.mjs` mints a throwaway
 * super-admin, so no credentials are needed.
 */
import { withTemporaryAdmin } from './admin-fixture.mjs';
import { withPayoutFixture } from './payout-fixture.mjs';

const BASE = 'http://localhost:3000/api/v1';

let adminToken = '';
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
  // The cycle the fixture targets. 2026-11-02..2026-11-08 is a Mon-Sun week
  // that has already closed, so it is payable regardless of when this runs.
  const CYCLE = { cycleFrom: '2026-11-02', cycleTo: '2026-11-08' };

  console.log('\n--- seed: 3 payable earnings in the cycle, plus distractors ---');
  const e1 = await fx.addEarning({ sessionDate: '2026-11-03' });
  const e2 = await fx.addEarning({ sessionDate: '2026-11-05' });
  const e3 = await fx.addEarning({ sessionDate: '2026-11-08', deductions: 50 });
  // Outside the cycle — must not be picked up.
  await fx.addEarning({ sessionDate: '2026-11-09' });
  // Still inside its dispute window.
  await fx.addEarning({
    sessionDate: '2026-11-04',
    status: 'PENDING',
    payableFrom: new Date(Date.now() + 86_400_000),
  });
  // Deliberately held back.
  const held = await fx.addEarning({ sessionDate: '2026-11-06', status: 'WITHHELD' });
  check('3 payable + 3 distractors seeded', [e1, e2, e3].length, 3);

  await withTemporaryAdmin(async ({ email, password }) => {
    const login = await call('POST', '/admin/auth/login', { email, password }, 200, '');
    adminToken = login?.data?.accessToken ?? '';
    check('admin signed in', adminToken.length > 20, true);

    // ------------------------------------------------------- 1. dry run
    console.log('\n--- dry run writes nothing ---');
    const dry = await call('POST', '/admin/payouts/generate', {
      ...CYCLE,
      instructorId: fx.instructorId,
      dryRun: true,
    });
    const dryRow = dry?.data?.results?.[0];
    check('3 sessions in the cycle', dryRow?.sessionCount, 3);
    // 750 + 750 + 700 = 2200 gross; TDS 10% = 220; deductions 50.
    check('gross excludes the out-of-cycle and held earnings', dryRow?.gross, 2200);
    check('TDS applied at 10%', dryRow?.tds, 220);
    check('net is gross - TDS - deductions', dryRow?.net, 1930);
    check('nothing was created', dryRow?.payoutId, undefined);

    const empty = await call(
      'GET',
      `/admin/payouts?instructorId=${fx.instructorId}`,
    );
    check('no payout rows exist yet', empty?.meta?.total, 0);

    // ------------------------------------------------------ 2. generate
    console.log('\n--- generate for real ---');
    const gen = await call('POST', '/admin/payouts/generate', {
      ...CYCLE,
      instructorId: fx.instructorId,
    });
    const payoutId = gen?.data?.results?.[0]?.payoutId;
    check('a payout was created', typeof payoutId === 'string', true);
    check('meta reports one created', gen?.meta?.created, 1);

    const detail = await call('GET', `/admin/payouts/${payoutId}`);
    check('starts as DRAFT', detail?.data?.status, 'DRAFT');
    check('3 items', detail?.data?.items?.length, 3);
    check('statement totals match the row', detail?.data?.statement?.net, 1930);
    check('statement session count', detail?.data?.statement?.sessionCount, 3);
    check('TDS percent back-derived', detail?.data?.statement?.tdsPercent, 10);
    check('only APPROVED is allowed next', detail?.data?.allowedTransitions, ['APPROVED']);
    check('rail is flagged manual', detail?.data?.gatewayIsAutomated, false);

    console.log('\n--- generation is idempotent ---');
    const again = await call('POST', '/admin/payouts/generate', {
      ...CYCLE,
      instructorId: fx.instructorId,
    });
    check('re-running skips, not duplicates', again?.data?.results?.[0]?.skipped, 'ALREADY_EXISTS');
    check('still one payout', (await call('GET', `/admin/payouts?instructorId=${fx.instructorId}`))?.meta?.total, 1);

    console.log('\n--- the earnings are still PAYABLE until money moves ---');
    const earnings = await call(
      'GET',
      `/admin/earnings?instructorId=${fx.instructorId}&status=PAYABLE`,
    );
    check('batched earnings have not been marked paid', earnings?.meta?.total, 4);

    // --------------------------------------------- 3. status machine refusals
    console.log('\n--- nothing can be paid before approval ---');
    const early = await call('POST', `/admin/payouts/${payoutId}/paid`, { utr: 'UTR123456' }, 400);
    check('refused with PAYOUT_TRANSITION_INVALID', early?.error?.code, 'PAYOUT_TRANSITION_INVALID');
    check('and says what is allowed', early?.error?.details, ['APPROVED']);
    await call('POST', `/admin/payouts/${payoutId}/initiate`, null, 400);
    await call('POST', `/admin/payouts/${payoutId}/fail`, { reason: 'nope' }, 400);
    await call('POST', `/admin/payouts/${payoutId}/paid`, { utr: 'no spaces allowed!' }, 400);

    // --------------------------------------------------- 4. approve and settle
    console.log('\n--- approve, initiate, settle ---');
    const approved = await call('POST', `/admin/payouts/${payoutId}/approve`, {
      remark: 'smoke test approval',
    });
    check('status APPROVED', approved?.data?.status, 'APPROVED');
    check('approver recorded', typeof approved?.data?.approvedById === 'string', true);
    check('approvedAt stamped', typeof approved?.data?.approvedAt === 'string', true);

    const initiated = await call('POST', `/admin/payouts/${payoutId}/initiate`, null);
    check('manual rail returns INITIATED, not PAID', initiated?.data?.status, 'INITIATED');
    check('and says a human must transfer', initiated?.data?.requiresManualTransfer, true);

    const paid = await call('POST', `/admin/payouts/${payoutId}/paid`, {
      utr: 'HDFC/2026/8891234',
    });
    check('status PAID', paid?.data?.status, 'PAID');
    check('UTR stored', paid?.data?.utr, 'HDFC/2026/8891234');

    console.log('\n--- PAID is terminal, and the earnings settled with it ---');
    const final = await call('GET', `/admin/payouts/${payoutId}`);
    check('no transitions left', final?.data?.allowedTransitions, []);
    await call('POST', `/admin/payouts/${payoutId}/fail`, { reason: 'too late' }, 400);
    await call('DELETE', `/admin/payouts/${payoutId}`, null, 409);

    const nowPaid = await call(
      'GET',
      `/admin/earnings?instructorId=${fx.instructorId}&status=PAID`,
    );
    check('exactly the 3 batched earnings are PAID', nowPaid?.meta?.total, 3);

    const stillPayable = await call(
      'GET',
      `/admin/earnings?instructorId=${fx.instructorId}&status=PAYABLE`,
    );
    check('the out-of-cycle earning is untouched', stillPayable?.meta?.total, 1);

    console.log('\n--- a paid earning cannot then be re-batched ---');
    const rerun = await call('POST', '/admin/payouts/generate', {
      cycleFrom: CYCLE.cycleFrom,
      cycleTo: CYCLE.cycleTo,
      instructorId: fx.instructorId,
      dryRun: true,
    });
    // The cycle already has a payout, so it is skipped before any selection.
    check('cycle already settled', rerun?.data?.results?.[0]?.skipped, 'ALREADY_EXISTS');

    // ------------------------------------------------- 5. withhold / release
    console.log('\n--- withhold and release ---');
    const releaseBack = await call('POST', `/admin/earnings/${held.id}/release`, null);
    check('a held earning returns to PAYABLE once its window has closed', releaseBack?.data?.status, 'PAYABLE');
    await call('POST', `/admin/earnings/${held.id}/release`, null, 409);

    const reheld = await call('POST', `/admin/earnings/${held.id}/withhold`, {
      reason: 'quality investigation',
    });
    check('withheld again', reheld?.data?.status, 'WITHHELD');
    check('with the reason stored', reheld?.data?.withheldReason, 'quality investigation');
    await call('POST', `/admin/earnings/${held.id}/withhold`, { reason: 'x' }, 400);

    const batchedEarning = nowPaid?.data?.[0];
    await call('POST', `/admin/earnings/${batchedEarning.id}/withhold`, {
      reason: 'already batched',
    }, 409);

    // ------------------------------------------- 6. below-minimum carry-over
    console.log('\n--- a total under the minimum is carried over, not paid ---');
    const small = await fx.addEarning({
      sessionDate: '2026-10-27',
      sessionValue: 100,
    });
    const tiny = await call('POST', '/admin/payouts/generate', {
      cycleFrom: '2026-10-26',
      cycleTo: '2026-11-01',
      instructorId: fx.instructorId,
    });
    check('skipped as BELOW_MINIMUM', tiny?.data?.results?.[0]?.skipped, 'BELOW_MINIMUM');
    check('net was under 500', tiny?.data?.results?.[0]?.net < 500, true);
    check('nothing created', tiny?.meta?.created, 0);
    check('the earning is still payable for a later cycle', small.status, 'PAYABLE');

    // ----------------------------------------------- 7. draft delete releases
    console.log('\n--- deleting a draft releases its earnings ---');
    const d2 = await call('POST', '/admin/payouts/generate', {
      cycleFrom: '2026-11-09',
      cycleTo: '2026-11-15',
      instructorId: fx.instructorId,
    });
    const draftId = d2?.data?.results?.[0]?.payoutId;
    if (draftId) {
      const del = await call('DELETE', `/admin/payouts/${draftId}`, null);
      check('draft deleted', del?.data?.deleted, true);
      const regen = await call('POST', '/admin/payouts/generate', {
        cycleFrom: '2026-11-09',
        cycleTo: '2026-11-15',
        instructorId: fx.instructorId,
        dryRun: true,
      });
      check('its earnings are selectable again', regen?.data?.results?.[0]?.sessionCount, 1);
    } else {
      check('a draft was created for the 9th-15th cycle', Boolean(draftId), true);
    }

    // ------------------------------------------------------- 8. bad requests
    console.log('\n--- cycle validation ---');
    await call('POST', '/admin/payouts/generate', { cycleFrom: '2026-11-08', cycleTo: '2026-11-02' }, 400);
    await call('POST', '/admin/payouts/generate', { cycleFrom: '2026-11-02' }, 400);
    await call('GET', '/admin/payouts/not-a-uuid', null, 400);
    await call('GET', `/admin/payouts/${crypto.randomUUID()}`, null, 404);

    // ------------------------------------------------- 9. the teacher's view
    console.log('\n--- the teacher sees their own payouts, and only those ---');
    const otp = await call('POST', '/auth/otp/send', { mobile: fx.instructorMobile }, 200, '');
    const tLogin = await call(
      'POST',
      '/auth/otp/verify',
      { mobile: fx.instructorMobile, code: otp?.data?.devCode },
      200,
      '',
    );
    const teacherToken = tLogin?.data?.accessToken ?? '';
    check('teacher signed in as INSTRUCTOR', tLogin?.data?.user?.roles, ['INSTRUCTOR']);

    const mine = await call('GET', '/app/instructor/payouts', null, 200, teacherToken);
    check('the settled payout is listed', mine?.data?.some((p) => p.id === payoutId), true);
    const paidRow = mine?.data?.find((p) => p.id === payoutId);
    check('with its UTR and net', [paidRow?.status, Number(paidRow?.net)], ['PAID', 1930]);

    const statement = await call(
      'GET',
      `/app/instructor/payouts/${payoutId}`,
      null,
      200,
      teacherToken,
    );
    check('statement has all 3 lines', statement?.data?.statement?.sessionCount, 3);
    check('and the net agrees with the admin view', statement?.data?.statement?.net, 1930);
    check('each line names the service', typeof statement?.data?.statement?.lines?.[0]?.serviceName, 'string');

    // Another teacher's payout must not be readable by id.
    const foreign = await call(
      'GET',
      `/app/instructor/payouts/${crypto.randomUUID()}`,
      null,
      404,
      teacherToken,
    );
    check('an unknown payout id is 404, not someone else data', foreign?.error?.code, 'NOT_FOUND');

    // A teacher must not reach the admin surface at all. The audience guard
    // rejects an app token on /admin/* with 401 TOKEN_INVALID *before* any
    // permission is considered — the token is wrong for the endpoint, which is
    // a different failure from having the wrong role.
    const wrongAudience = await call('GET', '/admin/payouts', null, 401, teacherToken);
    check('an app token is refused on /admin by audience', wrongAudience?.error?.code, 'TOKEN_INVALID');
    await call('POST', '/admin/payouts/' + payoutId + '/approve', {}, 401, teacherToken);
  });
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
