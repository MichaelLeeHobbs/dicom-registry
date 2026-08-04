/**
 * Value Representations and their encoding rules, from PS3.5 Table 6.2-1.
 *
 * This table is hand-curated rather than generated. It is ~34 rows that change
 * only when the standard adds a VR (three times since 1993), and the properties
 * a parser needs — how many bytes the length field occupies, what the padding
 * byte is, whether the value is affected by SpecificCharacterSet — are stated in
 * prose in PS3.5, not in any machine-readable source. Parsing DCMTK's `dcvr.cc`
 * to recover them would be more brittle than transcribing them once.
 *
 * The ambiguity resolver is the other half of this module. PS3.6 deliberately
 * leaves some attributes with more than one permitted VR — `US or SS`,
 * `OB or OW` — because the answer depends on other attributes in the same data
 * set. Implementations that pick one at dictionary-generation time (as
 * `@ubercode/dcmtk` did, collapsing `xs` to `US`) misread every signed data set.
 *
 * @module vr
 */

/** Every VR defined by PS3.5. */
export type Vr =
    | 'AE'
    | 'AS'
    | 'AT'
    | 'CS'
    | 'DA'
    | 'DS'
    | 'DT'
    | 'FD'
    | 'FL'
    | 'IS'
    | 'LO'
    | 'LT'
    | 'OB'
    | 'OD'
    | 'OF'
    | 'OL'
    | 'OV'
    | 'OW'
    | 'PN'
    | 'SH'
    | 'SL'
    | 'SQ'
    | 'SS'
    | 'ST'
    | 'SV'
    | 'TM'
    | 'UC'
    | 'UI'
    | 'UL'
    | 'UN'
    | 'UR'
    | 'US'
    | 'UT'
    | 'UV';

/** How a VR's value is encoded on the wire. */
export type VrKind = 'text' | 'numericString' | 'binary' | 'sequence' | 'other';

/** Encoding rules for one VR. */
export interface VrProperties {
    readonly vr: Vr;
    /**
     * `text` and `numericString` are character data; `binary` is fixed-width
     * numbers; `other` is an opaque byte stream (the OB/OW/OD/OF/OL/OV family);
     * `sequence` is SQ.
     */
    readonly kind: VrKind;
    /**
     * Bytes the length field occupies in explicit VR encoding — 2 for most,
     * **4** for the VRs that reserve two bytes after the VR code. Getting this
     * set wrong desynchronizes the parser for the rest of the data set.
     */
    readonly lengthBytes: 2 | 4;
    /** Bytes per value for fixed-width VRs, or `null` when variable. */
    readonly fixedLength: number | null;
    /** Longest permitted value in bytes, or `null` when unbounded. */
    readonly maxLength: number | null;
    /** Byte used to pad an odd-length value: space, NUL, or none. */
    readonly padding: 'space' | 'null' | 'none';
    /** Whether SpecificCharacterSet (0008,0005) changes how the value decodes. */
    readonly charsetAffected: boolean;
    /** Whether the VR can hold multiple `\`-delimited values. */
    readonly multiValued: boolean;
}

/**
 * PS3.5 Table 6.2-1.
 *
 * `lengthBytes: 4` is the VR set listed in PS3.5 §7.1.2 — OB, OD, OF, OL, OV,
 * OW, SQ, SV, UC, UN, UR, UT, UV — and nothing else.
 */
