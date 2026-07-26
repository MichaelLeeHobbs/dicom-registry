/**
 * Diffs the registry against another project's dictionary, without writing
 * anything.
 *
 *   node scripts/differential/diff-dictionary.mjs <path> [--format=keywordMap|packed]
 *
 * The committed differential suite only covers public dictionaries, because a
 * fixture is committed for it. This is the counterpart for dictionaries that
 * cannot be committed here — a private repository's, or one you simply do not
 * want vendored. It reads the file, prints a report, and exits non-zero if the
 * registry cannot resolve something the other dictionary defines.
 *
 * Formats:
 *
 * - `packed` — `'00100010': ['PN', 'PatientName', 1, 1, 0],` (dicom-parser)
 * - `keywordMap` — `PatientName: '(0010,0010)',` (a keyword-to-tag constant)
 *
 * Requires `pnpm run build` first, since it reads the built registry.
 */

import { readFileSync } from 'node:fs';
import { lookupAttribute, lookupAttributeByKeyword } from '../../dist/attributes.js';

const [, , sourcePath, ...flags] = process.argv;
if (sourcePath === undefined) {
    console.error('usage: diff-dictionary.mjs <path> [--format=keywordMap|packed]');
    process.exit(2);
}
const format = (flags.find(flag => flag.startsWith('--format=')) ?? '--format=packed').slice('--format='.length);

const PACKED = /^\s*'([0-9A-Fa-f]{8})':\s*\['([^']*)',\s*'([^']*)'/;
const KEYWORD_MAP = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*:\s*'\((([0-9A-Fa-fxX]{4}),([0-9A-Fa-fxX]{4}))\)'/;

function readEntries(source) {
    const entries = [];
    for (const line of source.split('\n')) {
        if (format === 'packed') {
            const match = PACKED.exec(line);
            if (match !== null) {
                entries.push({ tag: (match[1] ?? '').toUpperCase(), vr: match[2], keyword: match[3] ?? '' });
            }
        } else {
            const match = KEYWORD_MAP.exec(line);
            if (match !== null) {
                entries.push({ tag: `${match[3]}${match[4]}`.toUpperCase(), vr: null, keyword: match[1] ?? '' });
            }
        }
    }
    return entries;
}

const entries = readEntries(readFileSync(sourcePath, 'utf8'));
if (entries.length === 0) {
    console.error(`diff-dictionary: no entries parsed from ${sourcePath} — wrong --format?`);
    process.exit(2);
}

const unresolved = [];
const keywordMismatch = [];
const vrNarrowed = [];
let agreed = 0;

for (const entry of entries) {
    // a wildcard tag cannot be looked up as a number; resolve it by keyword
    const ours = /[xX]/.test(entry.tag) ? lookupAttributeByKeyword(entry.keyword.replace(/^RETIRED_/, '')) : lookupAttribute(entry.tag);
    if (ours === undefined) {
        unresolved.push(entry);
        continue;
    }
    const official = entry.keyword.replace(/^RETIRED_/, '');
    if (ours.keyword !== null && ours.keyword !== official) {
        keywordMismatch.push({ entry, ours: ours.keyword });
    }
    if (entry.vr !== null && ours.vr.length > 1 && ours.vr.includes(entry.vr)) {
        vrNarrowed.push({ entry, ours: ours.vr.join(',') });
    }
    agreed += 1;
}

const report = [
    `source            ${sourcePath}`,
    `format            ${format}`,
    `entries           ${entries.length}`,
    `resolved          ${agreed}`,
    `unresolved        ${unresolved.length}`,
    `keyword differs   ${keywordMismatch.length}`,
    `VR was narrowed   ${vrNarrowed.length}`,
];
console.warn(report.join('\n'));

for (const entry of unresolved.slice(0, 20)) {
    console.warn(`  unresolved: (${entry.tag}) ${entry.keyword}`);
}
for (const { entry, ours } of keywordMismatch.slice(0, 20)) {
    console.warn(`  keyword: (${entry.tag}) theirs=${entry.keyword} ours=${ours}`);
}

process.exit(unresolved.length === 0 ? 0 : 1);
