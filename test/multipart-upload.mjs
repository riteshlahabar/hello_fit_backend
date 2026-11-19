/**
 * The one request shape `smoke-harness.mjs` cannot make.
 *
 * The harness `call` sends JSON, which is every route on the API bar one: a
 * document upload is `multipart/form-data`. Two suites need it now
 * (`smoke-trainer-documents`, `smoke-trainer-registration`), so it lives here
 * rather than being copied into both — the harness exists precisely because
 * that copying is how the old suites grew to 500 lines.
 *
 * Not folded into the harness itself: it would push that file past the
 * 200-line rule, and a suite that never touches a file should not pay for it.
 */
import { BASE } from './smoke-harness.mjs';

/** A 1x1 PNG — the smallest thing that is genuinely an image. */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Posts a real multipart body, the way Dio does from the app: the bytes as
 * `file`, every other value as a plain form field (so a number or a date
 * arrives as a string and the global ValidationPipe has to transform it —
 * which is exactly what the app does and what a JSON test would miss).
 *
 * Returns the status and the parsed body rather than asserting, so the caller
 * counts the pass through `s.check` and the tally stays the harness's.
 */
export async function uploadTo(
  path,
  token,
  fields = {},
  { filename = 'photo.png', body = PNG, type = 'image/png' } = {},
) {
  const form = new FormData();
  if (body !== null) {
    form.append('file', new Blob([body], { type }), filename);
  }
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) form.append(key, String(value));
  }

  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });

  return { status: res.status, json: await res.json().catch(() => null) };
}
