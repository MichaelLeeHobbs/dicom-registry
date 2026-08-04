/**
 * Merges the two attribute sources into one dataset, and records where they
 * disagree instead of hiding it.
 *
 * ## Precedence
 *
 * **innolitics is authoritative for what PS3.6 itself states** — keyword, name,
 * VR, VM, retirement, and the tag notation. It is a transcription of the
 * standard's own table, so it carries the ambiguity the standard intends
 * (`US or SS`) and the constraints DCMTK flattens (`1-n or 1`).
 *
 * **DCMTK is authoritative for everything PS3.6 does not contain** — the PS3.7
 * command group, DICONDE, DICOS, and the private/illegal/generic group-length
 * patterns — and is the only source for entries innolitics lacks.
 *
 * The rule is not "newest wins" or "one source wins": each source is trusted
 * for the thing it is actually a record of.
 *
 * ## Repeating ranges: the authority differs per half
 *
 * Neither source is right about the whole tag, so the halves are composed
 * separately. This is the one place the merge is not a straight preference.
 *
 * **Group half — DCMTK wins.** PS3.6 writes `(60XX,0010)`, which says nothing
 * about parity. DCMTK writes `(6000-60FF,0010)`, which is even-only. Even-only
 * is *normative*: PS3.5 §7.1 makes every odd group private, so an odd group can
 * never carry a standard attribute. Taking PS3.6's wildcard here would resolve
 * `(6001,0010)` to OverlayRows and reintroduce `@ubercode/dcmtk#47` — the exact
 * defect this registry exists to end.
 *
 * **Element half — PS3.6 wins.** DICOM has no parity rule for elements; odd
 * elements are ordinary. DCMTK's `(0020,3100-31FF)` is even-only purely because
 * `parseTagPart` in `dcdict.cc` defaults a bare range to `DcmDictRange_Even`
 * and its notation has no "range, unrestricted" default. PS3.6's `(0020,31XX)`
 * covers all 256, which is what the standard means. PS3.6 is also the only
 * source for interior-nibble wildcards like `(0028,04X0)`, where DCMTK lists a
 * single representative tag.
 *
 * Composition is textual — one half from each source, no range parsing here —
 * so range semantics stay defined in exactly one place, `src/tag.ts`.
 *
 * ## Why disagreements ship as data
 *
 * A consumer resolving `(0020,3101)` gets a different answer from each source.
 * Picking one silently would make this registry the third incompatible dialect
 * rather than the thing that ends them, so every disagreement is recorded with
 * the value the merge chose.
 */

/** Whether a half expresses more than one value: a DCMTK range or a PS3.6 wildcard. */
const spansMany = half => half.includes('-') || /x/i.test(half);

function halves(tagText) {
    const [group = '', element = ''] = tagText.replace(/^\(|\)$/g, '').split(',');
    return { group, element };
}

/**
 * Composes the canonical tag from both notations, one half at a time.
 *
 * When only one source expresses multiplicity on a half, that source has said
 * something the other did not, so it wins. When both do, the per-half authority
 * above decides. When neither does, the halves must be identical — and a
 * mismatch there means the join paired two different attributes, so it throws.
 */
function mergeTagText(dicTag, innoTag) {
    const dic = halves(dicTag);
    const inno = halves(innoTag);
    const pick = (dicHalf, innoHalf, whenBoth) => {
        if (spansMany(dicHalf) && spansMany(innoHalf)) {
            return whenBoth;
        }
        if (spansMany(dicHalf)) {
            return dicHalf;
        }
        if (spansMany(innoHalf)) {
            return innoHalf;
        }
        if (dicHalf.toLowerCase() !== innoHalf.toLowerCase()) {
            throw new Error(`merge-attributes: joined rows disagree on a concrete tag half: ${dicTag} vs ${innoTag}`);
        }
        return innoHalf;
    };
    // group: DCMTK, whose parity is normative; element: PS3.6, whose width is
    return `(${pick(dic.group, inno.group, dic.group)},${pick(dic.element, inno.element, inno.element)})`;
}

/** Joins the two sources on the official keyword, falling back to the tag text. */
function indexBy(entries, key) {
    const index = new Map();
    for (const entry of entries) {
        const value = entry[key];
        if (value !== null && value !== undefined && !index.has(value)) {
            index.set(value, entry);
        }
    }
    return index;
}

function vrText(vr) {
    return vr.join(',');
}

