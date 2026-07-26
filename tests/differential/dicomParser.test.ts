import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lookupAttribute } from '../../src/attributes';
import { toTag } from '../../src/tag';

/**
 * Differential test against `@ubercode/dicom-parser`'s data dictionary.
 *
 * This is the strongest gate in the suite. Unit tests show the registry is
 * self-consistent; only this shows it can actually **replace** a dictionary
 * already in service. dicom-parser's table descends from `@ubercode/dcmtk`'s
 * `dictionary.json`, which descends from `dicom.dic`, so this covers that
 * lineage too.
 *
 * The test is not "the two agree". They provably do not, and every way they
 * differ is either a known limitation of the older table or a deliberate
 * improvement here. What is asserted is that **every difference falls into a
 * named class** — an unclassified one fails the build, which is the only way
 * this stays a gate rather than a snapshot nobody reads.
 */

interface Fixture {
    readonly source: { readonly commit: string; readonly describe: string };
    readonly count: number;
    readonly entries: Readonly<Record<string, readonly [string, string, number, number | null, number]>>;
}

const fixture = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'dicom-parser.json'), 'utf8')) as Fixture;

/**
 * dicom-parser stores repeating groups under a `50FF`/`60FF`/`7FFF`
 * representative and masks on lookup.
 *
 * Every one of those keys is an ODD group, which can never legitimately hold
 * the attribute stored there — `(7FFF,0040)` is a private creator tag, not
 * VariableCoefficientsSDDN. That is what makes representative-plus-mask
 * error-prone, and why the registry stores the range itself.
 */
const REPRESENTATIVE = /^(50FF|60FF|7FFF)/;

/**
 * Attributes whose VM genuinely changed in the standard between the edition
 * dicom-parser's table was cut from and PS 3.6-2025e. Not a defect in either.
 */
const VM_CHANGED_UPSTREAM: Readonly<Record<string, string>> = {
    '00089007': 'FrameType gained a fifth value; 4 became 4-5',
};

/**
 * Keyword typos that DCMTK has since corrected.
 *
 * Both of the registry's sources now agree on the correct spelling, so these
 * are evidence that dicom-parser's table is stale rather than a disagreement
 * about what the keyword is.
 */
const KEYWORD_FIXED_UPSTREAM: Readonly<Record<string, string>> = {
    '00221642': 'NumberofBscansPerFrame',
    '0040A803': 'NumbeOfTableColumns',
};

type Difference = { readonly tag: string; readonly field: string; readonly theirs: string; readonly ours: string };

/** Every way the two dictionaries are permitted to disagree. */
type Class = 'narrowedVr' | 'vmHexParsed' | 'vmSuffixDropped' | 'vmChangedUpstream' | 'keywordFixedUpstream' | 'unclassified';

interface Classified {
    missing: string[];
    retiredPrefix: number;
    representative: number;
    agreed: number;
    readonly differences: Record<Class, Difference[]>;
}

/** Ours as their `[min, max]` would have been, had it been read correctly. */
function asPair(source: string): { min: number; max: number | null; unbounded: boolean } | undefined {
    const match = /^(\d+)(?:-(\d+)?(n)?)?$/.exec(source);
    if (match === null) {
        return undefined; // an alternation; they have no notation for it
    }
    const min = Number(match[1]);
    const unbounded = match[3] === 'n';
    const bound = match[2];
    return { min, max: unbounded ? null : Number(bound ?? min), unbounded };
}

/** Whether their bounds are ours read as base 16. */
function isHexReading(source: string, theirMin: number, theirMax: number | null): boolean {
    const parts = /^(\d+)(?:-(\d+)?n?)?$/.exec(source);
    if (parts === null) {
        return false;
    }
    const hexMin = Number.parseInt(parts[1] as string, 16);
    return theirMin === hexMin && theirMax === (parts[2] === undefined ? hexMin : Number.parseInt(parts[2], 16));
}

/** Which named class a VM disagreement belongs to, or undefined when they agree. */
function classifyVm(hex: string, source: string, theirMin: number, theirMax: number | null): Class | undefined {
    const ours = asPair(source);
    if (ours === undefined || (ours.min === theirMin && ours.max === theirMax)) {
        return undefined;
    }
    if (VM_CHANGED_UPSTREAM[hex] !== undefined) {
        return 'vmChangedUpstream';
    }
    // a dropped `n` is the simpler explanation and is checked first: for `2-2n`
    // both hypotheses predict [2, 2], so hex would over-claim these rows
    if (ours.unbounded && theirMax !== null) {
        return 'vmSuffixDropped';
    }
    // hex is then the only hypothesis that explains 16 -> 22 and 99 -> 153
    return isHexReading(source, theirMin, theirMax) ? 'vmHexParsed' : 'unclassified';
}

function classifyKeyword(hex: string, official: string, ours: string | null): Class | undefined {
    if (ours === null || ours === official) {
        return undefined;
    }
    return KEYWORD_FIXED_UPSTREAM[hex] === official ? 'keywordFixedUpstream' : 'unclassified';
}

function classifyVr(theirVr: string, ours: readonly string[]): Class | undefined {
    if (ours.length === 0) {
        return undefined;
    }
    if (!ours.includes(theirVr)) {
        return 'unclassified';
    }
    return ours.length > 1 ? 'narrowedVr' : undefined;
}

