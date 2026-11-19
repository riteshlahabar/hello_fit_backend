import {
  ddMmYyyyToIsoDate,
  formatDate,
  formatDateOrNull,
  formatDateTime,
  parseDdMmYyyy,
} from './format';

/**
 * Hard rule 4 (client, 19-11-2026). The read side is cosmetic; the write side
 * is not — `ddMmYyyyToIsoDate` sits in front of `@IsISO8601` on every DTO that
 * takes a date, so a bug here is a 400 on a perfectly good request.
 */
describe('formatting out', () => {
  it('writes dd-mm-yyyy, padded', () => {
    expect(formatDate(new Date(Date.UTC(1994, 2, 8)))).toBe('08-03-1994');
  });

  it('reads in UTC, so a calendar day never shifts back a day', () => {
    expect(formatDate(new Date(Date.UTC(2026, 10, 19)))).toBe('19-11-2026');
  });

  it('adds the clock for a timestamp', () => {
    expect(formatDateTime(new Date(Date.UTC(2026, 10, 19, 9, 5, 2)))).toBe(
      '19-11-2026 09:05:02',
    );
  });

  it('is null-safe', () => {
    expect(formatDateOrNull(null)).toBeNull();
    expect(formatDateOrNull(undefined)).toBeNull();
  });
});

describe('parsing in', () => {
  it('reads dd-mm-yyyy back', () => {
    expect(parseDdMmYyyy('18-03-1994')).toEqual(new Date(Date.UTC(1994, 2, 18)));
  });

  it('refuses an impossible day instead of rolling it into March', () => {
    expect(parseDdMmYyyy('31-02-1991')).toBeNull();
  });
});

describe('ddMmYyyyToIsoDate', () => {
  it('normalises the new format for @IsISO8601', () => {
    expect(ddMmYyyyToIsoDate('18-03-1994')).toBe('1994-03-18');
  });

  it('passes ISO straight through, because the surfaces ship separately', () => {
    expect(ddMmYyyyToIsoDate('1994-03-18')).toBe('1994-03-18');
  });

  it('leaves rubbish alone so the validator reports it, not this', () => {
    expect(ddMmYyyyToIsoDate('31-02-1991')).toBe('31-02-1991');
    expect(ddMmYyyyToIsoDate('not a date')).toBe('not a date');
  });

  it('leaves a non-string alone', () => {
    expect(ddMmYyyyToIsoDate(undefined)).toBeUndefined();
    expect(ddMmYyyyToIsoDate(42)).toBe(42);
  });
});
