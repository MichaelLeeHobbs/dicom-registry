/**
 * The DICOM UID registry: SOP classes, transfer syntaxes, service classes,
 * well-known instances — with the classification that lets callers ask
 * questions instead of pattern-matching UID prefixes.
 *
 * The classification is the point. `isSRStorage(uid)` written as
 * `uid.startsWith('1.2.840.10008.5.1.4.1.1.88')` silently misclassifies any
 * future non-SR class allocated under `.88`; here it is a lookup of a fact
 * DCMTK maintains.
 *
 * Two orthogonal axes are kept separate, because conflating them is what makes
 * such predicates proliferate:
 *
 * - {@link UidEntry.service} — the protocol role: storage, query/retrieve,
 *   worklist, print management, colour palette.
 * - {@link UidEntry.iodType} — the content: image, structured report,
 *   waveform, presentation state, encapsulated document.
 *
 * @module uid
 */

import { TRANSFER_SYNTAXES, type PackedTransferSyntax } from './generated/transferSyntaxes';
import { UIDS, type PackedUid } from './generated/uids';

/** Which standard defines a UID. */
export type UidStandard = 'DICOM' | 'DICONDE' | 'DICOS' | 'other';
/** Definition status of a UID. */
export type UidStatus = 'standard' | 'retired' | 'draft' | 'private' | 'other';
/** What kind of identifier a UID is. */
export type UidType =
    | 'applicationContext'
    | 'applicationHosting'
    | 'codingScheme'
    | 'contextGroup'
    | 'frameOfReference'
    | 'ldap'
    | 'mappingResource'
    | 'metaSopClass'
    | 'sopClass'
    | 'sopInstance'
    | 'serviceClass'
    | 'transferSyntax'
    | 'other';
/** The protocol role a SOP class plays. */
export type UidService = 'storage' | 'queryRetrieve' | 'worklist' | 'printManagement' | 'colorPalette';
/** The kind of content a storage SOP class carries. */
export type UidIodType = 'image' | 'structuredReport' | 'waveform' | 'presentationState' | 'encapsulated';
/** Extra properties DCMTK records for a UID. */
export type UidFlag = 'nonPatient' | 'noDirectoryRecord' | 'enhancedMultiframe';

/** One entry of the UID registry. */
export interface UidEntry {
    /** The UID itself, e.g. `1.2.840.10008.5.1.4.1.1.2`. */
    readonly uid: string;
    /** The official PS3.6 keyword, or `null` where the standard defines none. */
    readonly keyword: string | null;
    /**
     * DCMTK's short name. This is the token used in association configuration
     * files (`JPEGBaseline`, `JPEGLossless:Non-hierarchical:Process14`), and it
     * is not derivable from anything else.
     */
    readonly dcmtkName: string | null;
    readonly type: UidType;
    /** Protocol role, or `null` when the UID has none (e.g. a transfer syntax). */
    readonly service: UidService | null;
    /** Content kind, or `null` when not applicable. */
    readonly iodType: UidIodType | null;
    readonly status: UidStatus;
    readonly standard: UidStandard;
    readonly flags: readonly UidFlag[];
}

/** Encoding properties of a transfer syntax. */
export interface TransferSyntaxEntry {
    readonly uid: string;
    /** DCMTK's human-readable name, e.g. `JPEG Baseline`. */
    readonly name: string;
    /** The official PS3.6 keyword, when the UID registry has one. */
    readonly keyword: string | null;
    /** The association-config token. */
    readonly dcmtkName: string | null;
    /** `false` for the implicit-VR syntax. */
    readonly explicitVr: boolean;
    readonly byteOrder: 'little' | 'big' | 'unknown';
    /** `encapsulated` means pixel data is fragmented into items. */
    readonly pixelDataEncoding: 'native' | 'encapsulated' | 'referenced' | 'unknown';
    /**
     * Compression applied to the **pixel data**. Note the deflated syntax is
     * `none` here and `deflate` in {@link streamCompression} — deflate applies
     * to the whole stream, not to the pixels.
     */
    readonly pixelDataCompression: 'none' | 'lossless' | 'lossy' | 'unknown';
    /** Whether a frame may be split across several fragments. */
    readonly fragmentable: boolean;
    /** Compression applied to the entire byte stream. */
    readonly streamCompression: 'none' | 'deflate' | 'unsupported';
    readonly status: UidStatus | 'internal' | 'unknown';
    readonly mimeType: string;
    readonly filenameExtension: string;
}

