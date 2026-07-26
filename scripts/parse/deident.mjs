/**
 * Parses innolitics' `confidentiality_profile_attributes.json` — PS3.15
 * Annex E Table E.1-1, the de-identification action table.
 *
 * DCMTK has no data equivalent; its de-identification lives in `dcmodify` and
 * `dcmanon` logic rather than in a table, so this is the only machine-readable
 * source for it.
 *
 * The table is two things at once. The **Basic Profile** column gives the
 * baseline action for every attribute, and ten further columns each describe
 * one *retained option* — what changes if a de-identifier chooses to keep
 * device identifiers, or long dates, or UIDs. An implementation that reads only
 * the basic profile cannot support any option, which is most real use.
 */

import { normalizeGroupWildcard } from './tagNotation.mjs';

/**
 * PS3.15 §E.1 action codes.
 *
 * `X/Z` and friends are alternations: "X unless Z is needed to keep the IOD
 * conformant". They are kept as ordered alternatives rather than resolved,
 * because only the caller knows which IOD it is writing.
 */
const ACTION_CODES = new Set(['X', 'Z', 'D', 'U', 'K', 'C']);

/** The ten retained options, in PS3.15 column order. */
const OPTIONS = [
    ['cleanDescOpt', 'cleanDescriptors'],
    ['cleanStructContOpt', 'cleanStructuredContent'],
    ['rtnLongFullDatesOpt', 'retainLongitudinalFullDates'],
    ['rtnLongModifDatesOpt', 'retainLongitudinalModifiedDates'],
    ['rtnUIDsOpt', 'retainUids'],
    ['rtnPatCharsOpt', 'retainPatientCharacteristics'],
    ['rtnDevIdOpt', 'retainDeviceIdentity'],
    ['rtnInstIdOpt', 'retainInstitutionIdentity'],
    ['cleanGraphOpt', 'cleanGraphics'],
    ['rtnSafePrivOpt', 'retainSafePrivate'],
];

/** The catch-all row for private attributes, which has no tag notation. */
const PRIVATE_ATTRIBUTES = '(GGGG,EEEE) WHERE GGGG IS ODD';

/** Thrown when a profile row cannot be read. Never a bare string. */
export class DeidentParseError extends Error {
    constructor(message, row) {
        super(`${message} (${JSON.stringify(row)})`);
        this.name = 'DeidentParseError';
        this.row = row;
    }
}

/**
 * Collapses whitespace in a name.
 *
 * PS3.15's table puts footnote references on their own line inside the cell, so
 * one name arrives as `Icon Image Sequence\n\n(see Note 11)`. The footnote is
 * part of the standard's text and is kept; the line breaks are a transcription
 * artifact of the table markup and are not.
 */
function normalizeName(name) {
    return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
}

/** Splits an action cell into its ordered alternatives: `X/Z/U*` → X, Z, U. */
function parseAction(text, row) {
    // the trailing * on X/Z/U* marks the "clean" variant of U; the codes are
    // what an implementation acts on, and the marker is kept in `source`
    const codes = text.replace(/\*/g, '').split('/');
    for (const code of codes) {
        if (!ACTION_CODES.has(code)) {
            throw new DeidentParseError(`unknown action code '${code}' in '${text}'`, row);
        }
    }
    return { source: text, codes };
}

/**
 * Parses the confidentiality profile table.
 *
 * @param source - Contents of `confidentiality_profile_attributes.json`
 * @returns `{ entries, notes }`
 */
export function parseDeidentification(source) {
    const rows = JSON.parse(source);
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error('parseDeidentification: the profile table is not a non-empty array');
    }
    const entries = [];
    const notes = [];
    for (const row of rows) {
        const { tag, name, stdCompIOD, basicProfile } = row;
        if (typeof tag !== 'string' || typeof basicProfile !== 'string') {
            throw new DeidentParseError('missing tag or basic profile action', row);
        }
        let tagText;
        if (tag === PRIVATE_ATTRIBUTES) {
            // PS3.15 states this one in prose; odd groups are private by
            // definition, and the range notation says exactly that
            tagText = '(0001-o-FFFF,0000-u-FFFF)';
            notes.push(`PS3.15 states the private-attribute row as prose ('${tag}'); emitted as ${tagText}`);
        } else {
            tagText = normalizeGroupWildcard(tag);
            if (tagText !== tag) {
                notes.push(`PS3.15 ${tag} (${name}) is a repeating group; emitted as ${tagText} because odd groups are private`);
            }
        }
        const options = {};
        for (const [column, option] of OPTIONS) {
            const cell = row[column];
            if (cell !== undefined && cell !== '') {
                options[option] = parseAction(cell, row);
            }
        }
        const cleanName = normalizeName(name);
        if (cleanName !== name) {
            notes.push(`PS3.15 ${tagText} carries a name with embedded line breaks; collapsed to '${cleanName}'`);
        }
        entries.push({
            tag: tagText,
            name: cleanName === '' ? null : cleanName,
            inStandardIod: stdCompIOD === 'Y',
            basicProfile: parseAction(basicProfile, row),
            options,
        });
    }
    return { entries, notes };
}

/** The option names this parser emits, for the generated type. */
export const OPTION_NAMES = OPTIONS.map(([, option]) => option);
