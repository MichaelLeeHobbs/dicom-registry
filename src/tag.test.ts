import { describe, expect, it } from 'vitest';
import {
    TagFormatError,
    isGroupLength,
    isInTagRange,
    isPrivateTag,
    tag,
    tagElement,
    tagGroup,
    tagRangeBase,
    tagRangeSize,
    tagRangeToString,
    toHex,
    toParenthesized,
    toPrefixed,
    toTag,
    toTagRange,
    tryToTag,
} from './tag';

// The codec is the shared vocabulary every other module speaks, and the whole
// reason three sibling repos cannot currently share data. Round-tripping every
// dialect is therefore the load-bearing property.

const PATIENT_NAME = 0x00100010;

describe('toTag — every dialect resolves to the same number', () => {
    it.each([
        ['numeric', PATIENT_NAME],
        ['prefixed lower', 'x00100010'],
        ['prefixed upper', 'X00100010'],
        ['bare hex', '00100010'],
        ['bare hex uppercase', '00100010'.toUpperCase()],
        ['parenthesized', '(0010,0010)'],
        ['parenthesized lowercase', '(0010,0010)'.toLowerCase()],
    ])('parses %s', (_label, value) => {
        expect(toTag(value)).toBe(PATIENT_NAME);
    });

    it('handles the top of the tag space without precision loss', () => {
        // 0xFFFEE0DD (sequence delimiter) exceeds the signed 32-bit range, so a
        // bitwise implementation would return a negative number here.
        expect(toTag('(FFFE,E0DD)')).toBe(0xfffee0dd);
        expect(toTag('fffee0dd')).toBe(0xfffee0dd);
        expect(toHex(0xfffee0dd)).toBe('FFFEE0DD');
    });

    it.each([
        ['empty', ''],
        ['too short', '0010001'],
        ['too long', '001000100'],
        ['non-hex', '0010zzzz'],
        ['half parenthesized', '(0010,0010'],
        ['comma-less', '(00100010)'],
        ['negative', -1],
        ['fractional', 1.5],
        ['beyond 32 bits', 0x1_0000_0000],
    ])('rejects %s', (_label, value) => {
        expect(() => toTag(value as never)).toThrow(TagFormatError);
    });

    it('carries the offending value on the error rather than throwing a string', () => {
        try {
            toTag('nope');
            expect.unreachable('should have thrown');
        } catch (thrown) {
            expect(thrown).toBeInstanceOf(TagFormatError);
            expect((thrown as TagFormatError).value).toBe('nope');
            expect((thrown as TagFormatError).message).toContain("'nope'");
        }
    });

    it('tryToTag returns undefined instead of throwing', () => {
        expect(tryToTag('(0010,0010)')).toBe(PATIENT_NAME);
        expect(tryToTag('nope')).toBeUndefined();
    });
});

describe('rendering', () => {
    it('renders each dialect', () => {
        expect(toHex(PATIENT_NAME)).toBe('00100010');
        expect(toPrefixed(PATIENT_NAME)).toBe('x00100010');
        expect(toParenthesized(PATIENT_NAME)).toBe('(0010,0010)');
    });

    it('round-trips through every dialect', () => {
        const samples = [0x00000000, 0x00080018, PATIENT_NAME, 0x7fe00010, 0xfffee0dd, 0xffffffff];
        for (const value of samples) {
            expect(toTag(toHex(value))).toBe(value);
            expect(toTag(toPrefixed(value))).toBe(value);
            expect(toTag(toParenthesized(value))).toBe(value);
        }
    });

    it('pads short groups and elements', () => {
        expect(toParenthesized(tag(0x0002, 0x0001))).toBe('(0002,0001)');
        expect(toHex(tag(0x0002, 0x0001))).toBe('00020001');
    });
});

describe('group / element accessors', () => {
    it('splits a tag', () => {
        expect(tagGroup(PATIENT_NAME)).toBe(0x0010);
        expect(tagElement(PATIENT_NAME)).toBe(0x0010);
        expect(tagGroup('(7FE0,0010)')).toBe(0x7fe0);
        expect(tagElement('(7FE0,0010)')).toBe(0x0010);
    });

    it('builds a tag and rejects out-of-range halves', () => {
        expect(tag(0x0010, 0x0010)).toBe(PATIENT_NAME);
        expect(() => tag(0x10000, 0)).toThrow(TagFormatError);
        expect(() => tag(0, -1)).toThrow(TagFormatError);
        expect(() => tag(1.5, 0)).toThrow(TagFormatError);
    });

    it('identifies private tags by odd group', () => {
        expect(isPrivateTag('(0009,0010)')).toBe(true);
        expect(isPrivateTag('(0008,0018)')).toBe(false);
    });

    it('identifies group-length elements', () => {
        expect(isGroupLength('(0008,0000)')).toBe(true);
        expect(isGroupLength('(0008,0018)')).toBe(false);
    });
});

