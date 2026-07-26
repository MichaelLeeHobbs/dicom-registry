import { describe, expect, it } from 'vitest';
import { allTransferSyntaxes, findUids, lookupUid } from '../src/uid';

/**
 * The registry facts `scripts/gen-storescp-cfg.mjs` depends on.
 *
 * The generator itself runs against `dist/`, so it is smoke-tested in the CI
 * job that builds. What is asserted here is the data contract underneath it —
 * if these hold, a regenerated config is correct; if one breaks, the generator
 * silently emits a config DCMTK will reject.
 */
describe('association config data contract', () => {
    it('uses DCMTK names, which differ from PS3.6 keywords', () => {
        // the defect this caught: DCMTK's config parser resolves names against
        // its own UID table, so it wants VerificationSOPClass, and rejects the
        // official keyword `Verification`
        const verification = lookupUid('1.2.840.10008.1.1');
        expect(verification?.keyword).toBe('Verification');
        expect(verification?.dcmtkName).toBe('VerificationSOPClass');
        expect(verification?.dcmtkName).not.toBe(verification?.keyword);
    });

    it('keeps DCMTK spellings that differ only in case', () => {
        // MultiframeGrayscale... (DCMTK) vs MultiFrameGrayscale... (PS3.6); a
        // case-insensitive comparison would have hidden this
        const multiframe = findUids({ type: 'sopClass', service: 'storage' }).filter(
            entry =>
                entry.keyword !== null &&
                entry.dcmtkName !== null &&
                entry.keyword !== entry.dcmtkName &&
                entry.keyword.toLowerCase() === entry.dcmtkName.toLowerCase()
        );
        expect(multiframe.length).toBeGreaterThan(0);
    });

    it('names every DICOM storage SOP class', () => {
        const storage = findUids({ type: 'sopClass', service: 'storage', standard: 'DICOM' });
        expect(storage.length).toBeGreaterThan(190);
        const unnamed = storage.filter(entry => entry.dcmtkName === null && entry.keyword === null);
        expect(unnamed, 'every storage class needs a config name').toEqual([]);
    });

    it('separates the domains that share the DICOM encoding', () => {
        // a teleradiology SCP should not advertise baggage-screening classes,
        // which is only possible because the standard is recorded per UID
        const dicom = findUids({ type: 'sopClass', service: 'storage', standard: 'DICOM' }).length;
        const all = findUids({ type: 'sopClass', service: 'storage' }).length;
        expect(all).toBeGreaterThan(dicom);
        expect(findUids({ type: 'sopClass', service: 'storage', standard: 'DICOS' }).length).toBeGreaterThan(0);
        expect(findUids({ type: 'sopClass', service: 'storage', standard: 'DICONDE' }).length).toBeGreaterThan(0);
    });

    it('includes retired storage classes, which legacy archives still send', () => {
        const retired = findUids({ type: 'sopClass', service: 'storage', status: 'retired' });
        expect(retired.length).toBeGreaterThan(10);
        // DCMTK keeps its RETIRED_ prefix in the config token, and that prefixed
        // form is what an association config must name
        expect(retired.some(entry => entry.dcmtkName?.startsWith('RETIRED_') === true)).toBe(true);
    });

    it('names every transfer syntax a config can offer', () => {
        const offerable = allTransferSyntaxes().filter(entry => entry.dcmtkName !== null);
        expect(offerable.length).toBeGreaterThan(45);
        for (const token of ['LittleEndianImplicit', 'LittleEndianExplicit', 'DeflatedLittleEndianExplicit', 'JPEGBaseline', 'JPEG2000']) {
            expect(
                offerable.some(entry => entry.dcmtkName === token),
                `config token ${token} should exist`
            ).toBe(true);
        }
    });
});
