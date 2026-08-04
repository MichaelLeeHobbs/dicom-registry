/**
 * Private tag definitions for 132 vendors, from DCMTK's `private.dic`.
 *
 * **This module is opt-in.** The package barrel does not re-export it; import
 * `@ubercode/dicom-registry/private` explicitly. It is the largest dataset here
 * and most consumers never touch a private tag, so it should not ride along
 * with a VR lookup.
 *
 * ## Private tags are not addressed by tag number
 *
 * A private creator reserves a *block* at runtime: it writes its identifier
 * into `(gggg,00xx)` for some `xx` in `10`–`FF`, and its attributes then live at
 * `(gggg,xxee)`. The same vendor attribute is `(0019,1012)` in one file and
 * `(0019,4312)` in the next, purely because a different block was free.
 *
 * So a lookup needs three things — group, creator identifier, and the element's
 * low byte — and the creator has to be read from the data set first. Any API
 * that offers `lookupPrivate(tag)` is guessing, because the tag alone does not
 * identify the attribute.
 *
 * @example
 * ```ts
 * // having read 'SIEMENS MEDCOM HEADER' from (0029,0010), block 0x10:
 * lookupPrivateTag({ tag: 0x00291012, creator: 'SIEMENS MEDCOM HEADER' });
 * ```
 *
 * @module private
 */

import { PRIVATE_TAGS, type PackedPrivateTag } from './generated/privateTags';
import { isInTagRange, tagElement, tagGroup, toTag, toTagRange, type TagLike, type TagRange } from './tag';
import type { Vr } from './vr';

/** One private tag definition. */
export interface PrivateTagEntry {
    /** The groups this definition covers; usually one, occasionally an odd range. */
    readonly groupRange: TagRange;
    /** The private creator identifier that owns it, e.g. `SIEMENS MEDCOM HEADER`. */
    readonly creator: string;
    /**
     * The element, as hex. Two digits when {@link blockRelative} — an offset
     * within whichever block the creator reserved — four when fixed.
     */
    readonly element: string;
    /** Whether the element is an offset within a reserved block. */
    readonly blockRelative: boolean;
    /** Permitted VRs. More than one where DCMTK records the ambiguity. */
    readonly vr: readonly Vr[];
    readonly keyword: string;
    /** Value multiplicity, verbatim from the dictionary. */
    readonly vm: string;
}

/** DCMTK's internal VR codes, as used in `private.dic`. */
const PSEUDO_VR: Readonly<Record<string, readonly Vr[]>> = {
    ox: ['OB', 'OW'],
    xs: ['US', 'SS'],
    px: ['OB', 'OW'],
    lt: ['US', 'SS', 'OW'],
    up: ['UL'],
};

function toEntry(row: PackedPrivateTag): PrivateTagEntry {
    const groupRange = toTagRange(`(${row[0]},0000)`);
    if (groupRange === undefined) {
        throw new Error(`private: generated dictionary contains an unreadable group '${row[0]}'`);
    }
    return {
        groupRange,
        creator: row[1],
        element: row[2],
        blockRelative: row[3],
        vr: PSEUDO_VR[row[4]] ?? [row[4] as Vr],
        keyword: row[5],
        vm: row[6],
    };
}

let byCreator: ReadonlyMap<string, readonly PrivateTagEntry[]> | undefined;
let all: readonly PrivateTagEntry[] | undefined;

/** Built on first use; this is the dataset most worth not paying for. */
function indexed(): ReadonlyMap<string, readonly PrivateTagEntry[]> {
    if (byCreator === undefined) {
        all = PRIVATE_TAGS.map(toEntry);
        const map = new Map<string, PrivateTagEntry[]>();
        for (const entry of all) {
            const existing = map.get(entry.creator);
            if (existing === undefined) {
                map.set(entry.creator, [entry]);
            } else {
                existing.push(entry);
            }
        }
        byCreator = map;
    }
    return byCreator;
}

/** What is known about a private element being looked up. */
export interface PrivateTagQuery {
    /** The tag as it appears in the data set, e.g. `0x00291012`. */
    readonly tag: TagLike;
    /**
     * The private creator identifier read from `(gggg,00xx)`, where `xx` is the
     * block byte of {@link tag}. Required: the tag alone does not identify the
     * attribute.
     */
    readonly creator: string;
}

function matches(entry: PrivateTagEntry, group: number, element: number): boolean {
    if (!isInTagRange(group * 0x10000, entry.groupRange)) {
        return false;
    }
    const wanted = Number.parseInt(entry.element, 16);
    // a block-relative definition matches on the low byte only; the block byte
    // is whatever the creator happened to reserve
    return entry.blockRelative ? (element & 0xff) === wanted : element === wanted;
}

/**
 * Looks up a private tag.
 *
 * @param query - The tag and the private creator that owns its block
 * @returns The definition, or `undefined` when the creator is unknown to the
 *   dictionary or defines nothing at that element
 * @example
 * ```ts
 * lookupPrivateTag({ tag: '(0019,1012)', creator: '1.2.840.113681' })?.keyword;
 * ```
 */
export function lookupPrivateTag(query: PrivateTagQuery): PrivateTagEntry | undefined {
    const candidates = indexed().get(query.creator);
    if (candidates === undefined) {
        return undefined;
    }
    const resolved = toTag(query.tag);
    const group = tagGroup(resolved);
    const element = tagElement(resolved);
    return candidates.find(entry => matches(entry, group, element));
}

/**
 * Every definition a private creator declares.
 *
 * @param creator - The private creator identifier
 * @returns Its definitions, or an empty array when the creator is unknown
 */
export function privateTagsByCreator(creator: string): readonly PrivateTagEntry[] {
    return indexed().get(creator) ?? [];
}

/** Every private creator identifier in the dictionary, sorted. */
export function privateCreators(): readonly string[] {
    return [...indexed().keys()].sort();
}

/** Every private tag definition, in source order. */
export function allPrivateTags(): readonly PrivateTagEntry[] {
    indexed();
    return all ?? [];
}

/**
 * The block byte a private tag sits in — the `xx` of `(gggg,xxee)`.
 *
 * The private creator for that block is at `(gggg,00xx)`, so this is how a
 * reader finds which creator element to consult.
 *
 * @param tag - The private tag
 * @returns The block byte, `0x10`–`0xFF`
 * @example
 * ```ts
 * privateBlock('(0019,1012)').toString(16); // '10' — creator is at (0019,0010)
 * ```
 */
export function privateBlock(tag: TagLike): number {
    return (tagElement(tag) >> 8) & 0xff;
}

/**
 * The tag holding the private creator identifier for a private tag's block.
 *
 * @param tag - The private tag
 * @returns The private creator tag, `(gggg,00xx)`
 */
export function privateCreatorTag(tag: TagLike): number {
    const resolved = toTag(tag);
    return tagGroup(resolved) * 0x10000 + privateBlock(resolved);
}
