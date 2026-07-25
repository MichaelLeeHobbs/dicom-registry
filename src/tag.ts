/**
 * The tag codec: one representation, and conversions to and from every dialect
 * in use across the DICOM tooling this package unifies.
 *
 * Four dialects exist in the wild (and in three of our own repos):
 *
 * | Dialect            | Example        | Seen in                       |
 * | ------------------ | -------------- | ----------------------------- |
 * | numeric            | `0x00100010`   | `@ubercode/dicom-parser`      |
 * | `xGGGGEEEE`        | `x00100010`    | `@ubercode/dicom-parser`      |
 * | bare hex           | `"00100010"`   | `@ubercode/dcmtk`             |
 * | parenthesized      | `(0010,0010)`  | d-dart, DICOM documentation   |
 *
 * The canonical form here is the **number**: comparison, ordering and range
 * masking are all arithmetic, and a 32-bit tag is exactly representable.
 * Everything else is a rendering.
 *
 * @module tag
 */

/**
 * A DICOM data element tag as a 32-bit number: `group << 16 | element`.
 *
 * Encoded as a plain `number` rather than a branded type so it interoperates
 * with the numeric tags already used by `@ubercode/dicom-parser` without a
 * cast at every boundary.
 */
export type Tag = number;

/** Anything accepted where a tag is expected. */
export type TagLike = Tag | string;

/**
 * Which numbers a range half covers.
 *
 * DCMTK's dictionary makes this explicit: a bare range covers **even** values
 * only, `-o-` covers odd, `-u-` covers both.
 */
export type Parity = 'even' | 'odd' | 'any';

/**
 * An inclusive tag range, as DCMTK's `dicom.dic` expresses repeating groups.
 *
 * Both halves are ranges with a parity, because the dictionary uses all of
 * these forms (its header documents the grammar):
 *
 * ```
 * (6000-60FF,0010)             group range, even only    — overlays
 * (0009-o-FFFF,0000)           group range, odd only     — private groups
 * (0000-u-FFFF,0000)           group range, any          — generic group length
 * (0020,3100-31FF)             ELEMENT range             — SourceImageIDs
 * (0009-o-FFFF,0010-u-00FF)    both, mixed parity        — private creators
 * ```
 *
 * A concrete tag is just a range with `lo === hi` and parity `any`, so there is
 * only ever one shape to handle.
 */
export interface TagRange {
    /** First group covered (inclusive). */
    readonly groupLo: number;
    /** Last group covered (inclusive). */
    readonly groupHi: number;
    /** Which group numbers in `[groupLo, groupHi]` are covered. */
    readonly groupParity: Parity;
    /** First element covered (inclusive). */
    readonly elementLo: number;
    /** Last element covered (inclusive). */
    readonly elementHi: number;
    /** Which element numbers in `[elementLo, elementHi]` are covered. */
    readonly elementParity: Parity;
}

const TAG_MAX = 0xffffffff;
const PAREN = /^\(([0-9a-fA-F]{4}),([0-9a-fA-F]{4})\)$/;
const PREFIXED = /^[xX]([0-9a-fA-F]{8})$/;
const BARE = /^[0-9a-fA-F]{8}$/;
/** One half of a range: `6000`, `6000-60FF`, `0009-o-FFFF`, `0000-u-FFFF`. */
const RANGE_HALF = /^([0-9a-fA-F]{4})(?:-(?:([ou])-)?([0-9a-fA-F]{4}))?$/;
const RANGE_TEXT = /^\(([^,()]+),([^,()]+)\)$/;

/** Thrown for input that is not a recognizable tag. Never a bare string. */
export class TagFormatError extends Error {
    /** The value that could not be parsed. */
    readonly value: unknown;

    constructor(value: unknown) {
        super(`not a DICOM tag: ${typeof value === 'string' ? `'${value}'` : String(value)}`);
        this.name = 'TagFormatError';
        this.value = value;
    }
}

function fromNumber(value: number): Tag {
    if (!Number.isInteger(value) || value < 0 || value > TAG_MAX) {
        throw new TagFormatError(value);
    }
    return value;
}

/**
 * Parses any dialect into the canonical numeric tag.
 *
 * Accepts `0x00100010`, `'x00100010'`, `'00100010'` and `'(0010,0010)'`,
 * case-insensitively for the hex digits.
 *
 * @param value - The tag in any supported dialect
 * @returns The tag as a number
 * @throws TagFormatError when the value is not a recognizable tag
 */