function toUidEntry(row: PackedUid): UidEntry {
    return {
        uid: row[0],
        keyword: row[1],
        dcmtkName: row[2],
        type: row[3] as UidType,
        service: row[4] as UidService | null,
        iodType: row[5] as UidIodType | null,
        status: row[6] as UidStatus,
        standard: row[7] as UidStandard,
        flags: row[8] as readonly UidFlag[],
    };
}

function toTransferSyntaxEntry(row: PackedTransferSyntax): TransferSyntaxEntry {
    return {
        uid: row[0],
        name: row[1],
        keyword: row[2],
        dcmtkName: row[3],
        explicitVr: row[4],
        byteOrder: row[5] as TransferSyntaxEntry['byteOrder'],
        pixelDataEncoding: row[6] as TransferSyntaxEntry['pixelDataEncoding'],
        pixelDataCompression: row[7] as TransferSyntaxEntry['pixelDataCompression'],
        fragmentable: row[8],
        streamCompression: row[9] as TransferSyntaxEntry['streamCompression'],
        status: row[10] as TransferSyntaxEntry['status'],
        mimeType: row[11],
        filenameExtension: row[12],
    };
}

let uidIndex: ReadonlyMap<string, UidEntry> | undefined;
let keywordIndex: ReadonlyMap<string, UidEntry> | undefined;
let transferSyntaxIndex: ReadonlyMap<string, TransferSyntaxEntry> | undefined;

/** Indexes are built on first use so importing the module stays cheap. */
function uids(): ReadonlyMap<string, UidEntry> {
    uidIndex ??= new Map(UIDS.map(row => [row[0], toUidEntry(row)]));
    return uidIndex;
}

function keywords(): ReadonlyMap<string, UidEntry> {
    if (keywordIndex === undefined) {
        const map = new Map<string, UidEntry>();
        for (const entry of uids().values()) {
            if (entry.keyword !== null) {
                map.set(entry.keyword, entry);
            }
        }
        keywordIndex = map;
    }
    return keywordIndex;
}

function transferSyntaxes(): ReadonlyMap<string, TransferSyntaxEntry> {
    transferSyntaxIndex ??= new Map(TRANSFER_SYNTAXES.map(row => [row[0], toTransferSyntaxEntry(row)]));
    return transferSyntaxIndex;
}

/**
 * Looks up a UID.
 *
 * @param uid - The UID, e.g. `1.2.840.10008.5.1.4.1.1.2`
 * @returns The entry, or `undefined` when the UID is not in the registry
 */
export function lookupUid(uid: string): UidEntry | undefined {
    return uids().get(uid);
}

/**
 * Looks up a UID by its official PS3.6 keyword.
 *
 * @param keyword - The keyword, e.g. `CTImageStorage`
 * @returns The entry, or `undefined` for an unknown keyword
 */
export function lookupUidByKeyword(keyword: string): UidEntry | undefined {
    return keywords().get(keyword);
}

/** Every entry in the registry, in source order. */
export function allUids(): readonly UidEntry[] {
    return [...uids().values()];
}

/** Filter accepted by {@link findUids}. Omitted fields are not constrained. */
export interface UidQuery {
    readonly type?: UidType;
    readonly service?: UidService;
    readonly iodType?: UidIodType;
    readonly status?: UidStatus;
    readonly standard?: UidStandard;
}

/**
 * Finds every UID matching a filter.
 *
 * This is what replaces a wall of hand-written predicates: "all image storage
 * classes" is a query, not twenty functions that must each be updated when the
 * standard adds a class.
 *
 * @param query - Fields to match; omitted fields match anything
 * @returns Matching entries in registry order
 * @example
 * ```ts
 * findUids({ type: 'sopClass', service: 'storage', iodType: 'image' });
 * ```
 */
