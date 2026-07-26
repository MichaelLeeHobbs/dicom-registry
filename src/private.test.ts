import { describe, expect, it } from 'vitest';
import { allPrivateTags, lookupPrivateTag, privateBlock, privateCreatorTag, privateCreators, privateTagsByCreator } from './private';

describe('private tag lookup', () => {
    it('resolves a block-relative definition in whichever block was reserved', () => {
        // the whole reason this is not keyed by tag: the same vendor attribute
        // lands at a different element in every file, depending on which block
        // the creator managed to reserve
        const creator = '1.2.840.113681';
        for (const tag of ['(0019,1010)', '(0019,2310)', '(0019,ff10)']) {
            expect(lookupPrivateTag({ tag, creator })?.keyword, tag).toBe('CRImageParamsCommon');
        }
    });

    it('does not match a different element in the same block', () => {
        expect(lookupPrivateTag({ tag: '(0019,1010)', creator: '1.2.840.113681' })?.keyword).toBe('CRImageParamsCommon');
        expect(lookupPrivateTag({ tag: '(0019,1011)', creator: '1.2.840.113681' })?.keyword).toBe('CRImageIPParamsSingle');
    });

    it('requires the creator — a tag alone does not identify a private attribute', () => {
        expect(lookupPrivateTag({ tag: '(0019,1010)', creator: 'SOME OTHER VENDOR' })).toBeUndefined();
        expect(lookupPrivateTag({ tag: '(0019,1010)', creator: '' })).toBeUndefined();
    });

    it('resolves a fixed four-digit element only at that exact element', () => {
        const creator = 'CMR42 CIRCLECVI';
        expect(lookupPrivateTag({ tag: '(0025,1010)', creator })?.keyword).toBe('WorkspaceID');
        // fixed elements are absolute: a different block must NOT match
        expect(lookupPrivateTag({ tag: '(0025,2010)', creator })).toBeUndefined();
    });

    it('resolves an odd group range', () => {
        const creator = 'DLX_ANNOT_01';
        expect(lookupPrivateTag({ tag: '(7001,1004)', creator })?.keyword).toBe('TextAnnotation');
        expect(lookupPrivateTag({ tag: '(7003,4304)', creator })?.keyword).toBe('TextAnnotation');
        // even groups are never private, so they must not match
        expect(lookupPrivateTag({ tag: '(7002,1004)', creator })).toBeUndefined();
    });

    it('keeps ambiguous VRs from the private dictionary', () => {
        const ambiguous = allPrivateTags().filter(entry => entry.vr.length > 1);
        expect(ambiguous.length).toBeGreaterThan(0);
        expect(ambiguous.every(entry => entry.vr.length <= 3)).toBe(true);
    });
});

describe('private creators', () => {
    it('lists the vendors the dictionary covers', () => {
        const creators = privateCreators();
        expect(creators.length).toBeGreaterThanOrEqual(120);
        for (const creator of ['SIEMENS MEDCOM HEADER', 'GEMS_IDEN_01', 'ACUSON']) {
            expect(creators, creator).toContain(creator);
        }
    });

    it('returns a creator’s definitions, and an empty list for an unknown one', () => {
        expect(privateTagsByCreator('ACUSON').length).toBeGreaterThan(5);
        expect(privateTagsByCreator('NOT A VENDOR')).toEqual([]);
    });

    it('parses every row', () => {
        expect(allPrivateTags().length).toBeGreaterThanOrEqual(2800);
    });
});

describe('block arithmetic', () => {
    it('reports the block a private tag sits in', () => {
        expect(privateBlock('(0019,1012)')).toBe(0x10);
        expect(privateBlock('(0019,4312)')).toBe(0x43);
        expect(privateBlock('(0019,ff01)')).toBe(0xff);
    });

    it('reports where the creator identifier for that block lives', () => {
        // this is the tag a reader must fetch before it can look anything up
        expect(privateCreatorTag('(0019,1012)')).toBe(0x00190010);
        expect(privateCreatorTag('(0029,4312)')).toBe(0x00290043);
    });
});