describe('tag ranges — the full dicom.dic grammar', () => {
    const range = (text: string): NonNullable<ReturnType<typeof toTagRange>> => {
        const parsed = toTagRange(text);
        expect(parsed, `should parse: ${text}`).toBeDefined();
        return parsed as NonNullable<typeof parsed>;
    };

    it('parses a bare group range as EVEN only (the dictionary default)', () => {
        expect(range('(6000-60FF,0010)')).toEqual({
            groupLo: 0x6000,
            groupHi: 0x60ff,
            groupParity: 'even',
            elementLo: 0x0010,
            elementHi: 0x0010,
            elementParity: 'any',
        });
    });

    it('parses the -o- (odd) and -u- (any) parity infixes', () => {
        expect(range('(0009-o-FFFF,0000)').groupParity).toBe('odd');
        expect(range('(0000-u-FFFF,0000)').groupParity).toBe('any');
    });

    it('parses element ranges', () => {
        expect(range('(0020,3100-31FF)')).toEqual({
            groupLo: 0x0020,
            groupHi: 0x0020,
            groupParity: 'any',
            elementLo: 0x3100,
            elementHi: 0x31ff,
            elementParity: 'even',
        });
    });

    it('parses a mixed-parity range on both halves', () => {
        expect(range('(0009-o-FFFF,0010-u-00FF)')).toEqual({
            groupLo: 0x0009,
            groupHi: 0xffff,
            groupParity: 'odd',
            elementLo: 0x0010,
            elementHi: 0x00ff,
            elementParity: 'any',
        });
    });

    it('treats a concrete tag as a degenerate range', () => {
        expect(range('(0010,0010)')).toEqual({
            groupLo: 0x0010,
            groupHi: 0x0010,
            groupParity: 'any',
            elementLo: 0x0010,
            elementHi: 0x0010,
            elementParity: 'any',
        });
    });

    it.each(['60000010', '(6000-60FF)', '(60FF-6000,0010)', '(0020,31FF-3100)', '(600G-60FF,0010)', ''])('rejects %s', text => {
        expect(toTagRange(text)).toBeUndefined();
    });

    it('honours group parity — the @ubercode/dcmtk#47 defect', () => {
        const overlays = range('(6000-60FF,0010)');
        expect(isInTagRange('(6000,0010)', overlays)).toBe(true);
        expect(isInTagRange('(6002,0010)', overlays)).toBe(true);
        expect(isInTagRange('(60FE,0010)', overlays)).toBe(true);
        // an odd group inside the overlay range is a PRIVATE tag
        expect(isInTagRange('(6001,0010)', overlays)).toBe(false);
        expect(isInTagRange('(6100,0010)', overlays)).toBe(false);
        expect(isInTagRange('(5FFE,0010)', overlays)).toBe(false);
        expect(isInTagRange('(6000,0011)', overlays)).toBe(false);
    });

    it('honours odd-only and unrestricted parity', () => {
        const privateGroups = range('(0009-o-FFFF,0000)');
        expect(isInTagRange('(0009,0000)', privateGroups)).toBe(true);
        expect(isInTagRange('(0011,0000)', privateGroups)).toBe(true);
        expect(isInTagRange('(0010,0000)', privateGroups)).toBe(false); // even: standard group
        const anyGroup = range('(0000-u-FFFF,0000)');
        expect(isInTagRange('(0008,0000)', anyGroup)).toBe(true);
        expect(isInTagRange('(0009,0000)', anyGroup)).toBe(true);
        expect(isInTagRange('(0008,0001)', anyGroup)).toBe(false);
    });

    it('honours element parity and bounds', () => {
        const sourceImageIds = range('(0020,3100-31FF)');
        expect(isInTagRange('(0020,3100)', sourceImageIds)).toBe(true);
        expect(isInTagRange('(0020,31FE)', sourceImageIds)).toBe(true);
        expect(isInTagRange('(0020,3101)', sourceImageIds)).toBe(false); // odd element
        expect(isInTagRange('(0020,30FF)', sourceImageIds)).toBe(false);
        expect(isInTagRange('(0021,3100)', sourceImageIds)).toBe(false);
    });

    it.each(['(6000-60FF,0010)', '(0009-o-FFFF,0000)', '(0000-u-FFFF,0000)', '(0020,3100-31FF)', '(0009-o-FFFF,0010-u-00FF)', '(0010,0010)'])(
        'round-trips %s through its text form',
        text => {
            expect(tagRangeToString(range(text))).toBe(text);
        }
    );

    it('reports the lowest covered tag as the range identity', () => {
        // the lower bound, not DCMTK's 60FF representative: 6000 is a group that
        // actually occurs in files, and it sorts correctly among its neighbours
        expect(tagRangeBase(range('(6000-60FF,0010)'))).toBe(0x60000010);
        expect(tagRangeBase(range('(0020,3100-31FF)'))).toBe(0x00203100);
        // parity is respected when the bound itself does not match
        expect(tagRangeBase(range('(0008-o-FFFF,0000)'))).toBe(0x00090000);
    });

    it('sizes ranges so the narrowest wins when they overlap', () => {
        const overlays = range('(6000-60FF,0010)');
        const generic = range('(0000-u-FFFF,0000)');
        expect(tagRangeSize(overlays)).toBe(128); // 256 groups, even only, one element
        expect(tagRangeSize(generic)).toBe(65536);
        expect(tagRangeSize(overlays)).toBeLessThan(tagRangeSize(generic));
        expect(tagRangeSize(range('(0010,0010)'))).toBe(1);
    });
});