export function findUids(query: UidQuery): readonly UidEntry[] {
    return allUids().filter(
        entry =>
            (query.type === undefined || entry.type === query.type) &&
            (query.service === undefined || entry.service === query.service) &&
            (query.iodType === undefined || entry.iodType === query.iodType) &&
            (query.status === undefined || entry.status === query.status) &&
            (query.standard === undefined || entry.standard === query.standard)
    );
}

/**
 * Whether a UID is a storage SOP class.
 *
 * @param uid - The UID to test
 * @returns `true` for storage SOP classes
 */
export function isStorageSopClass(uid: string): boolean {
    const entry = lookupUid(uid);
    return entry?.type === 'sopClass' && entry.service === 'storage';
}

/**
 * The content kind of a SOP class — image, structured report, waveform,
 * presentation state or encapsulated document.
 *
 * @param uid - The SOP class UID
 * @returns The content kind, or `undefined` when unknown or not applicable
 */
export function sopClassIodType(uid: string): UidIodType | undefined {
    return lookupUid(uid)?.iodType ?? undefined;
}

/**
 * Looks up a transfer syntax's encoding properties.
 *
 * @param uid - The transfer syntax UID
 * @returns The entry, or `undefined` when DCMTK defines no properties for it
 */
export function lookupTransferSyntax(uid: string): TransferSyntaxEntry | undefined {
    return transferSyntaxes().get(uid);
}

/** Every transfer syntax with known properties. */
export function allTransferSyntaxes(): readonly TransferSyntaxEntry[] {
    return [...transferSyntaxes().values()];
}

/**
 * Whether a transfer syntax carries encapsulated (fragmented) pixel data.
 *
 * Replaces hardcoded native-syntax lists, which silently misclassify every
 * syntax added after they were written.
 *
 * @param uid - The transfer syntax UID
 * @returns `true` when pixel data is encapsulated; `false` when native or unknown
 */
export function isEncapsulated(uid: string): boolean {
    return lookupTransferSyntax(uid)?.pixelDataEncoding === 'encapsulated';
}

/**
 * Whether a transfer syntax stores pixel data natively (contiguous, unfragmented).
 *
 * @param uid - The transfer syntax UID
 * @returns `true` for native pixel data
 */
export function isNativePixelData(uid: string): boolean {
    return lookupTransferSyntax(uid)?.pixelDataEncoding === 'native';
}

/**
 * Whether a transfer syntax uses explicit VR encoding.
 *
 * @param uid - The transfer syntax UID
 * @returns `true` for explicit VR; `false` for implicit VR or an unknown syntax
 */
export function isExplicitVr(uid: string): boolean {
    return lookupTransferSyntax(uid)?.explicitVr === true;
}

/**
 * Whether the whole byte stream is deflate-compressed.
 *
 * @param uid - The transfer syntax UID
 * @returns `true` for the Deflated Explicit VR Little Endian syntax
 */
export function isDeflated(uid: string): boolean {
    return lookupTransferSyntax(uid)?.streamCompression === 'deflate';
}

/**
 * Whether a transfer syntax compresses pixel data lossily.
 *
 * @param uid - The transfer syntax UID
 * @returns `true` only when the syntax is known to be lossy
 */
export function isLossy(uid: string): boolean {
    return lookupTransferSyntax(uid)?.pixelDataCompression === 'lossy';
}

/**
 * Looks up a transfer syntax by DCMTK's association-config token.
 *
 * @param dcmtkName - The token, e.g. `JPEGBaseline`
 * @returns The entry, or `undefined` when no syntax uses that token
 */
export function transferSyntaxByDcmtkName(dcmtkName: string): TransferSyntaxEntry | undefined {
    return allTransferSyntaxes().find(entry => entry.dcmtkName === dcmtkName);
}

export { PROVENANCE } from './generated/provenance';
