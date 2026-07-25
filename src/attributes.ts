/**
 * The DICOM attribute dictionary: tag → keyword, name, VR, VM, retirement.
 *
 * Two things here are not in the dictionaries this package replaces.
 *
 * **Repeating groups resolve as ranges.** `(6000-60FF,0010)` is stored as a
 * range, so `lookupAttribute('(6008,0010)')` finds OverlayRows without the
 * caller masking anything — and `lookupAttribute('(6001,0010)')` correctly finds
 * *nothing*, because odd groups are private (PS3.5 §7.1). A dictionary that
 * flattens the range to a single `6000` entry answers the first wrongly; one
 * that masks with `0xFF00` answers the second wrongly.
 *
 * **Ambiguous VRs stay ambiguous.** PS3.6 gives some attributes more than one
 * permitted VR because the answer depends on the data set. They are stored as a
 * list; use {@link resolveAttributeVr} to settle one against context.
 *
 * @module attributes
 */

import { ATTRIBUTES, type PackedAttribute } from './generated/attributes';
import { DIVERGENCES } from './generated/divergences';
import { isInTagRange, tagRangeBase, tagRangeSize, toTag, toTagRange, type Tag, type TagLike, type TagRange } from './tag';
import { parseVm, type Vm } from './vm';
import { resolveVr, type Vr, type VrContext } from './vr';

/** Which standard defines an attribute. */
export type AttributeStandard = 'DICOM' | 'DICONDE' | 'DICOS' | 'PRIVATE' | 'ILLEGAL' | 'GENERIC';
/** Which upstream sources contributed an attribute. */
export type AttributeSources = 'both' | 'dcmtk' | 'innolitics';

/** One attribute of the dictionary. */
export interface AttributeEntry {
    /**
     * The lowest tag this entry covers — its canonical identity. For a concrete
     * attribute this is the tag itself; for a repeating group it is the first
     * tag in the range (`0x60000010` for the overlay rows).
     */
    readonly id: Tag;
    /** The tag in dictionary notation, e.g. `(0010,0010)` or `(6000-60FF,0010)`. */
    readonly tag: string;
    /** The tags this entry covers. A concrete attribute is a range of one. */
    readonly range: TagRange;
    /** `true` when the entry covers more than one tag. */
    readonly isRepeating: boolean;
    /** The official PS3.6 keyword, or `null` where none is defined. */
    readonly keyword: string | null;
    /** The human-readable name, or `null` where PS3.6 defines none. */
    readonly name: string | null;
    /**
     * Permitted VRs. Usually one; more than one means PS3.6 leaves it to the
     * data set, and **empty** means the entry carries no value at all (the FFFE
     * delimitation items).
     */
    readonly vr: readonly Vr[];
    /** The parsed value multiplicity, or `null` where PS3.6 defines none. */
    readonly vm: Vm | null;
    readonly retired: boolean;
    readonly standard: AttributeStandard;
    /** Which sources define this attribute. */
    readonly sources: AttributeSources;
}

/** A recorded disagreement between the two upstream sources. */
export interface Divergence {
    /** The merged tag this concerns. */
    readonly tag: string;
    readonly keyword: string | null;
    /** Which field the sources disagree on: `tag`, `vr`, `vm` or `retired`. */
    readonly field: string;
    /** What `dicom.dic` says. */
    readonly dcmtk: string;
    /** What PS3.6 says. */
    readonly innolitics: string;
    /** Why the merge chose what it did. */
    readonly note: string | null;
}

function toEntry(row: PackedAttribute): AttributeEntry {
    const range = toTagRange(row[0]);
    if (range === undefined) {
        // generated data — unreachable unless the generator emitted a tag the
        // codec cannot read, which is a build defect, not a runtime condition
        throw new Error(`attributes: generated dictionary contains an unreadable tag '${row[0]}'`);
    }
    return {
        id: tagRangeBase(range),
        tag: row[0],
        range,
        isRepeating: tagRangeSize(range) > 1,
        keyword: row[1],
        name: row[2],
        vr: row[3] === '' ? [] : (row[3].split(',') as Vr[]),
        vm: row[4] === null ? null : (parseVm(row[4]) ?? null),
        retired: row[5],
        standard: row[6] as AttributeStandard,
        sources: row[7] as AttributeSources,
    };
}

