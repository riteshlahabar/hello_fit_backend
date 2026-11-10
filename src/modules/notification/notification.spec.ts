import {
  placeholdersIn,
  render,
  unknownPlaceholders,
} from './render';
import {
  ALL_EVENT_KEYS,
  NOTIFICATION_EVENTS,
  channelsFor,
  eventDefinition,
  isSuppressible,
  pushPriority,
} from './events';
import { nextAttemptDelayMs, shouldRetry } from './retry';
import { DEFAULT_COPY } from './default-copy';

describe('render', () => {
  it('substitutes a placeholder', () => {
    expect(render('Hi {{name}}', { name: 'Asha' }).text).toBe('Hi Asha');
  });

  it('tolerates spaces inside the braces', () => {
    expect(render('Hi {{  name  }}', { name: 'Asha' }).text).toBe('Hi Asha');
  });

  it('substitutes every occurrence', () => {
    expect(render('{{a}}-{{a}}', { a: 'x' }).text).toBe('x-x');
  });

  it('reports a missing variable and renders it empty, not as braces', () => {
    const r = render('Hi {{name}}, your session is {{when}}', { name: 'Asha' });
    expect(r.text).toBe('Hi Asha, your session is ');
    expect(r.missing).toEqual(['when']);
  });

  it('reports a missing variable only once', () => {
    expect(render('{{x}} {{x}}').missing).toEqual(['x']);
  });

  it('treats null as missing, but not empty string or zero', () => {
    expect(render('{{a}}', { a: null }).missing).toEqual(['a']);
    expect(render('{{a}}', { a: '' }).missing).toEqual([]);
    expect(render('{{a}}', { a: 0 }).text).toBe('0');
  });

  it('resolves a dotted path', () => {
    expect(render('{{user.name}}', { user: { name: 'Asha' } }).text).toBe('Asha');
  });

  it('reports a dotted path whose parent is missing', () => {
    expect(render('{{user.name}}', {}).missing).toEqual(['user.name']);
  });

  it('renders a Date as a calendar date, never an ISO instant', () => {
    const text = render('{{d}}', { d: new Date('2026-11-07T18:30:00Z') }).text;
    expect(text).toBe('2026-11-07');
  });

  it('leaves text with no placeholders untouched', () => {
    expect(render('Plain text.').text).toBe('Plain text.');
  });

  it('ignores a single brace pair', () => {
    expect(render('{name}', { name: 'x' }).text).toBe('{name}');
  });
});

describe('placeholdersIn', () => {
  it('lists each placeholder once, in order', () => {
    expect(placeholdersIn('{{b}} {{a}} {{b}}')).toEqual(['b', 'a']);
  });

  it('is empty for plain text', () => {
    expect(placeholdersIn('nothing here')).toEqual([]);
  });
});

describe('unknownPlaceholders', () => {
  it('passes a template using only declared variables', () => {
    expect(unknownPlaceholders('{{a}} {{b}}', ['a', 'b'])).toEqual([]);
  });

  it('catches copy referencing a variable the event never emits', () => {
    expect(unknownPlaceholders('{{a}} {{nope}}', ['a'])).toEqual(['nope']);
  });

  it('allows a dotted path whose root is declared', () => {
    expect(unknownPlaceholders('{{user.name}}', ['user'])).toEqual([]);
  });
});

describe('the spec chapter 9 matrix', () => {
  it('routes at least one audience for every event', () => {
    for (const key of ALL_EVENT_KEYS) {
      const def = NOTIFICATION_EVENTS[key];
      const total =
        (def.customer?.length ?? 0) +
        (def.instructor?.length ?? 0) +
        (def.admin?.length ?? 0);
      expect(total).toBeGreaterThan(0);
    }
  });

  it('declares no duplicate channels for one audience', () => {
    for (const key of ALL_EVENT_KEYS) {
      const def = NOTIFICATION_EVENTS[key];
      for (const set of [def.customer, def.instructor, def.admin]) {
        if (!set) continue;
        expect(new Set(set).size).toBe(set.length);
      }
    }
  });

  it('matches the spec on who hears about a new offer — the teacher only', () => {
    expect(channelsFor('offer.created', 'INSTRUCTOR')).toEqual(['PUSH']);
    expect(channelsFor('offer.created', 'CUSTOMER')).toEqual([]);
    expect(channelsFor('offer.created', 'ADMIN')).toEqual([]);
  });

  it('matches the spec on booking confirmed — push, SMS and the invoice email', () => {
    expect(channelsFor('booking.confirmed', 'CUSTOMER')).toEqual([
      'PUSH',
      'SMS',
      'EMAIL',
    ]);
    expect(channelsFor('booking.confirmed', 'ADMIN')).toEqual(['IN_APP']);
  });

  it('texts only at the 2-hour reminder, per the spec', () => {
    expect(channelsFor('session.reminder_24h', 'CUSTOMER')).not.toContain('SMS');
    expect(channelsFor('session.reminder_2h', 'CUSTOMER')).toContain('SMS');
    expect(channelsFor('session.reminder_30m', 'CUSTOMER')).not.toContain('SMS');
  });

  it('never tells the customer about another teacher being offered the session', () => {
    expect(channelsFor('assignment.cascade_exhausted', 'CUSTOMER')).toEqual([]);
  });

  it('returns no channels for an unknown event rather than throwing', () => {
    expect(channelsFor('nope.not_real', 'CUSTOMER')).toEqual([]);
    expect(eventDefinition('nope.not_real')).toBeUndefined();
  });

  it('reserves high push priority for the time-critical events only', () => {
    const high = ALL_EVENT_KEYS.filter((k) => pushPriority(k) === 'high');
    expect(high.sort()).toEqual([
      'session.check_in_late',
      'session.travel_started',
      'offer.created',
    ].sort());
  });

  it('makes only the campaign event opt-out-able', () => {
    const suppressible = ALL_EVENT_KEYS.filter(isSuppressible);
    expect(suppressible).toEqual(['campaign.broadcast']);
  });

  it('does not let a customer opt out of being told the teacher is at the door', () => {
    expect(isSuppressible('session.checked_in')).toBe(false);
    expect(isSuppressible('session.travel_started')).toBe(false);
  });

  it('declares every placeholder its own templates will need', () => {
    for (const key of ALL_EVENT_KEYS) {
      expect(NOTIFICATION_EVENTS[key].variables.length).toBeGreaterThan(0);
    }
  });

  it('uses domain.event keys throughout', () => {
    for (const key of ALL_EVENT_KEYS) {
      expect(key).toMatch(/^[a-z]+\.[a-z0-9_]+$/);
    }
  });
});

