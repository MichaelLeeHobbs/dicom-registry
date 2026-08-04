/**
 * Parses DCMTK's `private.dic` — private tag definitions for 132 vendors.
 *
 * Nobody else publishes this as data, and it cannot be derived: private tags
 * are documented in each vendor's conformance statement, and DCMTK's file is
 * the accumulated transcription of them.
 *
 * ## Why the key is not a tag
 *
 * A private tag's element number is not fixed. A private creator reserves a
 * *block* by writing its identifier into `(gggg,00xx)` for some `xx` in
 * `10`–`FF`; its attributes then live at `(gggg,xxee)`. The same vendor
 * attribute appears at `(0019,1012)` in one file and `(0019,4312)` in the next,
 * depending on which block was free. So the dictionary is keyed by
 * `(group, creator, elementByte)` and resolved against the block actually
 * reserved in the data set being read.
 *
 * The file's own header documents two element forms:
 *
 * - `(gggg,"CREATOR",ee)` — block-relative; matches whatever block the creator
 *   reserved.
 * - `(gggg,"CREATOR",eeee)` with `eeee >= 1000` — a fixed element that must
 *   occur exactly there.
 *
 * Group ranges use `-o-`, odd only, which is the only sensible restriction:
 * private groups are odd by definition (PS3.5 §7.1).
 */

/** `(gggg,"CREATOR",ee)` or `(gggg-o-gggg,"CREATOR",eeee)`. */
const PRIVATE_TAG = /^\(([0-9a-fA-F]{4}(?:-[oOuUeE]-[0-9a-fA-F]{4})?),"([^"]*)",([0-9a-fA-F]{2,4})\)$/;

/** Thrown when a private dictionary row cannot be read. Never a bare string. */
export class PrivateDictParseError extends Error {
    constructor(message, line, lineNumber) {
        super(`${message} (private.dic:${lineNumber}: ${JSON.stringify(line)})`);
        this.name = 'PrivateDictParseError';
        this.line = line;
        this.lineNumber = lineNumber;
    }
}

/**
 * Parses the private dictionary.
 *
 * @param source - Contents of `private.dic`
 * @returns `{ entries, notes }`
 */
export function parsePrivateDic(source) {
    const entries = [];
    const notes = [];
    const lines = source.split('\n');
    for (let index = 0; index < lines.length; index++) {
        const line = (lines[index] ?? '').replace(/\r$/, '');
        if (line.trim() === '' || line.startsWith('#')) {
            continue;
        }
        const columns = line.split('\t');
        // one upstream row omits the trailing version column; that is a defect
        // in the source, not in the row's meaning, so it is noted and kept
        if (columns.length === 4) {
            notes.push(`private.dic:${index + 1} has 4 columns instead of 5 (no version field); kept`);
            columns.push('PrivateTag');
        }
        if (columns.length !== 5) {
            throw new PrivateDictParseError(`expected 5 tab-separated columns, found ${columns.length}`, line, index + 1);
        }
        const [tagText, vr, keyword, vm] = columns;
        const match = PRIVATE_TAG.exec(tagText);
        if (match === null) {
            throw new PrivateDictParseError('unreadable private tag', line, index + 1);
        }
        const [, group = '', creator = '', element = ''] = match;
        entries.push({
            // the group half in dictionary notation, so a range survives
            group,
            creator,
            element: element.toUpperCase(),
            // a 2-digit element is an offset within whichever block the creator
            // reserved; a 4-digit one is an absolute element number
            blockRelative: element.length === 2,
            vr,
            keyword,
            vm,
        });
    }
    if (entries.length === 0) {
        throw new Error('parsePrivateDic: no rows parsed — the dictionary format changed');
    }
    return { entries, notes };
}
