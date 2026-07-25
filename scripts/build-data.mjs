/**
 * Regenerates every dataset from the vendored sources.
 *
 *   node scripts/build-data.mjs            emit data/ and src/generated/
 *   node scripts/build-data.mjs --check    emit nowhere; fail if output would change
 *
 * `--check` is the CI gate. It only works because output is deterministic:
 * `generatedAt` is derived from the newest source commit date, never from the
 * wall clock. A timestamp here would make every run a diff and destroy the one
 * check that proves the committed data matches the pinned inputs.
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAttributes } from './parse/attributes.mjs';
import { parseDicomDic } from './parse/dicomDic.mjs';
import { parseUids } from './parse/dcuid.mjs';
import { parseTransferSyntaxes } from './parse/dcxfer.mjs';
import { mergeAttributes } from './merge-attributes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');

const readSource = name => readFileSync(join(ROOT, 'sources', 'dcmtk', name), 'utf8');
const readInnolitics = name => readFileSync(join(ROOT, 'sources', 'innolitics', name), 'utf8');
const manifest = JSON.parse(readFileSync(join(ROOT, 'sources', 'SOURCES.json'), 'utf8'));

/** The DICOM edition is stated in dicom.dic's header; it is the real version of this data. */
function dicomEdition(dicomDic) {
    const match = /Generated automatically from DICOM PS ?3\.6-(\d{4}[a-z])/.exec(dicomDic);
    if (match === null) {
        throw new Error('build-data: dicom.dic does not declare the DICOM edition it was generated from');
    }
    return match[1];
}

function buildProvenance(edition, notes) {
    const sources = Object.entries(manifest.sources).map(([key, source]) => ({
        key,
        repo: source.repo,
        ref: source.ref,
        sha: source.sha,
        commitDate: source.commitDate,
    }));
    return {
        registryVersion: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version,
        dicomEdition: edition,
        // deliberately derived, not `new Date()` — see the module comment
        generatedAt: sources.map(source => source.commitDate).sort().at(-1),
        sources,
        notes,
    };
}

/** Joins DCMTK's association-config token onto each transfer syntax, by UID. */
function mergeTransferSyntaxes(transferSyntaxes, uids) {
    const byUid = new Map(uids.map(entry => [entry.uid, entry]));
    const merged = [];
    const notes = [];
    for (const syntax of transferSyntaxes) {
        if (syntax.uid === '') {
            notes.push(`XferNames entry '${syntax.name}' has no UID (DCMTK-internal); omitted from the dataset`);
            continue;
        }
        const uid = byUid.get(syntax.uid);
        merged.push({
            ...syntax,
            keyword: uid?.keyword ?? null,
            dcmtkName: uid?.dcmtkName ?? null,
            inUidRegistry: uid !== undefined,
        });
    }
    const missing = uids.filter(entry => entry.type === 'transferSyntax' && !merged.some(syntax => syntax.uid === entry.uid));
    for (const entry of missing) {
        notes.push(`UID registry lists transfer syntax ${entry.uid} (${entry.keyword}) with no XferNames properties row`);
    }
    return { merged, notes };
}

function dataset(name, provenance, entries) {
    return { schemaVersion: 1, dataset: name, provenance, count: entries.length, entries };
}

/** Emits a file, or compares it when checking. Returns true when it differs. */
function emit(relativePath, contents) {
    const target = join(ROOT, relativePath);
    const existing = existsSync(target) ? readFileSync(target, 'utf8') : null;
    if (existing === contents) {
        return false;
    }
    if (!CHECK_ONLY) {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, contents);
    }
    return true;
}

const json = value => `${JSON.stringify(value, null, 2)}\n`;

/** Renders a generated TS module. Data ships as TS, never imported as JSON. */
function tsModule(header, body) {
    return `/**\n * GENERATED FILE — do not edit.\n *\n${header
        .split('\n')
        .map(line => ` * ${line}`.trimEnd())
        .join('\n')}\n */\n\n${body}`;
}