const TABLE: readonly VrProperties[] = [
    { vr: 'AE', kind: 'text', lengthBytes: 2, fixedLength: null, maxLength: 16, padding: 'space', charsetAffected: false, multiValued: true },
    { vr: 'AS', kind: 'text', lengthBytes: 2, fixedLength: 4, maxLength: 4, padding: 'none', charsetAffected: false, multiValued: true },
    { vr: 'AT', kind: 'binary', lengthBytes: 2, fixedLength: 4, maxLength: 4, padding: 'none', charsetAffected: false, multiValued: true },
    { vr: 'CS', kind: 'text', lengthBytes: 2, fixedLength: null, maxLength: 16, padding: 'space', charsetAffected: false, multiValued: true },
    { vr: 'DA', kind: 'text', lengthBytes: 2, fixedLength: 8, maxLength: 8, padding: 'space', charsetAffected: false, multiValued: true },
    { vr: 'DS', kind: 'numericString', lengthBytes: 2, fixedLength: null, maxLength: 16, padding: 'space', charsetAffected: false, multiValued: true },
    { vr: 'DT', kind: 'text', lengthBytes: 2, fixedLength: null, maxLength: 26, padding: 'space', charsetAffected: false, multiValued: true },
    { vr: 'FD', kind: 'binary', lengthBytes: 2, fixedLength: 8, maxLength: 8, padding: 'none', charsetAffected: false, multiValued: true },
    { vr: 'FL', kind: 'binary', lengthBytes: 2, fixedLength: 4, maxLength: 4, padding: 'none', charsetAffected: false, multiValued: true },
    { vr: 'IS', kind: 'numericString', lengthBytes: 2, fixedLength: null, maxLength: 12, padding: 'space', charsetAffected: false, multiValued: true },
    { vr: 'LO', kind: 'text', lengthBytes: 2, fixedLength: null, maxLength: 64, padding: 'space', charsetAffected: true, multiValued: true },
    { vr: 'LT', kind: 'text', lengthBytes: 2, fixedLength: null, maxLength: 10240, padding: 'space', charsetAffected: true, multiValued: false },
    { vr: 'OB', kind: 'other', lengthBytes: 4, fixedLength: null, maxLength: null, padding: 'null', charsetAffected: false, multiValued: false },
    { vr: 'OD', kind: 'other', lengthBytes: 4, fixedLength: null, maxLength: null, padding: 'none', charsetAffected: false, multiValued: false },
    { vr: 'OF', kind: 'other', lengthBytes: 4, fixedLength: null, maxLength: null, padding: 'none', charsetAffected: false, multiValued: false },
    { vr: 'OL', kind: 'other', lengthBytes: 4, fixedLength: null, maxLength: null, padding: 'none', charsetAffected: false, multiValued: false },
    { vr: 'OV', kind: 'other', lengthBytes: 4, fixedLength: null, maxLength: null, padding: 'none', charsetAffected: false, multiValued: false },
    { vr: 'OW', kind: 'other', lengthBytes: 4, fixedLength: null, maxLength: null, padding: 'none', charsetAffected: false, multiValued: false },
    { vr: 'PN', kind: 'text', lengthBytes: 2, fixedLength: null, maxLength: 194, padding: 'space', charsetAffected: true, multiValued: true },
    { vr: 'SH', kind: 'text', lengthBytes: 2, fixedLength: null, maxLength: 16, padding: 'space', charsetAffected: true, multiValued: true },
    { vr: 'SL', kind: 'binary', lengthBytes: 2, fixedLength: 4, maxLength: 4, padding: 'none', charsetAffected: false, multiValued: true },
    { vr: 'SQ', kind: 'sequence', lengthBytes: 4, fixedLength: null, maxLength: null, padding: 'none', charsetAffected: false, multiValued: false },
    { vr: 'SS', kind: 'binary', lengthBytes: 2, fixedLength: 2, maxLength: 2, padding: 'none', charsetAffected: false, multiValued: true },
    { vr: 'ST', kind: 'text', lengthBytes: 2, fixedLength: null, maxLength: 1024, padding: 'space', charsetAffected: true, multiValued: false },
    { vr: 'SV', kind: 'binary', lengthBytes: 4, fixedLength: 8, maxLength: 8, padding: 'none', charsetAffected: false, multiValued: true },
    { vr: 'TM', kind: 'text', lengthBytes: 2, fixedLength: null, maxLength: 14, padding: 'space', charsetAffected: false, multiValued: true },
    { vr: 'UC', kind: 'text', lengthBytes: 4, fixedLength: null, maxLength: null, padding: 'space', charsetAffected: true, multiValued: true },
    { vr: 'UI', kind: 'text', lengthBytes: 2, fixedLength: null, maxLength: 64, padding: 'null', charsetAffected: false, multiValued: true },
    { vr: 'UL', kind: 'binary', lengthBytes: 2, fixedLength: 4, maxLength: 4, padding: 'none', charsetAffected: false, multiValued: true },
    { vr: 'UN', kind: 'other', lengthBytes: 4, fixedLength: null, maxLength: null, padding: 'null', charsetAffected: false, multiValued: false },
    { vr: 'UR', kind: 'text', lengthBytes: 4, fixedLength: null, maxLength: null, padding: 'space', charsetAffected: false, multiValued: false },
    { vr: 'US', kind: 'binary', lengthBytes: 2, fixedLength: 2, maxLength: 2, padding: 'none', charsetAffected: false, multiValued: true },
    { vr: 'UT', kind: 'text', lengthBytes: 4, fixedLength: null, maxLength: null, padding: 'space', charsetAffected: true, multiValued: false },
    { vr: 'UV', kind: 'binary', lengthBytes: 4, fixedLength: 8, maxLength: 8, padding: 'none', charsetAffected: false, multiValued: true },
];