export function toTag(value: TagLike): Tag {
    if (typeof value === 'number') {
        return fromNumber(value);
    }
    const paren = PAREN.exec(value);
    if (paren !== null) {
        return Number.parseInt(paren[1] as string, 16) * 0x10000 + Number.parseInt(paren[2] as string, 16);
    }
    const prefixed = PREFIXED.exec(value);
    if (prefixed !== null) {
        return Number.parseInt(prefixed[1] as string, 16);
    }
    if (BARE.test(value)) {
        return Number.parseInt(value, 16);
    }
    throw new TagFormatError(value);
}

/**
 * Parses a tag without throwing.
 *
 * @param value - The tag in any supported dialect
 * @returns The tag, or `undefined` when the value is not a recognizable tag
 */
export function tryToTag(value: TagLike): Tag | undefined {
    try {
        return toTag(value);
    } catch {
        return undefined;
    }
}

/**
 * The group half of a tag.
 *
 * @param tag - The tag
 * @returns The 16-bit group number
 */
export function tagGroup(tag: TagLike): number {
    return Math.floor(toTag(tag) / 0x10000);
}

/**
 * The element half of a tag.
 *
 * @param tag - The tag
 * @returns The 16-bit element number
 */
export function tagElement(tag: TagLike): number {
    return toTag(tag) % 0x10000;
}

/**
 * Builds a tag from its group and element.
 *
 * @param group - The 16-bit group number
 * @param element - The 16-bit element number
 * @returns The tag
 * @throws TagFormatError when either half is out of range
 */
export function tag(group: number, element: number): Tag {
    if (!Number.isInteger(group) || !Number.isInteger(element) || group < 0 || group > 0xffff || element < 0 || element > 0xffff) {
        throw new TagFormatError(`(${String(group)},${String(element)})`);
    }
    return group * 0x10000 + element;
}

function hex4(value: number): string {
    return value.toString(16).padStart(4, '0').toUpperCase();
}

/**
 * Renders as bare hex: `00100010`. The `@ubercode/dcmtk` dialect, and the key
 * format used by this package's JSON artifacts.
 *
 * @param tag - The tag
 * @returns Eight uppercase hex digits
 */
export function toHex(tag: TagLike): string {
    const resolved = toTag(tag);
    return hex4(Math.floor(resolved / 0x10000)) + hex4(resolved % 0x10000);
}

/**
 * Renders as `x00100010`. The `@ubercode/dicom-parser` string dialect.
 *
 * @param tag - The tag
 * @returns The tag prefixed with `x`, lowercase hex (as that parser emits)
 */
export function toPrefixed(tag: TagLike): string {
    return `x${toHex(tag).toLowerCase()}`;
}

/**
 * Renders as `(0010,0010)`. The d-dart dialect, and how the standard prints
 * tags in prose.
 *
 * @param tag - The tag
 * @returns The parenthesized form with uppercase hex
 */
export function toParenthesized(tag: TagLike): string {
    const resolved = toTag(tag);
    return `(${hex4(Math.floor(resolved / 0x10000))},${hex4(resolved % 0x10000)})`;
}

/**
 * Whether the tag is private — an odd group number (PS3.5 §7.8).
 *
 * @param tag - The tag
 * @returns `true` for private tags
 */
export function isPrivateTag(tag: TagLike): boolean {
    return tagGroup(tag) % 2 === 1;
}

/**
 * Whether the tag is a group-length element (`(gggg,0000)`), which carries no
 * data-dictionary meaning of its own.
 *
 * @param tag - The tag
 * @returns `true` for group-length elements
 */
export function isGroupLength(tag: TagLike): boolean {
    return tagElement(tag) === 0;
}

interface RangeHalf {
    readonly lo: number;
    readonly hi: number;
    readonly parity: Parity;
}

/** Parses one half of a range. A bare range is even-only, per the dictionary's grammar. */
function parseHalf(text: string): RangeHalf | undefined {
    const match = RANGE_HALF.exec(text);
    if (match === null) {
        return undefined;
    }
    const lo = Number.parseInt(match[1] as string, 16);
    if (match[3] === undefined) {
        return { lo, hi: lo, parity: 'any' }; // a concrete value, not a range
    }
    const hi = Number.parseInt(match[3], 16);
    if (hi < lo) {
        return undefined;
    }
    const parity: Parity = match[2] === 'o' ? 'odd' : match[2] === 'u' ? 'any' : 'even';
    return { lo, hi, parity };
}

