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
 * An inclusive tag range: the repeating groups and wildcard tags that both
 * source dictionaries express, in one shape.
 *
 * Each half is `lo`, `hi` and a **stride**. A stride generalizes the two
 * notations the sources actually use, which no single narrower model covers:
 *
 * ```
 * (6000-60FF,0010)             DCMTK: even groups only  → step 2 from an even lo
 * (0009-o-FFFF,0000)           DCMTK: odd groups only   → step 2 from an odd lo
 * (0000-u-FFFF,0000)           DCMTK: every group       → step 1
 * (0020,3100-31FF)             DCMTK: element range     → step 1
 * (60XX,0010)                  PS3.6: nibble wildcard   → step 1
 * (0028,04X1)                  PS3.6: nibble wildcard   → 0x0401..0x04F1 step 0x10
 * ```
 *
 * Parity is just `step === 2`; a wildcard over the *n*th nibble is
 * `step === 16 ** (nibbles to its right)`. Modelling parity as its own concept
 * would leave the twelve `(0028,04X1)`-style attributes inexpressible, since
 * their covered values are 16 apart rather than 1 or 2.
 *
 * A concrete tag is a range with `lo === hi` and `step === 1`, so there is only
 * ever one shape to handle.
 */
export interface TagRange {
    /** First group covered (inclusive). */
    readonly groupLo: number;
    /** Last group covered (inclusive). */
    readonly groupHi: number;
    /** Stride between covered groups; 1 for every group, 2 for parity. */
    readonly groupStep: number;
    /** First element covered (inclusive). */
    readonly elementLo: number;
    /** Last element covered (inclusive). */
    readonly elementHi: number;
    /** Stride between covered elements; 1 for every element. */
    readonly elementStep: number;
}

const TAG_MAX = 0xffffffff;
const PAREN = /^\(([0-9a-fA-F]{4}),([0-9a-fA-F]{4})\)$/;
const PREFIXED = /^[xX]([0-9a-fA-F]{8})$/;
const BARE = /^[0-9a-fA-F]{8}$/;
/** One half of a range: `6000`, `6000-60FF`, `0009-o-FFFF`, `0000-u-FFFF`. */
const RANGE_HALF = /^([0-9a-fA-F]{4})(?:-(?:([oOuUeE])-)?([0-9a-fA-F]{4}))?$/;
/** One half in PS3.6 wildcard notation: `60XX`, `04X1`. Hex either side forces a single run. */
const WILDCARD_HALF = /^([0-9a-fA-F]*)([xX]+)([0-9a-fA-F]*)$/;
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
    readonly step: number;
}

/**
 * Parses `6000`, `6000-60FF`, `0009-o-FFFF`, `0000-u-FFFF`.
 *
 * A bare range is even-only. That is not an inference from the dictionary
 * header's prose — `parseTagPart` in DCMTK's `dcdict.cc` assigns
 * `DcmDictRange_Even` when no restrictor is present, and it does so for the
 * element half as well as the group half. `-e-` is accepted there too, though
 * the header does not document it and no shipped row uses it.
 */
function parseDcmtkHalf(text: string): RangeHalf | undefined {
    const match = RANGE_HALF.exec(text);
    if (match === null) {
        return undefined;
    }
    const lo = Number.parseInt(match[1] as string, 16);
    if (match[3] === undefined) {
        return { lo, hi: lo, step: 1 }; // a concrete value, not a range
    }
    const hi = Number.parseInt(match[3], 16);
    if (hi < lo) {
        return undefined;
    }
    if (match[2] === 'u' || match[2] === 'U') {
        return { lo, hi, step: 1 };
    }
    // even unless `-o-`; `lo` is raised to the first value the range really
    // covers so that every covered value is exactly `lo + k * step`
    const wantOdd = match[2] === 'o' || match[2] === 'O';
    const base = lo % 2 === (wantOdd ? 1 : 0) ? lo : lo + 1;
    return base > hi ? undefined : { lo: base, hi, step: 2 };
}

