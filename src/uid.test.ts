import { describe, expect, it } from 'vitest';
import {
    PROVENANCE,
    allTransferSyntaxes,
    allUids,
    findUids,
    isDeflated,
    isEncapsulated,
    isExplicitVr,
    isLossy,
    isNativePixelData,
    isStorageSopClass,
    lookupTransferSyntax,
    lookupUid,
    lookupUidByKeyword,
    sopClassIodType,
    transferSyntaxByDcmtkName,
} from './uid';

const IMPLICIT_LE = '1.2.840.10008.1.2';
const EXPLICIT_LE = '1.2.840.10008.1.2.1';
const DEFLATED = '1.2.840.10008.1.2.1.99';
const EXPLICIT_BE = '1.2.840.10008.1.2.2';
const JPEG_BASELINE = '1.2.840.10008.1.2.4.50';
const JPEG2000_LOSSLESS = '1.2.840.10008.1.2.4.90';
const CT_IMAGE = '1.2.840.10008.5.1.4.1.1.2';
const COMPREHENSIVE_3D_SR = '1.2.840.10008.5.1.4.1.1.88.34';
const VERIFICATION = '1.2.840.10008.1.1';

describe('UID lookup', () => {
    it('resolves a storage SOP class with both classification axes', () => {
        expect(lookupUid(CT_IMAGE)).toMatchObject({
            keyword: 'CTImageStorage',
            type: 'sopClass',
            service: 'storage',
            iodType: 'image',
            status: 'standard',
            standard: 'DICOM',
        });
    });

    it('resolves by keyword', () => {
        expect(lookupUidByKeyword('CTImageStorage')?.uid).toBe(CT_IMAGE);
        expect(lookupUidByKeyword('NotARealKeyword')).toBeUndefined();
    });

    it('returns undefined for an unknown UID rather than guessing', () => {
        expect(lookupUid('1.2.3.4.5.6.7.8.9')).toBeUndefined();
    });

    it('keeps a null keyword where the standard defines none', () => {
        // DCMTK marks these NULL; that is data, not a parse failure, and it must
        // not be confused with "we could not read the column"
        const withoutKeyword = allUids().filter(entry => entry.keyword === null);
        expect(withoutKeyword.length).toBeGreaterThan(0);
        expect(withoutKeyword.every(entry => entry.dcmtkName !== null)).toBe(true);
    });

    it('classifies non-storage UIDs without a service or content kind', () => {
        expect(lookupUid(VERIFICATION)).toMatchObject({ type: 'sopClass', service: null, iodType: null });
        expect(lookupUid(JPEG_BASELINE)).toMatchObject({ type: 'transferSyntax', service: null, iodType: null });
    });
});

describe('classification replaces hand-written predicates', () => {
    it('identifies storage SOP classes', () => {
        expect(isStorageSopClass(CT_IMAGE)).toBe(true);
        expect(isStorageSopClass(COMPREHENSIVE_3D_SR)).toBe(true);
        expect(isStorageSopClass(VERIFICATION)).toBe(false);
        expect(isStorageSopClass(JPEG_BASELINE)).toBe(false);
        expect(isStorageSopClass('1.2.3.4')).toBe(false);
    });

    it('reports content kind as data, not by UID prefix matching', () => {
        expect(sopClassIodType(CT_IMAGE)).toBe('image');
        expect(sopClassIodType(COMPREHENSIVE_3D_SR)).toBe('structuredReport');
        expect(sopClassIodType(VERIFICATION)).toBeUndefined();
    });

    it('answers "every image storage class" as a query', () => {
        const images = findUids({ type: 'sopClass', service: 'storage', iodType: 'image' });
        expect(images.length).toBeGreaterThan(50);
        expect(images.every(entry => entry.iodType === 'image')).toBe(true);
        expect(images.some(entry => entry.uid === CT_IMAGE)).toBe(true);
        expect(images.some(entry => entry.uid === COMPREHENSIVE_3D_SR)).toBe(false);
    });

    it('separates the service axis from the content axis', () => {
        // an SR *storage* class is both storage (service) and structuredReport
        // (content) — collapsing these is what makes predicates multiply
        const srStorage = findUids({ service: 'storage', iodType: 'structuredReport' });
        expect(srStorage.some(entry => entry.uid === COMPREHENSIVE_3D_SR)).toBe(true);
        const queryRetrieve = findUids({ service: 'queryRetrieve' });
        expect(queryRetrieve.length).toBeGreaterThan(10);
        expect(queryRetrieve.every(entry => entry.iodType === null)).toBe(true);
    });

    it('finds retired classes without special-casing', () => {
        const retired = findUids({ type: 'sopClass', status: 'retired' });
        expect(retired.length).toBeGreaterThan(5);
    });
});