interface Index {
    /** Concrete tags, which is the overwhelming majority. */
    readonly exact: ReadonlyMap<Tag, AttributeEntry>;
    /** Repeating ranges, narrowest first so the most specific match wins. */
    readonly ranges: readonly AttributeEntry[];
    readonly byKeyword: ReadonlyMap<string, AttributeEntry>;
    readonly all: readonly AttributeEntry[];
}

let index: Index | undefined;

/** Built on first use so importing the module stays cheap. */
function indexed(): Index {
    if (index === undefined) {
        const all = ATTRIBUTES.map(toEntry);
        const exact = new Map<Tag, AttributeEntry>();
        const ranges: AttributeEntry[] = [];
        const byKeyword = new Map<string, AttributeEntry>();
        for (const entry of all) {
            if (entry.isRepeating) {
                ranges.push(entry);
            } else {
                exact.set(entry.id, entry);
            }
            if (entry.keyword !== null && !byKeyword.has(entry.keyword)) {
                byKeyword.set(entry.keyword, entry);
            }
        }
        // narrowest first: (6000-60FF,0010) must beat the (0000-u-FFFF,0000)
        // group-length catch-all for (6000,0000)
        ranges.sort((a, b) => tagRangeSize(a.range) - tagRangeSize(b.range));
        index = { exact, ranges, byKeyword, all };
    }
    return index;
}

/**
 * Looks up an attribute, resolving repeating groups.
 *
 * Concrete tags match first; a miss then falls through to the repeating ranges,
 * narrowest first, so a specific definition always beats a catch-all.
 *
 * @param tag - The tag, in any supported notation
 * @returns The attribute, or `undefined` when nothing defines it
 * @example
 * ```ts
 * lookupAttribute('(6008,0010)')?.keyword; // 'OverlayRows' — via the range
 * lookupAttribute('(6001,0010)');          // undefined — odd group, private
 * ```
 */
export function lookupAttribute(tag: TagLike): AttributeEntry | undefined {
    const resolved = toTag(tag);
    const exact = indexed().exact.get(resolved);
    if (exact !== undefined) {
        return exact;
    }
    return indexed().ranges.find(entry => isInTagRange(resolved, entry.range));
}

/**
 * Looks up an attribute by its official PS3.6 keyword.
 *
 * @param keyword - The keyword, e.g. `PatientName`
 * @returns The attribute, or `undefined` for an unknown keyword
 */
export function lookupAttributeByKeyword(keyword: string): AttributeEntry | undefined {
    return indexed().byKeyword.get(keyword);
}

/** Every attribute in the dictionary, ordered by tag. */
export function allAttributes(): readonly AttributeEntry[] {
    return indexed().all;
}

/** Every attribute that covers more than one tag, narrowest range first. */
export function repeatingAttributes(): readonly AttributeEntry[] {
    return indexed().ranges;
}

/**
 * Resolves an attribute's VR against the data set it appears in.
 *
 * A convenience over {@link resolveVr} that takes the attribute rather than its
 * VR list. Returns `undefined` when the attribute is unknown, carries no VR, or
 * the context does not settle the ambiguity — never a guess.
 *
 * @param tag - The tag, in any supported notation
 * @param context - What is known about the surrounding data set
 * @returns The resolved VR, or `undefined`
 * @example
 * ```ts
 * // (0028,1101) is 'US or SS'; PixelRepresentation decides
 * resolveAttributeVr('(0028,1101)', { pixelRepresentation: 1 }); // 'SS'
 * ```
 */
export function resolveAttributeVr(tag: TagLike, context: VrContext): Vr | undefined {
    const entry = lookupAttribute(tag);
    return entry === undefined ? undefined : resolveVr(entry.vr, context);
}

/**
 * Every recorded disagreement between `dicom.dic` and PS3.6.
 *
 * Shipped so a consumer can see which reading it is getting rather than
 * discovering the difference against a real file.
 */
export function divergences(): readonly Divergence[] {
    return DIVERGENCES.map(row => ({
        tag: row[0],
        keyword: row[1],
        field: row[2],
        dcmtk: row[3],
        innolitics: row[4],
        note: row[5],
    }));
}
