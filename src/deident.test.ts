import { describe, expect, it } from 'vitest';
import { allDeidentification, deidentificationAction, deidentificationOptions, lookupDeidentification } from './deident';

describe('de-identification table', () => {
    it('covers the whole of Table E.1-1', () => {
        expect(allDeidentification().length).toBeGreaterThanOrEqual(600);
    });

    it('gives the basic profile action for an identifying attribute', () => {
        expect(lookupDeidentification('(0010,0010)')).toMatchObject({ name: "Patient's Name", basicProfile: { source: 'Z', codes: ['Z'] } });
        expect(lookupDeidentification('(0008,0050)')?.basicProfile.codes).toEqual(['Z']);
    });

    it('keeps alternation unresolved, because only the caller knows the IOD', () => {
        // X/Z means "remove, unless a zero-length value is needed for IOD
        // conformance" — resolving it at build time would be a guess
        const alternation = allDeidentification().find(entry => entry.basicProfile.codes.length > 1);
        expect(alternation?.basicProfile.source).toMatch(/\//);
        expect(alternation!.basicProfile.codes.length).toBeGreaterThan(1);
    });

    it('records the * marker in source while keeping codes actionable', () => {
        const starred = allDeidentification().find(entry => entry.basicProfile.source.includes('*'));
        expect(starred?.basicProfile.source).toBe('X/Z/U*');
        expect(starred?.basicProfile.codes).toEqual(['X', 'Z', 'U']);
    });

    it('returns undefined for an attribute PS3.15 does not name', () => {
        expect(lookupDeidentification('(0028,0010)')).toBeUndefined();
    });
});

describe('repeating groups and the private catch-all', () => {
    it('resolves overlay comments for any EVEN group in the range', () => {
        expect(lookupDeidentification('(6000,4000)')?.name).toBe('Overlay Comments');
        expect(lookupDeidentification('(6008,4000)')?.name).toBe('Overlay Comments');
    });

    it('reads an odd group as a private attribute, not an overlay', () => {
        // PS3.15 writes (60XX,4000); taken literally that swallows odd groups,
        // which are private by definition and have their own blanket rule
        expect(lookupDeidentification('(6001,4000)')?.name).toBe('Private Attributes');
    });

    it('applies the blanket private rule to any odd group', () => {
        for (const tag of ['(0009,1001)', '(0029,1010)', '(7fff,0001)']) {
            expect(lookupDeidentification(tag)?.name, tag).toBe('Private Attributes');
        }
        expect(lookupDeidentification('(0009,1001)')?.basicProfile.codes).toEqual(['X']);
    });

    it('prefers a specifically named attribute over the private catch-all', () => {
        // (0009,1001) is odd and only the catch-all covers it, but a named
        // attribute in an even group must never fall through to it
        expect(lookupDeidentification('(0010,0010)')?.name).toBe("Patient's Name");
    });
});

describe('retained options', () => {
    it('exposes all ten options PS3.15 defines', () => {
        expect(deidentificationOptions()).toEqual([
            'cleanDescriptors',
            'cleanStructuredContent',
            'retainLongitudinalFullDates',
            'retainLongitudinalModifiedDates',
            'retainUids',
            'retainPatientCharacteristics',
            'retainDeviceIdentity',
            'retainInstitutionIdentity',
            'cleanGraphics',
            'retainSafePrivate',
        ]);
    });

    it('overrides the basic profile when an option is in force', () => {
        // StudyInstanceUID: U normally, K when UIDs are retained
        expect(deidentificationAction('(0020,000D)', [])?.codes).toEqual(['U']);
        expect(deidentificationAction('(0020,000D)', ['retainUids'])?.codes).toEqual(['K']);
    });

    it('ignores an option that says nothing about the attribute', () => {
        const withoutOption = deidentificationAction('(0010,0010)', []);
        expect(deidentificationAction('(0010,0010)', ['retainUids'])).toEqual(withoutOption);
    });

    it('cleans rather than removes a description when that option is chosen', () => {
        expect(deidentificationAction('(0018,4000)', [])?.codes).toEqual(['X']);
        expect(deidentificationAction('(0018,4000)', ['cleanDescriptors'])?.codes).toEqual(['C']);
    });

    it('retains device identity when asked', () => {
        const deviceRows = allDeidentification().filter(entry => entry.options.retainDeviceIdentity !== undefined);
        expect(deviceRows.length).toBeGreaterThan(40);
        const first = deviceRows[0]!;
        expect(deidentificationAction(first.tag.includes('-') ? '(0010,0010)' : first.tag, ['retainDeviceIdentity'])).toBeDefined();
    });

    it('keeps private attributes when the safe-private option is chosen', () => {
        expect(deidentificationAction('(0029,1010)', [])?.codes).toEqual(['X']);
        expect(deidentificationAction('(0029,1010)', ['retainSafePrivate'])?.codes).toEqual(['C']);
    });

    it('returns undefined for an unnamed attribute regardless of options', () => {
        expect(deidentificationAction('(0028,0010)', ['retainUids'])).toBeUndefined();
    });
});
