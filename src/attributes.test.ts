import { describe, expect, it } from 'vitest';
import { allAttributes, divergences, lookupAttribute, lookupAttributeByKeyword, repeatingAttributes, resolveAttributeVr } from './attributes';
import { isValidVm } from './vm';

describe('attribute lookup', () => {
    it('resolves a concrete tag in every supported notation', () => {
        for (const notation of ['(0010,0010)', '00100010', 'x00100010', 0x00100010]) {
            expect(lookupAttribute(notation)?.keyword, `via ${String(notation)}`).toBe('PatientName');
        }
    });

    it('carries keyword, name, VR and VM', () => {
        expect(lookupAttribute('(0010,0010)')).toMatchObject({
            keyword: 'PatientName',
            name: "Patient's Name",
            vr: ['PN'],
            retired: false,
            standard: 'DICOM',
        });
    });

    it('resolves by keyword', () => {
        expect(lookupAttributeByKeyword('StudyInstanceUID')?.tag).toBe('(0020,000D)');
        expect(lookupAttributeByKeyword('NotAKeyword')).toBeUndefined();
    });

    it('returns undefined for an undefined tag', () => {
        expect(lookupAttribute('(0003,0003)')).toBeUndefined();
    });
});

describe('repeating groups', () => {
    it('resolves any even group in the overlay range', () => {
        // the whole point of storing the range: a flattened dictionary knows
        // only 6000 and answers undefined for every other overlay group
        for (const group of ['6000', '6002', '6008', '60FE']) {
            expect(lookupAttribute(`(${group},0010)`)?.keyword, `group ${group}`).toBe('OverlayRows');
        }
    });

    it('reads an odd group in the overlay range as private — @ubercode/dcmtk#47', () => {
        // odd groups are private by definition (PS3.5 §7.1). A dictionary that
        // masks with 0xFF00, or that trusts PS3.6's bare (60XX,0010) wildcard,
        // reports OverlayRows here and misreads a vendor's private data.
        // The truthful answer is not "unknown" but the private creator pattern.
        for (const tag of ['(6001,0010)', '(6003,0010)', '(60FF,0010)']) {
            expect(lookupAttribute(tag)?.keyword, tag).toBe('PrivateCreator');
        }
        expect(lookupAttribute('(6001,0011)')?.keyword).toBe('PrivateCreator');
        // an odd group outside the private-creator element window is undefined,
        // and must still never be an overlay
        expect(lookupAttribute('(6001,1000)')).toBeUndefined();
    });

    it('does not leak past the range bounds', () => {
        expect(lookupAttribute('(6100,0010)')).toBeUndefined();
        expect(lookupAttribute('(5FFE,0010)')).toBeUndefined();
    });

    it('covers the full element width where PS3.6 says so', () => {
        // DCMTK writes (0020,3100-31FF), which is even-only by its grammar;
        // DICOM has no element parity rule, so odd elements must resolve too
        expect(lookupAttribute('(0020,3100)')?.keyword).toBe('SourceImageIDs');
        expect(lookupAttribute('(0020,3101)')?.keyword).toBe('SourceImageIDs');
        expect(lookupAttribute('(0020,31FF)')?.keyword).toBe('SourceImageIDs');
    });

    it('resolves an interior-nibble wildcard', () => {
        // (0028,04X2) — 16 tags, 0x10 apart; DCMTK lists only (0028,0412)
        expect(lookupAttribute('(0028,0412)')?.keyword).toBe('CoefficientCoding');
        expect(lookupAttribute('(0028,0432)')?.keyword).toBe('CoefficientCoding');
        expect(lookupAttribute('(0028,04F2)')?.keyword).toBe('CoefficientCoding');
        expect(lookupAttribute('(0028,0413)')?.keyword).toBe('CoefficientCodingPointers');
    });

    it('resolves the private creator pattern for odd groups only', () => {
        expect(lookupAttribute('(0009,0010)')?.keyword).toBe('PrivateCreator');
        expect(lookupAttribute('(0029,00FF)')?.keyword).toBe('PrivateCreator');
        // an even group is not private, so this is not a private creator
        expect(lookupAttribute('(0010,0010)')?.keyword).toBe('PatientName');
    });

    it('prefers the narrowest range when several match', () => {
        // three patterns cover group-length tags, from the (0000-u-FFFF,0000)
        // catch-all down to a four-group illegal range; the specific must win
        expect(lookupAttribute('(0003,0000)')?.keyword).toBe('IllegalGroupLength');
        expect(lookupAttribute('(0009,0000)')?.keyword).toBe('PrivateGroupLength');
        expect(lookupAttribute('(6000,0000)')?.keyword).toBe('GenericGroupLength');
    });

    it('exposes repeating entries narrowest first', () => {
        const repeating = repeatingAttributes();
        expect(repeating.length).toBeGreaterThan(80);
        expect(repeating.every(entry => entry.isRepeating)).toBe(true);
        expect(lookupAttributeByKeyword('OverlayRows')?.id).toBe(0x60000010);
    });
});

