/**
 * Extracts a comparison fixture from another project's data dictionary.
 *
 *   node scripts/differential/extract-dictionary.mjs <path-to-data.ts> <output.json>
 *
 * The differential suite is the strongest gate this registry has: it is what
 * shows the registry can actually replace the dictionaries already in service,
 * rather than merely looking correct on its own terms. For that to run in CI it
 * has to be hermetic, so the other project's table is transcribed once into a
 * fixture carrying the commit it came from.
 *
 * The transcription is faithful — the packed tuple is copied verbatim, not
 * interpreted — so a disagreement found later is a real disagreement and not an
 * artifact of this script.
 *
 * Only public repositories are extracted into committed fixtures. To diff
 * against a private dictionary, use `scripts/differential/diff-dictionary.mjs`,
 * which takes a path and writes nothing.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const [, , sourcePath, outputPath] = process.argv;
if (sourcePath === undefined || outputPath === undefined) {
    console.error('usage: extract-dictionary.mjs <path-to-data.ts> <output.json>');
    process.exit(2);
}

/** `'00080018': ['UI', 'SOPInstanceUID', 1, 1, 0],` */
const ROW = /^\s*'([0-9A-Fa-f]{8})':\s*\[([^\]]+)\],?\s*$/;

function parseRow(text) {
    // the tuple is [vr, keyword, vmMin, vmMax, retired]; vmMax may be null
    const match = /^'([^']*)',\s*'([^']*)',\s*(\d+),\s*(null|\d+),\s*([01])$/.exec(text.trim());
    if (match === null) {
        throw new Error(`extract-dictionary: unreadable packed entry: ${text}`);
    }
    const [, vr, keyword, vmMin, vmMax, retired] = match;
    return [vr, keyword, Number(vmMin), vmMax === 'null' ? null : Number(vmMax), Number(retired)];
}

function gitFact(repoDir, args) {
    try {
        return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' }).trim();
    } catch {
        return null;
    }
}

const resolved = resolve(sourcePath);
const source = readFileSync(resolved, 'utf8');
const entries = {};
for (const line of source.split('\n')) {
    const match = ROW.exec(line);
    if (match !== null) {
        entries[(match[1] ?? '').toUpperCase()] = parseRow(match[2] ?? '');
    }
}
if (Object.keys(entries).length === 0) {
    throw new Error(`extract-dictionary: no rows found in ${resolved} — the source format changed`);
}

const repoDir = dirname(resolved);
const repoRoot = gitFact(repoDir, ['rev-parse', '--show-toplevel']);
const fixture = {
    $comment: 'Transcribed verbatim by scripts/differential/extract-dictionary.mjs. Do not edit by hand.',
    source: {
        // repo-relative, so the fixture does not record whoever ran the script
        remote: gitFact(repoDir, ['remote', 'get-url', 'origin']),
        path: repoRoot === null ? sourcePath.replace(/\\/g, '/') : resolved.replace(/\\/g, '/').slice(repoRoot.replace(/\\/g, '/').length + 1),
        commit: gitFact(repoDir, ['rev-parse', 'HEAD']),
        commitDate: gitFact(repoDir, ['log', '-1', '--format=%cI']),
        describe: gitFact(repoDir, ['describe', '--tags', '--always']),
    },
    format: ['vr', 'keyword', 'vmMin', 'vmMax', 'retired'],
    count: Object.keys(entries).length,
    entries,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(fixture, null, 0)}\n`);
console.warn(`${fixture.count} entries -> ${outputPath} (from ${fixture.source.describe ?? 'unknown revision'})`);