const BY_VR: ReadonlyMap<string, VrProperties> = new Map(TABLE.map(row => [row.vr, row]));

/**
 * Looks up a VR's encoding rules.
 *
 * @param vr - The two-letter VR code
 * @returns The properties, or `undefined` for a code PS3.5 does not define
 */
export function lookupVr(vr: string): VrProperties | undefined {
    return BY_VR.get(vr);
}

/** Every VR PS3.5 defines, in alphabetical order. */
export function allVrs(): readonly VrProperties[] {
    return TABLE;
}

/**
 * Whether a string is a VR PS3.5 defines.
 *
 * @param value - The candidate code
 * @returns `true` when the code is a known VR
 */
export function isVr(value: string): value is Vr {
    return BY_VR.has(value);
}

/**
 * Whether a VR reserves two bytes after the code and uses a 32-bit length.
 *
 * @param vr - The VR code
 * @returns `true` for OB, OD, OF, OL, OV, OW, SQ, SV, UC, UN, UR, UT and UV
 */
export function hasExtendedLength(vr: string): boolean {
    return lookupVr(vr)?.lengthBytes === 4;
}

/**
 * The data set context needed to resolve an ambiguous VR.
 *
 * Every field is optional because a caller rarely has all of them, and a
 * resolver that demands the full set is one that gets bypassed.
 */
export interface VrContext {
    /** PixelRepresentation (0028,0103): 0 unsigned, 1 signed. Resolves `US or SS`. */
    readonly pixelRepresentation?: 0 | 1;
    /** BitsAllocated (0028,0100). Resolves `OB or OW` for pixel data. */
    readonly bitsAllocated?: number;
    /** Whether the data set uses an encapsulated transfer syntax. */
    readonly encapsulated?: boolean;
}

function resolveSignedness(candidates: readonly Vr[], context: VrContext): Vr | undefined {
    if (context.pixelRepresentation === undefined) {
        return undefined;
    }
    const wanted = context.pixelRepresentation === 1 ? 'SS' : 'US';
    return candidates.includes(wanted) ? wanted : undefined;
}

function resolveWidth(candidates: readonly Vr[], context: VrContext): Vr | undefined {
    // encapsulated pixel data is always OB — it is a fragmented byte stream
    if (context.encapsulated === true && candidates.includes('OB')) {
        return 'OB';
    }
    if (context.bitsAllocated === undefined) {
        return undefined;
    }
    const wanted = context.bitsAllocated <= 8 ? 'OB' : 'OW';
    return candidates.includes(wanted) ? wanted : undefined;
}

/**
 * Resolves an ambiguous VR against the data set it appears in.
 *
 * The rules, in the order they are applied:
 *
 * 1. A single candidate resolves to itself.
 * 2. `US`/`SS` alternatives resolve by **PixelRepresentation** — `1` is signed.
 * 3. `OB`/`OW` alternatives resolve to `OB` under an encapsulated transfer
 *    syntax, otherwise by **BitsAllocated** (≤ 8 → `OB`).
 *
 * Returns `undefined` rather than guessing when the context does not decide it.
 * A caller that must produce something can fall back to the first candidate,
 * but that is its choice to make explicitly, not one buried in a lookup table.
 *
 * @param candidates - The permitted VRs, from the attribute's `vr` field
 * @param context - What is known about the surrounding data set
 * @returns The resolved VR, or `undefined` when the context is insufficient
 * @example
 * ```ts
 * resolveVr(['US', 'SS'], { pixelRepresentation: 1 }); // 'SS'
 * resolveVr(['OB', 'OW'], { encapsulated: true });     // 'OB'
 * resolveVr(['US', 'SS'], {});                         // undefined
 * ```
 */
export function resolveVr(candidates: readonly Vr[], context: VrContext): Vr | undefined {
    if (candidates.length === 0) {
        return undefined;
    }
    if (candidates.length === 1) {
        return candidates[0];
    }
    return resolveSignedness(candidates, context) ?? resolveWidth(candidates, context);
}