describe('VR and VM fidelity', () => {
    it('keeps ambiguous VRs rather than resolving them at build time', () => {
        expect(lookupAttribute('(0028,1101)')?.vr).toEqual(['US', 'SS']);
        expect(lookupAttribute('(7FE0,0010)')?.vr).toEqual(['OB', 'OW']);
        expect(lookupAttribute('(0028,3006)')?.vr).toEqual(['US', 'OW']);
        const ambiguous = allAttributes().filter(entry => entry.vr.length > 1);
        expect(ambiguous.length).toBeGreaterThan(20);
    });

    it('resolves an ambiguous VR against data set context', () => {
        expect(resolveAttributeVr('(0028,1101)', { pixelRepresentation: 1 })).toBe('SS');
        expect(resolveAttributeVr('(0028,1101)', { pixelRepresentation: 0 })).toBe('US');
        expect(resolveAttributeVr('(0028,1101)', {})).toBeUndefined();
        expect(resolveAttributeVr('(7FE0,0010)', { encapsulated: true })).toBe('OB');
        expect(resolveAttributeVr('(0010,0010)', {})).toBe('PN');
        expect(resolveAttributeVr('(0003,0003)', {})).toBeUndefined();
    });

    it('keeps an empty VR for the delimitation items, which carry no value', () => {
        expect(lookupAttribute('(FFFE,E000)')?.vr).toEqual([]);
        expect(lookupAttribute('(FFFE,E0DD)')?.vr).toEqual([]);
    });

    it('parses VM so the stride survives', () => {
        const orientation = lookupAttributeByKeyword('ImageOrientationPatient');
        expect(orientation?.vm?.source).toBe('6');
        const acquisitionMatrix = allAttributes().find(entry => entry.vm?.source === '2-2n');
        expect(acquisitionMatrix?.vm?.alternatives[0]).toEqual({ min: 2, max: null, multipleOf: 2 });
        expect(isValidVm(3, acquisitionMatrix!.vm!)).toBe(false);
        expect(isValidVm(4, acquisitionMatrix!.vm!)).toBe(true);
    });

    it('keeps the VR-dependent VM alternation', () => {
        expect(lookupAttributeByKeyword('LUTData')?.vm?.source).toBe('1-n or 1');
    });

    it('has the 2019 VRs, which a stale dictionary silently lacks', () => {
        for (const vr of ['SV', 'UV', 'OV']) {
            expect(
                allAttributes().some(entry => entry.vr.includes(vr as 'SV')),
                `some attribute should use ${vr}`
            ).toBe(true);
        }
    });
});

describe('coverage beyond PS3.6', () => {
    it('includes the PS3.7 command group, which PS3.6 does not define', () => {
        expect(lookupAttribute('(0000,0100)')?.keyword).toBe('CommandField');
        expect(lookupAttribute('(0000,0100)')?.sources).toBe('dcmtk');
    });

    it('includes DICONDE and DICOS attributes', () => {
        const standards = new Set(allAttributes().map(entry => entry.standard));
        expect(standards).toContain('DICONDE');
        expect(standards).toContain('DICOS');
    });

    it('marks retired attributes', () => {
        expect(lookupAttributeByKeyword('LengthToEnd')?.retired).toBe(true);
        expect(lookupAttributeByKeyword('PatientName')?.retired).toBe(false);
    });

    it('keeps entries PS3.6 lists with no definition at all', () => {
        // (0008,0202) is retired with no keyword, name, VR or VM. It is a real
        // dictionary row, and dropping it would hide that the tag is spoken for
        const undefinedEntry = lookupAttribute('(0008,0202)');
        expect(undefinedEntry).toBeDefined();
        expect(undefinedEntry?.keyword).toBeNull();
        expect(undefinedEntry?.vr).toEqual([]);
    });
});

describe('source divergences', () => {
    it('records every disagreement with the reason the merge chose as it did', () => {
        const all = divergences();
        expect(all.length).toBeGreaterThan(0);
        expect(all.every(entry => entry.note !== null || entry.field === 'retired')).toBe(true);
    });

    it('records the two retirement disagreements', () => {
        const retired = divergences().filter(entry => entry.field === 'retired');
        expect(retired.map(entry => entry.keyword).sort()).toEqual(['DoseValue', 'EthnicGroup']);
    });

    it('records the element-width disagreement it resolved in PS3.6 favour', () => {
        const sourceImageIds = divergences().find(entry => entry.keyword === 'SourceImageIDs');
        expect(sourceImageIds).toMatchObject({ field: 'tag', dcmtk: '(0020,3100-31FF)', innolitics: '(0020,31XX)' });
        expect(lookupAttributeByKeyword('SourceImageIDs')?.tag).toBe('(0020,31XX)');
    });
});
