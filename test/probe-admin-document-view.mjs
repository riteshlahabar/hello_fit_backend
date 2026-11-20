/**
 * Probe for the admin panel's "View" button on a trainer's document.
 *
 * Walks the exact two calls the button makes — `GET /admin/instructors/:id`
 * for the document list, then `GET …/documents/:documentId/url` for the signed
 * link — and then fetches the link, which is the step a browser does and no
 * test covered.
 */
import { smoke } from './smoke-harness.mjs';

const s = smoke();

await s.withAdmin(async () => {
  const list = await s.call('GET', '/admin/instructors?page=1&limit=50');
  const rows = list?.data ?? [];
  s.check('instructors list answers', Array.isArray(rows), true);

  let checked = 0;

  for (const row of rows) {
    const detail = await s.call('GET', `/admin/instructors/${row.id}`);
    const docs = detail?.data?.documents ?? [];
    if (docs.length === 0) continue;

    for (const doc of docs) {
      const minted = await s.call(
        'GET',
        `/admin/instructors/${row.id}/documents/${doc.id}/url`,
      );
      const url = minted?.data?.url;
      s.check(`url minted for ${doc.docType}`, typeof url === 'string', true);
      if (!url) continue;

      const res = await fetch(url);
      const bytes = (await res.arrayBuffer()).byteLength;
      s.check(
        `fetch ${doc.docType} ${res.status} ${res.headers.get('content-type')} ${bytes}b`,
        res.status,
        200,
      );
      checked += 1;
    }

    if (checked >= 6) break;
  }

  s.check('at least one document was fetched', checked > 0, true);
});

await s.noToken('GET', '/admin/instructors');
s.done();
