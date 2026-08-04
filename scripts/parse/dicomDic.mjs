/**
 * Parses DCMTK's `dicom.dic` — the tag dictionary — into normalized records.
 *
 * The file is tab-separated: `tag <TAB> VR <TAB> keyword <TAB> VM <TAB> standard`.
 * Two things in it are not available from the standard's own machine-readable
 * form and are the reason this source is parsed at all:
 *
 * 1. **Explicit repeating-group ranges.** `(6000-60FF,0010)` states the bounds
 *    and the stride; PS3.6 writes `(60XX,0010)`, which states neither. Losing
 *    that is what produced the `@ubercode/dcmtk#47` defect, where an odd group
 *    inside the overlay range resolved to the overlay definition instead of
 *    being recognized as private.
 * 2. **Entries PS3.6 does not contain at all** — the PS3.7 command group,
 *    DICONDE, DICOS, and the private/illegal/generic group-length patterns.
 *
 * The VR column uses DCMTK's internal codes where the standard leaves a VR
 * ambiguous (`ox`, `xs`, `lt`, `px`, `up`, `na`). They are expanded here rather
 * than collapsed to a single VR — collapsing is precisely the fidelity loss
 * this registry exists to undo.
 */

/** DCMTK's internal VR codes, expanded to the VRs they stand for. */
const PSEUDO_VR = {
    // OB or OW — generic "other" binary, used where the standard permits either
    ox: ['OB', 'OW'],
    // US or SS — signedness follows PixelRepresentation (0028,0103)
    xs: ['US', 'SS'],
    // the lookup-table family; PS3.6 narrows this per attribute, so innolitics
    // is the better source for the two rows that carry it
    lt: ['US', 'SS', 'OW'],
    // pixel data — OB or OW depending on BitsAllocated and the transfer syntax
    px: ['OB', 'OW'],
    // an unsigned long that DCMTK tracks separately for internal reasons
    up: ['UL'],
    // not applicable: the FFFE item/sequence delimiters carry no value at all
    na: [],
};

/** Every VR defined by PS3.5, including the 2019 additions SV/UV/OV. */
const STANDARD_VRS = new Set([
    'AE', 'AS', 'AT', 'CS', 'DA', 'DS', 'DT', 'FD', 'FL', 'IS', 'LO', 'LT',
    'OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'PN', 'SH', 'SL', 'SQ', 'SS', 'ST',
    'SV', 'TM', 'UC', 'UI', 'UL', 'UN', 'UR', 'US', 'UT', 'UV',
]);

/** Thrown when a dictionary row cannot be read. Never a bare string. */
export class DictParseError extends Error {
    constructor(message, line, lineNumber) {
        super(`${message} (dicom.dic:${lineNumber}: ${JSON.stringify(line)})`);
        this.name = 'DictParseError';
        this.line = line;
        this.lineNumber = lineNumber;
    }
}

/**
 * Splits the `standard` column into its facts.
 *
 * `DICOM/retired` is two statements in one field: which standard defines the
 * attribute, and whether it is still current.
 */
function parseStandard(text, line, lineNumber) {
    const known = {
        DICOM: { standard: 'DICOM', retired: false },
        'DICOM/retired': { standard: 'DICOM', retired: true },
        'DICOM/DICONDE': { standard: 'DICONDE', retired: false },
        'DICOM/DICOS': { standard: 'DICOS', retired: false },
        PRIVATE: { standard: 'PRIVATE', retired: false },
        ILLEGAL: { standard: 'ILLEGAL', retired: false },
        GENERIC: { standard: 'GENERIC', retired: false },
    };
    const parsed = known[text];
    if (parsed === undefined) {
        throw new DictParseError(`unknown standard column '${text}'`, line, lineNumber);
    }
    return parsed;
}

/** Expands the VR column, keeping ambiguity rather than resolving it. */
function parseVr(text, line, lineNumber) {
    const pseudo = PSEUDO_VR[text];
    if (pseudo !== undefined) {
        return { vr: pseudo, pseudoVr: text };
    }
    if (!STANDARD_VRS.has(text)) {
        throw new DictParseError(`unknown VR '${text}'`, line, lineNumber);
    }
    return { vr: [text], pseudoVr: null };
}

/**
 * Parses the whole dictionary.
 *
 * @param source - Contents of `dicom.dic`
 * @returns `{ entries, notes }`
 */
export function parseDicomDic(source) {
    const entries = [];
    const notes = [];
    const lines = source.split('\n');
    for (let index = 0; index < lines.length; index++) {
        const line = (lines[index] ?? '').replace(/\r$/, '');
        if (line.trim() === '' || line.startsWith('#')) {
            continue;
        }
        const columns = line.split('\t');
        if (columns.length !== 5) {
            throw new DictParseError(`expected 5 tab-separated columns, found ${columns.length}`, line, index + 1);
        }
        const [tagText, vrText, dcmtkKeyword, vm, standardText] = columns;
        const { standard, retired } = parseStandard(standardText, line, index + 1);
        const { vr, pseudoVr } = parseVr(vrText, line, index + 1);
        // DCMTK prefixes retired keywords with RETIRED_; the official PS3.6
        // keyword is the bare one, and it is what every other source uses
        const keyword = dcmtkKeyword.replace(/^RETIRED_/, '');
        if (keyword !== dcmtkKeyword && !retired) {
            notes.push(`dicom.dic ${tagText} is named RETIRED_${keyword} but its standard column says '${standardText}'`);
        }
        entries.push({ tagText, vr, pseudoVr, keyword, dcmtkKeyword, vm, standard, retired });
    }
    if (entries.length === 0) {
        throw new Error('parseDicomDic: no rows parsed — the dictionary format changed');
    }
    return { entries, notes };
}