function classify(): Classified {
    const result: Classified = {
        missing: [],
        retiredPrefix: 0,
        representative: 0,
        agreed: 0,
        differences: { narrowedVr: [], vmHexParsed: [], vmSuffixDropped: [], vmChangedUpstream: [], keywordFixedUpstream: [], unclassified: [] },
    };
    for (const [hex, packed] of Object.entries(fixture.entries)) {
        const [theirVr, theirKeyword, theirMin, theirMax] = packed;
        if (REPRESENTATIVE.test(hex)) {
            result.representative += 1;
            continue;
        }
        const ours = lookupAttribute(toTag(hex));
        if (ours === undefined) {
            result.missing.push(`${hex} ${theirKeyword}`);
            continue;
        }
        const official = theirKeyword.replace(/^RETIRED_/, '');
        if (official !== theirKeyword) {
            result.retiredPrefix += 1;
        }
        const record = (name: Class | undefined, field: string, theirs: string, oursText: string): void => {
            if (name !== undefined) {
                result.differences[name].push({ tag: hex, field, theirs, ours: oursText });
            }
        };
        record(classifyKeyword(hex, official, ours.keyword), 'keyword', theirKeyword, ours.keyword ?? '-');
        record(classifyVr(theirVr, ours.vr), 'vr', theirVr, ours.vr.join(','));
        if (ours.vm !== null) {
            record(classifyVm(hex, ours.vm.source, theirMin, theirMax), 'vm', `${theirMin}-${theirMax ?? 'n'}`, ours.vm.source);
        }
        result.agreed += 1;
    }
    return result;
}

const classified = classify();
const differences = classified.differences;

const lookupAttributeVm = (tag: string): string | undefined => lookupAttribute(tag)?.vm?.source;

describe(`differential vs dicom-parser ${fixture.source.describe}`, () => {
    it('reproduces every entry the older dictionary defines', () => {
        // a tag the registry cannot resolve is a coverage regression, full stop
        expect(classified.missing, `unresolvable: ${classified.missing.slice(0, 10).join(', ')}`).toEqual([]);
        expect(classified.agreed).toBeGreaterThan(4700);
    });

    it('leaves no unclassified difference', () => {
        // the assertion that makes this a gate: every disagreement must be a
        // named, understood class. A new one means someone changed behaviour
        const sample = differences.unclassified.slice(0, 12).map(d => `${d.tag} ${d.field}: theirs=${d.theirs} ours=${d.ours}`);
        expect(differences.unclassified.length, `unclassified differences:\n  ${sample.join('\n  ')}`).toBe(0);
    });

    it('recovers the VR ambiguity the older generator collapsed', () => {
        // dcmtk.js resolved ox -> OW and xs -> US at generation time, so every
        // signed data set was misread. Those entries must reappear ambiguous.
        expect(differences.narrowedVr.length).toBeGreaterThan(20);
        for (const difference of differences.narrowedVr) {
            expect(difference.ours).toContain(',');
        }
        expect(lookupAttribute('(0028,1101)')?.vr).toEqual(['US', 'SS']);
        expect(lookupAttribute('(7FE0,0010)')?.vr).toEqual(['OB', 'OW']);
    });

    it('fixes the VM values dicom-parser read as hexadecimal', () => {
        // three exact matches make this conclusive rather than coincidental:
        // 16 -> 22 (0x16), 1-99 -> 1-153 (0x99), 1-32 -> 1-50 (0x32).
        // These are DEFECTS in the dictionary being replaced, recorded here so
        // that fixing them upstream fails this test and forces a fixture refresh
        expect(differences.vmHexParsed.length).toBeGreaterThanOrEqual(7);
        const volumeToTable = differences.vmHexParsed.find(difference => difference.tag === '0020930A');
        expect(volumeToTable).toMatchObject({ theirs: '22-22', ours: '16' });
    });

    it('restores the unbounded VM suffix dicom-parser dropped', () => {
        // 2-2n became [2, 2], so a four-value ContourData reads as malformed
        expect(differences.vmSuffixDropped.length).toBeGreaterThanOrEqual(20);
        expect(lookupAttributeVm('(3006,0050)')).toBe('3-3n');
        expect(lookupAttributeVm('(300A,011C)')).toBe('2-2n');
    });

    it('carries the keyword typos DCMTK has since corrected', () => {
        expect(differences.keywordFixedUpstream.map(difference => difference.tag).sort()).toEqual(['00221642', '0040A803']);
        expect(lookupAttribute('(0040,A803)')?.keyword).toBe('NumberOfTableColumns');
    });

    it('accounts for VM values the standard itself changed', () => {
        expect(differences.vmChangedUpstream.map(difference => difference.tag)).toEqual(['00089007']);
    });

    it('strips the RETIRED_ prefix the older dictionary carries', () => {
        expect(classified.retiredPrefix).toBeGreaterThan(400);
        expect(lookupAttribute('(0008,0001)')?.keyword).toBe('LengthToEnd');
        expect(lookupAttribute('(0008,0001)')?.retired).toBe(true);
    });

    it('replaces the 60FF/50FF representatives with real ranges', () => {
        expect(classified.representative).toBeGreaterThan(0);
        // the representative tag itself is a placeholder: 60FF is an ODD group
        // and can never be an overlay, which is what made masking error-prone
        expect(lookupAttribute('(60FF,0010)')?.keyword).not.toBe('OverlayRows');
        expect(lookupAttribute('(6000,0010)')?.keyword).toBe('OverlayRows');
        expect(lookupAttribute('(6008,0010)')?.keyword).toBe('OverlayRows');
    });

    it('covers materially more than the dictionary it replaces', () => {
        expect(fixture.count).toBe(4898);
        // command group, DICONDE, DICOS, private patterns and 2025e additions
        expect(classified.agreed + classified.representative).toBeLessThan(5349);
    });
});