describe('retry schedule', () => {
  it('backs off exponentially', () => {
    const delays = [1, 2, 3, 4].map(nextAttemptDelayMs);
    expect(delays).toEqual([60_000, 300_000, 1_800_000, 7_200_000]);
  });

  it('holds at the last step rather than growing without bound', () => {
    expect(nextAttemptDelayMs(9)).toBe(nextAttemptDelayMs(4));
  });

  it('retries up to the cap and then stops', () => {
    expect(shouldRetry(1)).toBe(true);
    expect(shouldRetry(4)).toBe(true);
    expect(shouldRetry(5)).toBe(false);
  });
});

describe('default copy agrees with the matrix', () => {
  it('has copy for every (event, audience) the matrix routes', () => {
    const gaps: string[] = [];
    for (const key of ALL_EVENT_KEYS) {
      for (const audience of ['CUSTOMER', 'INSTRUCTOR', 'ADMIN'] as const) {
        if (channelsFor(key, audience).length === 0) continue;
        if (!DEFAULT_COPY[key]?.[audience]) gaps.push(`${key}/${audience}`);
      }
    }
    expect(gaps).toEqual([]);
  });

  it('has no copy for an audience the matrix does not route', () => {
    const extras: string[] = [];
    for (const [key, byAudience] of Object.entries(DEFAULT_COPY)) {
      for (const audience of Object.keys(byAudience) as Array<
        'CUSTOMER' | 'INSTRUCTOR' | 'ADMIN'
      >) {
        if (channelsFor(key, audience).length === 0) {
          extras.push(`${key}/${audience}`);
        }
      }
    }
    expect(extras).toEqual([]);
  });

  it('references only variables the event declares', () => {
    const bad: string[] = [];
    for (const [key, byAudience] of Object.entries(DEFAULT_COPY)) {
      const declared = eventDefinition(key)?.variables ?? [];
      for (const [audience, copy] of Object.entries(byAudience)) {
        const text = [copy.title ?? '', copy.body, copy.deepLink ?? ''].join(' ');
        const unknown = unknownPlaceholders(text, declared);
        if (unknown.length > 0) bad.push(`${key}/${audience}: ${unknown.join(', ')}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('renders every default body with no placeholders left behind', () => {
    for (const [key, byAudience] of Object.entries(DEFAULT_COPY)) {
      const declared = eventDefinition(key)?.variables ?? [];
      // Supply a value for every declared variable.
      const data = Object.fromEntries(declared.map((v) => [v, 'X']));
      for (const copy of Object.values(byAudience)) {
        const body = render(copy.body, data);
        expect(body.missing).toEqual([]);
        expect(body.text).not.toContain('{{');
      }
    }
  });

  it('keeps bodies short enough to survive as an SMS', () => {
    const tooLong: string[] = [];
    for (const [key, byAudience] of Object.entries(DEFAULT_COPY)) {
      for (const [audience, copy] of Object.entries(byAudience)) {
        // Rendered length with realistic values, not the template length.
        const declared = eventDefinition(key)?.variables ?? [];
        const data = Object.fromEntries(
          declared.map((v) => [v, 'Lakshmi Narayan']),
        );
        const text = render(copy.body, data).text;
        if (text.length > 320) tooLong.push(`${key}/${audience} (${text.length})`);
      }
    }
    expect(tooLong).toEqual([]);
  });
});