const quote = value => (value === null ? 'null' : `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);

/**
 * Serializes a value as a JavaScript literal.
 *
 * Written out properly rather than by regex-replacing `"` in JSON output: a
 * string containing an apostrophe (and the parse notes do contain `'deflate'`)
 * turns such a substitution into a syntax error in the generated module.
 */
function toJsLiteral(value, indent = 0) {
    const pad = ' '.repeat(indent);
    const inner = ' '.repeat(indent + 4);
    if (value === null || typeof value === 'string') {
        return quote(value);
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (Array.isArray(value)) {
        return value.length === 0 ? '[]' : `[\n${value.map(item => `${inner}${toJsLiteral(item, indent + 4)},`).join('\n')}\n${pad}]`;
    }
    const fields = Object.entries(value).map(([key, item]) => `${inner}${key}: ${toJsLiteral(item, indent + 4)},`);
    return fields.length === 0 ? '{}' : `{\n${fields.join('\n')}\n${pad}}`;
}

function uidsModule(entries, provenance) {
    const rows = entries
        .map(e => `    [${quote(e.uid)}, ${quote(e.keyword)}, ${quote(e.dcmtkName)}, ${quote(e.type)}, ${quote(e.service)}, ${quote(e.iodType)}, ${quote(e.status)}, ${quote(e.standard)}, [${e.flags.map(quote).join(', ')}]],`)
        .join('\n');
    return tsModule(
        `DICOM UID registry, generated from DCMTK ${provenance.sources.find(s => s.key === 'dcmtk').ref}\n(DICOM PS 3.6-${provenance.dicomEdition}) by scripts/build-data.mjs.\n\nPacked as [uid, keyword, dcmtkName, type, service, iodType, status, standard, flags].`,
        `/** One packed UID row. */\nexport type PackedUid = readonly [\n    uid: string,\n    // null where DCMTK records no official PS3.6 keyword — data, not a parse failure\n    keyword: string | null,\n    dcmtkName: string | null,\n    type: string,\n    service: string | null,\n    iodType: string | null,\n    status: string,\n    standard: string,\n    flags: readonly string[],\n];\n\n/** Every UID DCMTK knows, in source order. */\nexport const UIDS: readonly PackedUid[] = [\n${rows}\n];\n`
    );
}

function transferSyntaxModule(entries, provenance) {
    const rows = entries
        .map(
            e =>
                `    [${quote(e.uid)}, ${quote(e.name)}, ${quote(e.keyword)}, ${quote(e.dcmtkName)}, ${e.explicitVr}, ${quote(e.byteOrder)}, ${quote(e.pixelDataEncoding)}, ${quote(e.compression)}, ${e.fragmentable}, ${quote(e.streamCompression)}, ${quote(e.status)}, ${quote(e.mimeType)}, ${quote(e.filenameExtension)}],`
        )
        .join('\n');
    return tsModule(
        `DICOM transfer syntaxes with their encoding properties, generated from\nDCMTK ${provenance.sources.find(s => s.key === 'dcmtk').ref} by scripts/build-data.mjs.`,
        `/** One packed transfer syntax row. */\nexport type PackedTransferSyntax = readonly [\n    uid: string,\n    name: string,\n    keyword: string | null,\n    dcmtkName: string | null,\n    explicitVr: boolean,\n    byteOrder: string,\n    pixelDataEncoding: string,\n    pixelDataCompression: string,\n    fragmentable: boolean,\n    streamCompression: string,\n    status: string,\n    mimeType: string,\n    filenameExtension: string,\n];\n\n/** Every transfer syntax DCMTK defines properties for. */\nexport const TRANSFER_SYNTAXES: readonly PackedTransferSyntax[] = [\n${rows}\n];\n`
    );
}

function attributesModule(entries, provenance) {
    const rows = entries
        .map(e => `    [${quote(e.tag)}, ${quote(e.keyword)}, ${quote(e.name)}, ${quote(e.vr.join(','))}, ${quote(e.vm)}, ${e.retired}, ${quote(e.standard)}, ${quote(e.sources)}],`)
        .join('\n');
    return tsModule(
        `The DICOM attribute dictionary, merged from PS 3.6-${provenance.dicomEdition} (via innolitics)\nand DCMTK ${provenance.sources.find(s => s.key === 'dcmtk').ref}'s dicom.dic, by scripts/build-data.mjs.\n\n\`tag\` is kept as TEXT, not a number, because a repeating group is a range and\nonly the notation carries its stride. src/attributes.ts parses it with the same\ntoTagRange() consumers use, so there is one implementation of range semantics.`,
        `/** One packed attribute row. */\nexport type PackedAttribute = readonly [\n    tag: string,\n    keyword: string | null,\n    name: string | null,\n    /** Comma-separated; more than one means PS3.6 leaves the VR ambiguous. */\n    vr: string,\n    vm: string | null,\n    retired: boolean,\n    standard: string,\n    sources: string,\n];\n\n/** Every attribute either source defines, ordered by tag text. */\nexport const ATTRIBUTES: readonly PackedAttribute[] = [\n${rows}\n];\n`
    );
}

function divergencesModule(entries) {
    const rows = entries
        .map(e => `    [${quote(e.tag)}, ${quote(e.keyword)}, ${quote(e.field)}, ${quote(e.dcmtk)}, ${quote(e.innolitics)}, ${quote(e.note)}],`)
        .join('\n');
    return tsModule(
        'Where the two attribute sources disagree, by scripts/build-data.mjs.\n\nShipped as data because the disagreements are real and a consumer may need to\nknow which reading it is getting — see scripts/merge-attributes.mjs.',
        `/** One recorded disagreement between the sources. */\nexport type PackedDivergence = readonly [\n    tag: string,\n    keyword: string | null,\n    field: string,\n    dcmtk: string,\n    innolitics: string,\n    note: string | null,\n];\n\n/** Every field-level disagreement between dicom.dic and PS3.6. */\nexport const DIVERGENCES: readonly PackedDivergence[] = [\n${rows}\n];\n`
    );
}

function provenanceModule(provenance) {
    return tsModule(
        'Provenance of the generated datasets.',
        `/** Where the shipped data came from, and which DICOM edition it reflects. */\nexport const PROVENANCE = ${toJsLiteral(provenance)} as const;\n`
    );
}

/** Fails the build when a parse looks degraded rather than merely changed. */
function verify(uids, transferSyntaxes, attributes) {
    const expectationsPath = join(ROOT, 'snapshots', 'expectations.json');
    const expectations = JSON.parse(readFileSync(expectationsPath, 'utf8'));
    const problems = [];
    const check = (name, actual, spec) => {
        if (actual < spec.minCount) {
            problems.push(`${name}: ${actual} entries is below the floor of ${spec.minCount} — a degraded parse yields fewer rows`);
        }
    };
    check('uids', uids.length, expectations.uids);
    check('transferSyntaxes', transferSyntaxes.length, expectations.transferSyntaxes);
    check('attributes', attributes.length, expectations.attributes);
    for (const keyword of expectations.attributes.requiredKeywords) {
        if (!attributes.some(entry => entry.keyword === keyword)) {
            problems.push(`attributes: required keyword '${keyword}' is missing`);
        }
    }
    for (const tag of expectations.attributes.requiredRanges) {
        if (!attributes.some(entry => entry.tag === tag)) {
            problems.push(`attributes: required range '${tag}' is missing — repeating-group notation was flattened`);
        }
    }
    // the 2019 VRs are the canary for a stale dictionary: a pre-2019 copy
    // parses cleanly and produces a dataset that silently cannot describe them
    for (const vr of ['SV', 'UV', 'OV']) {
        if (!attributes.some(entry => entry.vr.includes(vr))) {
            problems.push(`attributes: no attribute uses VR '${vr}' — the dictionary predates the 2019 edition`);
        }
    }
    const ambiguous = attributes.filter(entry => entry.vr.length > 1).length;
    if (ambiguous < expectations.attributes.minAmbiguousVr) {
        problems.push(`attributes: only ${ambiguous} attributes keep an ambiguous VR — the merge resolved what the standard leaves open`);
    }
    for (const keyword of expectations.uids.requiredKeywords) {
        if (!uids.some(entry => entry.keyword === keyword)) {
            problems.push(`uids: required keyword '${keyword}' is missing`);
        }
    }
    for (const uid of expectations.transferSyntaxes.requiredUids) {
        if (!transferSyntaxes.some(entry => entry.uid === uid)) {
            problems.push(`transferSyntaxes: required UID '${uid}' is missing`);
        }
    }
    // A field that used to be populated and is now mostly empty means the
    // columns shifted — the failure a row count alone would not catch.
    const named = transferSyntaxes.filter(entry => entry.dcmtkName !== null).length / transferSyntaxes.length;
    if (named < 0.9) {
        problems.push(`transferSyntaxes: only ${Math.round(named * 100)}% joined a DCMTK name — the UID join or a column mapping broke`);
    }
    if (problems.length > 0) {
        throw new Error(`build-data: parse looks degraded\n  - ${problems.join('\n  - ')}`);
    }
}

const uidResult = parseUids(readSource('dcuid.cc'), readSource('dcuid.h'));
const xferResult = parseTransferSyntaxes(readSource('dcxfer.cc'), readSource('dcxfer.h'), readSource('dcuid.h'));
const { merged: transferSyntaxes, notes: mergeNotes } = mergeTransferSyntaxes(xferResult.entries, uidResult.entries);

const dicResult = parseDicomDic(readSource('dicom.dic'));
const attributeResult = parseAttributes(readInnolitics('attributes.json'));
const { entries: attributes, divergences, notes: attributeNotes } = mergeAttributes(dicResult.entries, attributeResult.entries);

verify(uidResult.entries, transferSyntaxes, attributes);

const provenance = buildProvenance(dicomEdition(readSource('dicom.dic')), [
    ...xferResult.notes,
    ...mergeNotes,
    ...dicResult.notes,
    ...attributeResult.notes,
    ...attributeNotes,
]);
const changed = [
    emit('data/uids.json', json(dataset('uids', provenance, uidResult.entries))),
    emit('data/transfer-syntaxes.json', json(dataset('transferSyntaxes', provenance, transferSyntaxes))),
    emit('data/attributes.json', json(dataset('attributes', provenance, attributes))),
    emit('data/divergences.json', json(dataset('divergences', provenance, divergences))),
    emit('src/generated/uids.ts', uidsModule(uidResult.entries, provenance)),
    emit('src/generated/transferSyntaxes.ts', transferSyntaxModule(transferSyntaxes, provenance)),
    emit('src/generated/attributes.ts', attributesModule(attributes, provenance)),
    emit('src/generated/divergences.ts', divergencesModule(divergences)),
    emit('src/generated/provenance.ts', provenanceModule(provenance)),
].filter(Boolean).length;

console.warn(
    `DICOM edition ${provenance.dicomEdition} | ${uidResult.entries.length} UIDs | ${transferSyntaxes.length} transfer syntaxes | ${attributes.length} attributes | ${divergences.length} divergences`
);
for (const note of provenance.notes) {
    console.warn(`  note: ${note}`);
}
if (CHECK_ONLY && changed > 0) {
    console.error(`\nbuild-data --check: ${changed} generated file(s) differ from a fresh build.`);
    console.error('Run `pnpm run data:build` and commit the result — generated data is reviewed as a diff.');
    process.exit(1);
}
console.warn(changed > 0 ? `\n${changed} file(s) written.` : '\nGenerated data is up to date.');