/** Records one field-level disagreement between the sources, and what was chosen. */
function divergence(tag, keyword, field, dcmtk, innolitics, note) {
    return { tag, keyword, field, dcmtk, innolitics, note };
}

function tagNote(dic, inno, merged) {
    if (!dic.includes('-')) {
        return 'DCMTK lists a single representative tag where PS3.6 states a wildcard; PS3.6 used';
    }
    if (merged === dic) {
        return "DCMTK's even-only group stride is normative (PS3.5 §7.1: odd groups are private); DCMTK used";
    }
    if (merged === inno) {
        return 'DICOM has no element parity rule; DCMTK even-only is a notation artifact; PS3.6 used';
    }
    return 'composed per half: DCMTK group stride, PS3.6 element width';
}

function compareRow(dic, inno, merged, divergences) {
    const tag = merged;
    const keyword = inno.keyword;
    if (dic.tagText !== inno.tagText) {
        divergences.push(divergence(tag, keyword, 'tag', dic.tagText, inno.tagText, tagNote(dic.tagText, inno.tagText, merged)));
    }
    if (vrText(dic.vr) !== vrText(inno.vr) && inno.vr.length > 0) {
        divergences.push(divergence(tag, keyword, 'vr', vrText(dic.vr), vrText(inno.vr), dic.pseudoVr === null ? null : `DCMTK code '${dic.pseudoVr}'`));
    }
    if (inno.vm !== null && dic.vm !== inno.vm) {
        divergences.push(divergence(tag, keyword, 'vm', dic.vm, inno.vm, 'DCMTK has no notation for a VM that depends on the VR in use'));
    }
    if (dic.retired !== inno.retired) {
        divergences.push(divergence(tag, keyword, 'retired', String(dic.retired), String(inno.retired), null));
    }
}

function fromBoth(dic, inno, merged) {
    return {
        tag: merged,
        keyword: inno.keyword ?? dic.keyword,
        name: inno.name,
        vr: inno.vr.length > 0 ? inno.vr : dic.vr,
        vm: inno.vm ?? dic.vm,
        retired: inno.retired,
        // only DCMTK distinguishes DICONDE/DICOS/private patterns
        standard: dic.standard,
        sources: 'both',
    };
}

function fromDcmtkOnly(dic) {
    return {
        tag: dic.tagText,
        keyword: dic.keyword,
        name: null,
        vr: dic.vr,
        vm: dic.vm,
        retired: dic.retired,
        standard: dic.standard,
        sources: 'dcmtk',
    };
}

function fromInnoliticsOnly(inno) {
    return {
        tag: inno.tagText,
        keyword: inno.keyword,
        name: inno.name,
        vr: inno.vr,
        vm: inno.vm,
        retired: inno.retired,
        standard: 'DICOM',
        sources: 'innolitics',
    };
}

/**
 * Merges both attribute sources.
 *
 * @param dicEntries - Rows from `dicom.dic`
 * @param innoEntries - Rows from `attributes.json`
 * @returns `{ entries, divergences, notes }`
 */
export function mergeAttributes(dicEntries, innoEntries) {
    const dicByKeyword = indexBy(dicEntries, 'keyword');
    const dicByTag = indexBy(dicEntries, 'tagText');
    const entries = [];
    const divergences = [];
    const notes = [];
    const consumed = new Set();

    for (const inno of innoEntries) {
        const dic = (inno.keyword === null ? undefined : dicByKeyword.get(inno.keyword)) ?? dicByTag.get(inno.tagText);
        if (dic === undefined) {
            entries.push(fromInnoliticsOnly(inno));
            continue;
        }
        consumed.add(dic);
        const merged = mergeTagText(dic.tagText, inno.tagText);
        compareRow(dic, inno, merged, divergences);
        entries.push(fromBoth(dic, inno, merged));
    }

    for (const dic of dicEntries) {
        if (!consumed.has(dic)) {
            entries.push(fromDcmtkOnly(dic));
        }
    }

    const dcmtkOnly = entries.filter(entry => entry.sources === 'dcmtk').length;
    const innoliticsOnly = entries.filter(entry => entry.sources === 'innolitics').length;
    notes.push(`attributes: ${entries.length - dcmtkOnly - innoliticsOnly} rows in both sources, ${dcmtkOnly} only in dicom.dic, ${innoliticsOnly} only in PS3.6`);
    notes.push(`attributes: ${divergences.length} field-level disagreements between the sources, shipped as the divergences dataset`);

    entries.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
    return { entries, divergences, notes };
}
