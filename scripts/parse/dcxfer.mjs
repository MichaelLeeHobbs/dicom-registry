/**
 * Parses DCMTK's `XferNames[]` table into normalized transfer syntax records.
 *
 * This is the dataset that removes hardcoded lists like dicom-parser's
 * `NATIVE_TRANSFER_SYNTAXES` and the hand-maintained syntax lists in a DCMTK
 * association config: every property a caller normally re-derives (explicit
 * VR? encapsulated? lossy? deflated?) is stated in the source table, along with
 * the DCMTK config token, MIME type and file extension, none of which are
 * derivable from the UID.
 *
 * Note the DCMTK association-config token (`JPEGBaseline`,
 * `JPEGLossless:Non-hierarchical:Process14`) is NOT here and is not derivable
 * from the `EXS_` enum — it is column #3 of `uidNameMap` in dcuid.cc, and is
 * joined on by UID when the datasets are merged.
 */

import {
    CParseError,
    applyConditionals,
    extractArrayBody,
    parseEnumMembers,
    parseStringDefines,
    parseStructFields,
    resolveBool,
    resolveEnum,
    resolveInt,
    resolveString,
    splitTopLevel,
    stripComments,
    unwrapBraces,
} from './cSource.mjs';

/**
 * `WITH_ZLIB` is treated as defined, deliberately.
 *
 * Without it DCMTK reports the Deflated transfer syntax's stream compression as
 * `ESC_unsupported`, which is a statement about how that build was configured,
 * not about DICOM. The syntax is deflate-compressed by definition, so the
 * registry records the fact and leaves capability to the consumer.
 */
const DEFINED_MACROS = new Set(['WITH_ZLIB']);

const BYTE_ORDER = { EBO_unknown: 'unknown', EBO_LittleEndian: 'little', EBO_BigEndian: 'big' };
const VR_TYPE = { EVT_Implicit: false, EVT_Explicit: true };
const ENCODING = { EPE_unknown: 'unknown', EPE_Native: 'native', EPE_Encapsulated: 'encapsulated', EPE_Referenced: 'referenced' };
const COMPRESSION = {
    EPC_unknown: 'unknown',
    EPC_Uncompressed: 'none',
    EPC_LosslessCompressed: 'lossless',
    EPC_LossyCompressed: 'lossy',
};
const STREAM_COMPRESSION = { ESC_none: 'none', ESC_unsupported: 'unsupported', ESC_zlib: 'deflate' };
const VALIDITY = {
    EXV_unknown: 'unknown',
    EXV_Internal: 'internal',
    EXV_Standard: 'standard',
    EXV_Retired: 'retired',
    EXV_Private: 'private',
};

/** Maps an enum token through a lookup, failing loudly on an unmodelled state. */
function mapEnum(token, table, field) {
    const value = table[token];
    if (value === undefined) {
        throw new CParseError(`${field}: no mapping for enum member '${token}'`);
    }
    return value;
}

function toRecord(fields, macros, enums) {
    const uid = resolveString(fields.xferID, macros);
    if (uid === undefined) {
        throw new CParseError(`xferID is not a string expression: '${fields.xferID}'`);
    }
    const name = resolveString(fields.xferName, macros);
    const enumToken = fields.xfer.trim();
    const mime = resolveString(fields.mimeType, macros);
    const extension = resolveString(fields.filenameExtension, macros);
    return {
        uid,
        name,
        dcmtkEnum: enumToken,
        explicitVr: mapEnum(resolveEnum(fields.vrType, 'EVT_', enums), VR_TYPE, 'vrType'),
        byteOrder: mapEnum(resolveEnum(fields.byteOrder, 'EBO_', enums), BYTE_ORDER, 'byteOrder'),
        pixelDataByteOrder: mapEnum(resolveEnum(fields.pixelDataByteOrder, 'EBO_', enums), BYTE_ORDER, 'pixelDataByteOrder'),
        pixelDataEncoding: mapEnum(resolveEnum(fields.pixelDataEncoding, 'EPE_', enums), ENCODING, 'pixelDataEncoding'),
        compression: mapEnum(resolveEnum(fields.pixelDataCompression, 'EPC_', enums), COMPRESSION, 'pixelDataCompression'),
        fragmentable: resolveBool(fields.pixelDataFragmentable),
        jpegProcess8: resolveInt(fields.JPEGProcess8),
        jpegProcess12: resolveInt(fields.JPEGProcess12),
        streamCompression: mapEnum(resolveEnum(fields.streamCompression, 'ESC_', enums), STREAM_COMPRESSION, 'streamCompression'),
        status: mapEnum(resolveEnum(fields.xferValidity, 'EXV_', enums), VALIDITY, 'xferValidity'),
        mimeType: mime,
        filenameExtension: extension,
    };
}

/**
 * Parses the transfer syntax table.
 *
 * @param cc - contents of `dcmdata/libsrc/dcxfer.cc`
 * @param header - contents of `dcmdata/include/dcmtk/dcmdata/dcxfer.h`
 * @param uidHeader - contents of `dcuid.h`, which defines the `UID_*` literals
 * @returns `{ entries, fieldOrder, notes }`
 */
export function parseTransferSyntaxes(cc, header, uidHeader) {
    const source = applyConditionals(stripComments(cc), DEFINED_MACROS);
    const macros = new Map([...parseStringDefines(uidHeader), ...parseStringDefines(cc)]);
    const enums = new Map([...parseEnumMembers(applyConditionals(stripComments(header), DEFINED_MACROS)), ...parseEnumMembers(source)]);
    const fieldOrder = parseStructFields(source, 'S_XferNames');

    const entries = [];
    const records = splitTopLevel(extractArrayBody(source, 'XferNames'));
    for (const [index, record] of records.entries()) {
        const values = splitTopLevel(unwrapBraces(record, `XferNames[${index}]`));
        if (values.length !== fieldOrder.length) {
            throw new CParseError(`XferNames[${index}]: expected ${fieldOrder.length} fields (from the struct declaration), got ${values.length}`);
        }
        const fields = Object.fromEntries(fieldOrder.map((name, i) => [name, values[i]]));
        entries.push(toRecord(fields, macros, enums));
    }

    return {
        entries,
        fieldOrder,
        notes: [`dcxfer.cc parsed with WITH_ZLIB defined, so the deflated syntax reports streamCompression 'deflate' rather than 'unsupported'`],
    };
}