function formatHalf(lo: number, hi: number, parity: Parity): string {
    if (lo === hi && parity === 'any') {
        return hex4(lo);
    }
    const infix = parity === 'odd' ? '-o-' : parity === 'any' ? '-u-' : '-';
    return `${hex4(lo)}${infix}${hex4(hi)}`;
}

function matchesParity(value: number, parity: Parity): boolean {
    return parity === 'any' || (parity === 'even' ? value % 2 === 0 : value % 2 === 1);
}

/**
 * Parses a tag range in DCMTK dictionary notation.
 *
 * Handles every form the dictionary uses, including odd-only (`-o-`) and
 * unrestricted (`-u-`) parity and element ranges — see {@link TagRange}.
 *
 * @param value - The range text, e.g. `(6000-60FF,0010)` or `(0020,3100-31FF)`
 * @returns The parsed range, or `undefined` when the text is not a valid range
 */
export function toTagRange(value: string): TagRange | undefined {
    const outer = RANGE_TEXT.exec(value);
    if (outer === null) {
        return undefined;
    }
    const group = parseHalf(outer[1] as string);
    const element = parseHalf(outer[2] as string);
    if (group === undefined || element === undefined) {
        return undefined;
    }
    return {
        groupLo: group.lo,
        groupHi: group.hi,
        groupParity: group.parity,
        elementLo: element.lo,
        elementHi: element.hi,
        elementParity: element.parity,
    };
}

/**
 * Whether a tag falls inside a range, honouring parity on both halves.
 *
 * Parity is the part implementations get wrong: an **odd** group inside
 * `6000-60FF` is a private tag and must not resolve to the overlay definition
 * (the defect behind `@ubercode/dcmtk#47`), while `(0009-o-FFFF,0000)` matches
 * odd groups *only*.
 *
 * @param tag - The tag to test
 * @param range - The range
 * @returns `true` when the tag is covered
 */
export function isInTagRange(tag: TagLike, range: TagRange): boolean {
    const resolved = toTag(tag);
    const group = Math.floor(resolved / 0x10000);
    const element = resolved % 0x10000;
    if (group < range.groupLo || group > range.groupHi || !matchesParity(group, range.groupParity)) {
        return false;
    }
    return element >= range.elementLo && element <= range.elementHi && matchesParity(element, range.elementParity);
}

/**
 * Renders a range back to dictionary notation. Round-trips with
 * {@link toTagRange}.
 *
 * @param range - The range
 * @returns The range text
 */
export function tagRangeToString(range: TagRange): string {
    const group = formatHalf(range.groupLo, range.groupHi, range.groupParity);
    const element = formatHalf(range.elementLo, range.elementHi, range.elementParity);
    return `(${group},${element})`;
}

/**
 * The lowest tag a range actually covers — its canonical identity.
 *
 * Preferred over DCMTK's `60FF` style representative because the lower bound is
 * a tag that occurs in real files (the first overlay group is always `6000`),
 * it sorts correctly against its neighbours, and it generalises to element
 * ranges. Parity is respected: an odd-only range starting at an even bound
 * begins at the next odd value.
 *
 * @param range - The range
 * @returns The lowest covered tag
 */
export function tagRangeBase(range: TagRange): Tag {
    const group = matchesParity(range.groupLo, range.groupParity) ? range.groupLo : range.groupLo + 1;
    const element = matchesParity(range.elementLo, range.elementParity) ? range.elementLo : range.elementLo + 1;
    return group * 0x10000 + element;
}

/**
 * How many tags a range covers. Used to order overlapping ranges narrowest
 * first, so `(6000-60FF,0010)` wins over the `(0000-u-FFFF,0000)` catch-all.
 *
 * @param range - The range
 * @returns The number of tags covered
 */
export function tagRangeSize(range: TagRange): number {
    const span = (lo: number, hi: number, parity: Parity): number => {
        const total = hi - lo + 1;
        return parity === 'any' ? total : Math.ceil((total - (matchesParity(lo, parity) ? 0 : 1)) / 2);
    };
    return span(range.groupLo, range.groupHi, range.groupParity) * span(range.elementLo, range.elementHi, range.elementParity);
}
