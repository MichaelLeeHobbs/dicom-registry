import { describe, expect, it } from 'vitest';
import { allVrs, hasExtendedLength, isVr, lookupVr, resolveVr } from './vr';

describe('VR table', () => {
    it('defines every VR in PS3.5, including the 2019 additions', () => {
        expect(allVrs()).toHaveLength(34);
        for (const vr of ['SV', 'UV', 'OV']) {
            expect(lookupVr(vr), `${vr} should be defined`).toBeDefined();
        }
    });

    it('reports the extended-length VRs and only those', () => {
        const extended = allVrs()
            .filter(entry => entry.lengthBytes === 4)
            .map(entry => entry.vr);
        // PS3.5 §7.1.2 — getting this set wrong desynchronizes an explicit-VR
        // parser for the remainder of the data set
        expect(extended).toEqual(['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'SV', 'UC', 'UN', 'UR', 'UT', 'UV']);
        expect(hasExtendedLength('OB')).toBe(true);
        expect(hasExtendedLength('US')).toBe(false);
        expect(hasExtendedLength('ZZ')).toBe(false);
    });

    it('reports which VRs SpecificCharacterSet affects', () => {
        const charset = allVrs()
            .filter(entry => entry.charsetAffected)
            .map(entry => entry.vr);
        expect(charset).toEqual(['LO', 'LT', 'PN', 'SH', 'ST', 'UC', 'UT']);
    });

    it('reports padding, which differs for UI and OB', () => {
        expect(lookupVr('UI')?.padding).toBe('null');
        expect(lookupVr('OB')?.padding).toBe('null');
        expect(lookupVr('CS')?.padding).toBe('space');
        expect(lookupVr('US')?.padding).toBe('none');
    });

    it('marks the text VRs that cannot be multi-valued', () => {
        for (const vr of ['LT', 'ST', 'UT', 'UR', 'SQ', 'OB', 'OW', 'UN']) {
            expect(lookupVr(vr)?.multiValued, `${vr} should be single-valued`).toBe(false);
        }
        expect(lookupVr('DS')?.multiValued).toBe(true);
    });

    it('recognizes VR codes', () => {
        expect(isVr('PN')).toBe(true);
        expect(isVr('pn')).toBe(false);
        expect(isVr('XX')).toBe(false);
        expect(lookupVr('XX')).toBeUndefined();
    });
});

describe('resolveVr', () => {
    it('resolves a single candidate to itself without context', () => {
        expect(resolveVr(['CS'], {})).toBe('CS');
    });

    it('resolves US or SS by PixelRepresentation', () => {
        // the case @ubercode/dcmtk got wrong by collapsing `xs` to US at
        // generation time, misreading every signed data set
        expect(resolveVr(['US', 'SS'], { pixelRepresentation: 0 })).toBe('US');
        expect(resolveVr(['US', 'SS'], { pixelRepresentation: 1 })).toBe('SS');
    });

    it('resolves OB or OW to OB under an encapsulated syntax', () => {
        expect(resolveVr(['OB', 'OW'], { encapsulated: true })).toBe('OB');
        // encapsulation wins over BitsAllocated: fragments are always bytes
        expect(resolveVr(['OB', 'OW'], { encapsulated: true, bitsAllocated: 16 })).toBe('OB');
    });

    it('resolves OB or OW by BitsAllocated when native', () => {
        expect(resolveVr(['OB', 'OW'], { bitsAllocated: 8 })).toBe('OB');
        expect(resolveVr(['OB', 'OW'], { bitsAllocated: 16 })).toBe('OW');
        expect(resolveVr(['OB', 'OW'], { bitsAllocated: 1 })).toBe('OB');
    });

    it('returns undefined rather than guessing', () => {
        // a lookup that guesses is worse than one that admits it cannot decide:
        // the caller can fall back explicitly, but cannot detect a silent guess
        expect(resolveVr(['US', 'SS'], {})).toBeUndefined();
        expect(resolveVr(['OB', 'OW'], {})).toBeUndefined();
        expect(resolveVr(['US', 'SS'], { bitsAllocated: 16 })).toBeUndefined();
        expect(resolveVr([], { pixelRepresentation: 1 })).toBeUndefined();
    });

    it('resolves the three-way LUT ambiguity by signedness', () => {
        expect(resolveVr(['US', 'SS', 'OW'], { pixelRepresentation: 1 })).toBe('SS');
        expect(resolveVr(['US', 'SS', 'OW'], { pixelRepresentation: 0 })).toBe('US');
    });
});