/**
 * Parses PS3.6 wildcard notation — `60XX`, `04X1`, `XXX0`.
 *
 * The `X` run must be contiguous, which the pattern enforces by allowing only
 * hex digits either side of it. Every wildcard the standard uses is of this
 * shape, so the stride is `16 ** (nibbles to the right of the run)`.
 */
function parseWildcardHalf(text: string): RangeHalf | undefined {
    const match = text.length === 4 ? WILDCARD_HALF.exec(text) : null;
    if (match === null) {
        return undefined;
    }
    const [, prefix = '', wild = '', suffix = ''] = match;
    return {
        lo: Number.parseInt(`${prefix}${'0'.repeat(wild.length)}${suffix}`, 16),
        hi: Number.parseInt(`${prefix}${'f'.repeat(wild.length)}${suffix}`, 16),
        step: 16 ** suffix.length,
    };
}

function parseHalf(text: string): RangeHalf | undefined {
    return parseDcmtkHalf(text) ?? parseWildcardHalf(text);
}

/** Renders a half as a wildcard when it is exactly one, else in DCMTK notation. */
function formatHalf(lo: number, hi: number, step: number): string {
    if (lo === hi && step === 1) {
        return hex4(lo);
    }
    if (step >= 16) {
        const suffixLength = Math.round(Math.log2(step) / 4);
        const wildLength = Math.round(Math.log2((hi - lo) / step + 1) / 4);
        const text = hex4(lo);
        return `${text.slice(0, 4 - wildLength - suffixLength)}${'X'.repeat(wildLength)}${text.slice(4 - suffixLength)}`;
    }
    const infix = step === 1 ? '-u-' : lo % 2 === 1 ? '-o-' : '-';
    return `${hex4(lo)}${infix}${hex4(hi)}`;
}

function isInHalf(value: number, lo: number, hi: number, step: number): boolean {
    return value >= lo && value <= hi && (value - lo) % step === 0;
}

/**
 * Parses a tag range in either dictionary notation.
 *
 * Accepts DCMTK's form — including odd-only (`-o-`), unrestricted (`-u-`) and
 * element ranges — and PS3.6's wildcard form. See {@link TagRange}.
 *
 * @param value - The range text, e.g. `(6000-60FF,0010)` or `(0028,04X1)`
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
        groupStep: group.step,
        elementLo: element.lo,
        elementHi: element.hi,
        elementStep: element.step,
    };
}

/**
 * Whether a tag falls inside a range, honouring the stride on both halves.
 *
 * The stride is the part implementations get wrong: an **odd** group inside
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
    if (!isInHalf(group, range.groupLo, range.groupHi, range.groupStep)) {
        return false;
    }
    return isInHalf(resolved % 0x10000, range.elementLo, range.elementHi, range.elementStep);
}

/**
 * Renders a range back to dictionary notation. Round-trips with
 * {@link toTagRange}.
 *
 * @param range - The range
 * @returns The range text
 */
export function tagRangeToString(range: TagRange): string {
    const group = formatHalf(range.groupLo, range.groupHi, range.groupStep);
    const element = formatHalf(range.elementLo, range.elementHi, range.elementStep);
    return `(${group},${element})`;
}

/**
 * The lowest tag a range actually covers — its canonical identity.
 *
 * Preferred over DCMTK's `60FF` style representative because the lower bound is
 * a tag that occurs in real files (the first overlay group is always `6000`),
 * it sorts correctly against its neighbours, and it generalises to element
 * ranges.
 *
 * @param range - The range
 * @returns The lowest covered tag
 */
export function tagRangeBase(range: TagRange): Tag {
    return range.groupLo * 0x10000 + range.elementLo;
}

/**
 * How many tags a range covers. Used to order overlapping ranges narrowest
 * first, so `(6000-60FF,0010)` wins over the `(0000-u-FFFF,0000)` catch-all.
 *
 * @param range - The range
 * @returns The number of tags covered
 */
export function tagRangeSize(range: TagRange): number {
    const span = (lo: number, hi: number, step: number): number => Math.floor((hi - lo) / step) + 1;
    return span(range.groupLo, range.groupHi, range.groupStep) * span(range.elementLo, range.elementHi, range.elementStep);
}