describe('transfer syntax properties', () => {
    it('describes the uncompressed syntaxes', () => {
        expect(lookupTransferSyntax(IMPLICIT_LE)).toMatchObject({
            explicitVr: false,
            byteOrder: 'little',
            pixelDataEncoding: 'native',
            pixelDataCompression: 'none',
            streamCompression: 'none',
            status: 'standard',
        });
        expect(lookupTransferSyntax(EXPLICIT_BE)).toMatchObject({ explicitVr: true, byteOrder: 'big', status: 'retired' });
    });

    it('separates stream compression from pixel compression', () => {
        const deflated = lookupTransferSyntax(DEFLATED);
        // deflate applies to the whole stream; the pixels themselves are not
        // compressed, and conflating the two misreports the syntax entirely
        expect(deflated).toMatchObject({ streamCompression: 'deflate', pixelDataCompression: 'none', pixelDataEncoding: 'native' });
        expect(isDeflated(DEFLATED)).toBe(true);
        expect(isDeflated(EXPLICIT_LE)).toBe(false);
    });

    it('reports encapsulation, replacing hardcoded native-syntax lists', () => {
        expect(isEncapsulated(JPEG_BASELINE)).toBe(true);
        expect(isEncapsulated(JPEG2000_LOSSLESS)).toBe(true);
        expect(isEncapsulated(IMPLICIT_LE)).toBe(false);
        expect(isNativePixelData(IMPLICIT_LE)).toBe(true);
        expect(isNativePixelData(JPEG_BASELINE)).toBe(false);
        // unknown syntaxes answer false rather than throwing
        expect(isEncapsulated('1.2.3.4')).toBe(false);
    });

    it('distinguishes lossy from lossless compression', () => {
        expect(isLossy(JPEG_BASELINE)).toBe(true);
        expect(isLossy(JPEG2000_LOSSLESS)).toBe(false);
        expect(lookupTransferSyntax(JPEG2000_LOSSLESS)?.pixelDataCompression).toBe('lossless');
    });

    it('reports VR encoding', () => {
        expect(isExplicitVr(EXPLICIT_LE)).toBe(true);
        expect(isExplicitVr(IMPLICIT_LE)).toBe(false);
    });

    it('carries MIME type and file extension, which are not derivable from the UID', () => {
        expect(lookupTransferSyntax(JPEG_BASELINE)).toMatchObject({ mimeType: 'image/jpeg', filenameExtension: '.jpeg' });
        expect(lookupTransferSyntax(JPEG2000_LOSSLESS)?.mimeType).toBe('image/jp2');
    });

    it('resolves the DCMTK association-config token both ways', () => {
        // this token is what a storescp.cfg presentation context names, and it
        // is not derivable from the UID or the enum
        expect(lookupTransferSyntax(JPEG_BASELINE)?.dcmtkName).toBe('JPEGBaseline');
        expect(transferSyntaxByDcmtkName('JPEGBaseline')?.uid).toBe(JPEG_BASELINE);
        expect(transferSyntaxByDcmtkName('LittleEndianImplicit')?.uid).toBe(IMPLICIT_LE);
        expect(transferSyntaxByDcmtkName('JPEGLossless:Non-hierarchical:Process14')?.uid).toBe('1.2.840.10008.1.2.4.57');
        expect(transferSyntaxByDcmtkName('NotAToken')).toBeUndefined();
    });

    it('omits the DCMTK-internal syntax that has no UID', () => {
        expect(allTransferSyntaxes().every(entry => entry.uid !== '')).toBe(true);
        expect(allTransferSyntaxes().some(entry => entry.status === 'internal')).toBe(false);
    });
});

describe('provenance', () => {
    it('states the DICOM edition and the exact upstream revisions', () => {
        expect(PROVENANCE.dicomEdition).toMatch(/^\d{4}[a-z]$/);
        expect(PROVENANCE.sources.map(source => source.key).sort()).toEqual(['dcmtk', 'innolitics']);
        for (const source of PROVENANCE.sources) {
            expect(source.sha).toMatch(/^[0-9a-f]{40}$/);
        }
    });

    it('derives generatedAt from a source commit, so a rebuild is byte-identical', () => {
        // a wall-clock timestamp would make every regeneration a diff and defeat
        // the `data:check` gate entirely
        expect(PROVENANCE.sources.map(source => source.commitDate)).toContain(PROVENANCE.generatedAt);
    });
});
