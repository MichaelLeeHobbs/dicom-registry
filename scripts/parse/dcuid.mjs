/**
 * Parses DCMTK's `uidNameMap[]` into normalized UID records.
 *
 * This table is why the registry sources UIDs from DCMTK rather than from
 * PS3.6 Annex A: alongside the UID and the official keyword it carries a
 * **classification** — service subtype (storage / query-retrieve / worklist /
 * print / colour palette) and IOD type (image / structured report / waveform /
 * presentation state / encapsulated) — which the Standard does not publish as
 * data. That classification is what replaces hand-written `isXStorage`
 * predicate walls.
 *
 * Column #3 is DCMTK's own short name, and is exactly the token used in
 * association configuration files (`JPEGBaseline`,
 * `JPEGLossless:Non-hierarchical:Process14`). It is not derivable from
 * anything else, so it is preserved verbatim.
 */

import {
    CParseError,
    extractArrayBody,
    parseEnumTokens,
    parseNumericDefines,
    parseStringDefines,
    parseStructFields,
    resolveEnum,
    resolveFlags,
    resolveNullableString,
    resolveString,
    splitTopLevel,
    stripComments,
    unwrapBraces,
} from './cSource.mjs';

const STANDARD = { EUS_DICOM: 'DICOM', EUS_DICONDE: 'DICONDE', EUS_DICOS: 'DICOS', EUS_other: 'other' };
const VALIDITY = { EUV_Standard: 'standard', EUV_Retired: 'retired', EUV_Draft: 'draft', EUV_Private: 'private', EUV_other: 'other' };
const TYPE = {
    EUT_ApplicationContextName: 'applicationContext',
    EUT_ApplicationHosting: 'applicationHosting',
    EUT_CodingScheme: 'codingScheme',
    EUT_ContextGroup: 'contextGroup',
    EUT_FrameOfReference: 'frameOfReference',
    EUT_LDAP: 'ldap',
    EUT_MappingResource: 'mappingResource',
    EUT_MetaSOPClass: 'metaSopClass',
    EUT_SOPClass: 'sopClass',
    EUT_SOPInstance: 'sopInstance',
    EUT_ServiceClass: 'serviceClass',
    EUT_TransferSyntax: 'transferSyntax',
    EUT_other: 'other',
};
/** The SERVICE axis: what protocol role the UID plays. */
const SUBTYPE = {
    EUST_Storage: 'storage',
    EUST_QueryRetrieve: 'queryRetrieve',
    EUST_Worklist: 'worklist',
    EUST_PrintManagement: 'printManagement',
    EUST_ColorPalette: 'colorPalette',
    EUST_other: null,
};
/** The CONTENT axis: what kind of object it is. Orthogonal to {@link SUBTYPE}. */
const IOD_TYPE = {
    EUIT_Image: 'image',
    EUIT_StructuredReport: 'structuredReport',
    EUIT_Waveform: 'waveform',
    EUIT_PresentationState: 'presentationState',
    EUIT_Encapsulated: 'encapsulated',
    EUIT_other: null,
};
const FLAGS = {
    UID_PROP_NON_PATIENT: 'nonPatient',
    UID_PROP_NO_DIR_RECORD: 'noDirectoryRecord',
    UID_PROP_ENHANCED_MF: 'enhancedMultiframe',
};

function mapEnum(token, table, field) {
    const value = table[token];
    if (value === undefined) {
        throw new CParseError(`${field}: no mapping for enum member '${token}'`);
    }
    return value;
}

function mapFlags(names) {
    return names.map(name => {
        const mapped = FLAGS[name];
        if (mapped === undefined) {
            throw new CParseError(`no mapping for flag '${name}'`);
        }
        return mapped;
    });
}

/** Splits the nested `{ EUS_*, EUV_*, ... }` properties group by declared field name. */
function parseProperties(expr, fieldOrder, index) {
    const values = splitTopLevel(unwrapBraces(expr, `uidNameMap[${index}].properties`));
    if (values.length !== fieldOrder.length) {
        throw new CParseError(`uidNameMap[${index}].properties: expected ${fieldOrder.length} fields, got ${values.length}`);
    }
    return Object.fromEntries(fieldOrder.map((name, i) => [name, values[i]]));
}

function toRecord(fields, properties, context) {
    const { macros, enums, flagMacros } = context;
    const uid = resolveString(fields.uid, macros);
    if (uid === undefined) {
        throw new CParseError(`uid is not a string expression: '${fields.uid}'`);
    }
    return {
        uid,
        // DCMTK writes NULL where no official PS3.6 keyword exists (e.g. a
        // private transfer syntax); that is data, not a parse failure
        keyword: resolveNullableString(fields.keyword, macros, 'keyword'),
        dcmtkName: resolveNullableString(fields.name, macros, 'name'),
        standard: mapEnum(resolveEnum(properties.standard, 'EUS_', enums), STANDARD, 'standard'),
        status: mapEnum(resolveEnum(properties.validity, 'EUV_', enums), VALIDITY, 'validity'),
        type: mapEnum(resolveEnum(properties.uidType, 'EUT_', enums), TYPE, 'uidType'),
        service: mapEnum(resolveEnum(properties.subType, 'EUST_', enums), SUBTYPE, 'subType'),
        iodType: mapEnum(resolveEnum(properties.iodType, 'EUIT_', enums), IOD_TYPE, 'iodType'),
        flags: mapFlags(resolveFlags(properties.otherFlags, flagMacros)),
    };
}

/**
 * Parses the UID table.
 *
 * @param cc - contents of `dcmdata/libsrc/dcuid.cc`
 * @param header - contents of `dcmdata/include/dcmtk/dcmdata/dcuid.h`
 * @returns `{ entries, fieldOrder, propertyFieldOrder }`
 */
export function parseUids(cc, header) {
    const source = stripComments(cc);
    const cleanHeader = stripComments(header);
    const context = {
        // UID literals live in the header; the table references them by macro
        macros: new Map([...parseStringDefines(cleanHeader), ...parseStringDefines(source)]),
        enums: parseEnumTokens(cleanHeader),
        flagMacros: parseNumericDefines(cleanHeader),
    };
    const fieldOrder = parseStructFields(`typedef struct {${/struct UIDNameMap\s*\{([\s\S]*?)\}/.exec(source)?.[1] ?? ''}} UIDNameMap;`, 'UIDNameMap');
    const propertyFieldOrder = parseStructFields(
        `typedef struct {${/struct DcmUIDProperties\s*\{([\s\S]*?)\}/.exec(cleanHeader)?.[1] ?? ''}} DcmUIDProperties;`,
        'DcmUIDProperties'
    );

    const entries = [];
    const records = splitTopLevel(extractArrayBody(source, 'uidNameMap'));
    for (const [index, record] of records.entries()) {
        const values = splitTopLevel(unwrapBraces(record, `uidNameMap[${index}]`));
        if (values.length !== fieldOrder.length) {
            throw new CParseError(`uidNameMap[${index}]: expected ${fieldOrder.length} fields (from the struct declaration), got ${values.length}`);
        }
        const fields = Object.fromEntries(fieldOrder.map((name, i) => [name, values[i]]));
        const properties = parseProperties(fields.properties, propertyFieldOrder, index);
        entries.push(toRecord(fields, properties, context));
    }

    return { entries, fieldOrder, propertyFieldOrder };
}
