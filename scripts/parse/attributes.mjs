/**
 * Parses innolitics' `attributes.json` — a transcription of PS3.6 Table 6-1.
 *
 * This is the authority for everything PS3.6 itself states: the official
 * keyword, the human-readable name, the VR (including the "US or SS" forms the
 * standard leaves ambiguous on purpose), the VM, and retirement.
 *
 * Three shapes in the file need explicit handling rather than a schema that
 * quietly accepts them:
 *
 * - **Rows with every field blank but the tag** — (0008,0202), (0018,9445),
 *   (0028,0020). PS3.6 lists these as retired with no replacement and no
 *   definition. They are real dictionary entries, not corrupt rows.
 * - **`See Note 2`** — the three FFFE delimitation items, which are data
 *   structure markers with no VR.
 * - **`1-n or 1`** — a VM that depends on which of the permitted VRs is in use.
 *   Both existing implementations flatten this; it is kept.
 */

/** VR alternation as PS3.6 spells it. */
const VR_SEPARATOR = ' or ';
/** Marks a row that carries no VR: the FFFE delimitation items. */
const NO_VR = 'See Note 2';

const TAG_TEXT = /^\(([0-9a-fA-FxX]{4}),([0-9a-fA-FxX]{4})\)$/;

/** Thrown when an attribute row cannot be read. Never a bare string. */
export class AttributeParseError extends Error {
    constructor(message, row) {
        super(`${message} (${JSON.stringify(row)})`);
        this.name = 'AttributeParseError';
        this.row = row;
    }
}

/**
 * Splits a VR cell into the VRs it permits.
 *
 * An empty result is meaningful — it says the standard defines no VR for this
 * entry — and is not the same as a VR we failed to read.
 */
function parseVr(text, row) {
    if (text === '' || text === NO_VR) {
        return [];
    }
    const parts = text.split(VR_SEPARATOR).map(part => part.trim());
    for (const part of parts) {
        if (!/^[A-Z]{2}$/.test(part)) {
            throw new AttributeParseError(`unreadable VR '${text}'`, row);
        }
    }
    return parts;
}

/**
 * Parses the attribute table.
 *
 * @param source - Contents of `attributes.json`
 * @returns `{ entries, notes }`
 */
export function parseAttributes(source) {
    const rows = JSON.parse(source);
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error('parseAttributes: attributes.json is not a non-empty array');
    }
    const entries = [];
    const notes = [];
    for (const row of rows) {
        const { tag: tagText, name, keyword, valueRepresentation, valueMultiplicity, retired } = row;
        if (typeof tagText !== 'string' || !TAG_TEXT.test(tagText)) {
            throw new AttributeParseError('missing or malformed tag', row);
        }
        if (retired !== 'Y' && retired !== 'N') {
            throw new AttributeParseError(`retired should be Y or N, found '${retired}'`, row);
        }
        const defined = keyword !== '';
        if (!defined) {
            notes.push(`PS3.6 lists ${tagText} with no keyword, name, VR or VM; kept as an undefined retired entry`);
        }
        entries.push({
            tagText,
            name: name === '' ? null : name,
            keyword: defined ? keyword : null,
            vr: parseVr(valueRepresentation, row),
            // kept verbatim; '1-n or 1' is a real constraint, not a typo
            vm: valueMultiplicity === '' ? null : valueMultiplicity,
            retired: retired === 'Y',
        });
    }
    return { entries, notes };
}
