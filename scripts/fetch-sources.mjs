/**
 * Fetches the pinned build-time inputs listed in `sources/SOURCES.json` and
 * verifies them against their recorded SHA-256 digests.
 *
 * The vendored copies are committed, so a normal build (and every consumer)
 * needs no network access. This script only runs when a pin changes — which is
 * deliberately its own pull request, because an upstream shape change should be
 * reviewed by a human rather than merged inside an unrelated feature.
 *
 *   node scripts/fetch-sources.mjs              verify committed files, refetch anything missing
 *   node scripts/fetch-sources.mjs --update     refetch everything and rewrite the digests
 *   node scripts/fetch-sources.mjs --check      verify only; never write (the CI gate)
 *
 * Exit codes: 0 ok, 1 digest mismatch or missing file, 2 usage/network error.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES_PATH = join(ROOT, 'sources', 'SOURCES.json');

const args = new Set(process.argv.slice(2));
const UPDATE = args.has('--update');
const CHECK_ONLY = args.has('--check');
if (UPDATE && CHECK_ONLY) {
    console.error('fetch-sources: --update and --check are mutually exclusive');
    process.exit(2);
}

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const rawUrl = (repo, sha, path) => `https://raw.githubusercontent.com/${repo}/${sha}/${path}`;

async function download(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText} for ${url}`);
    }
    return Buffer.from(await response.arrayBuffer());
}

/** Verifies one vendored file, fetching it when allowed. Returns a status word. */
async function reconcile(source, key, file) {
    const localPath = join(ROOT, 'sources', key, file.local);
    const url = rawUrl(source.repo, source.sha, file.path);
    const present = existsSync(localPath);

    if (present && !UPDATE) {
        const actual = digest(readFileSync(localPath));
        if (file.sha256 === null) {
            file.sha256 = actual;
            return CHECK_ONLY ? 'unrecorded' : 'recorded';
        }
        return actual === file.sha256 ? 'ok' : 'MISMATCH';
    }
    if (CHECK_ONLY) {
        return 'missing';
    }

    const bytes = await download(url);
    const actual = digest(bytes);
    // A recorded digest is the contract: if upstream served something else at
    // the same immutable SHA, that is a supply-chain event, not a refresh.
    if (!UPDATE && file.sha256 !== null && actual !== file.sha256) {
        return 'MISMATCH';
    }
    mkdirSync(dirname(localPath), { recursive: true });
    writeFileSync(localPath, bytes);
    const changed = file.sha256 !== null && file.sha256 !== actual;
    file.sha256 = actual;
    return changed ? 'updated' : 'fetched';
}

const manifest = JSON.parse(readFileSync(SOURCES_PATH, 'utf8'));
let failures = 0;
let mutated = false;

for (const [key, source] of Object.entries(manifest.sources)) {
    console.warn(`\n${key} @ ${source.ref} (${source.sha.slice(0, 12)}, ${source.commitDate})`);
    for (const file of source.files) {
        let status;
        try {
            status = await reconcile(source, key, file);
        } catch (error) {
            status = `ERROR ${error instanceof Error ? error.message : String(error)}`;
        }
        if (status === 'MISMATCH' || status === 'missing' || status === 'unrecorded' || status.startsWith('ERROR')) {
            failures++;
        }
        if (status === 'fetched' || status === 'updated' || status === 'recorded') {
            mutated = true;
        }
        console.warn(`  ${status.padEnd(10)} ${file.local}`);
    }
}

if (mutated && !CHECK_ONLY) {
    writeFileSync(SOURCES_PATH, `${JSON.stringify(manifest, null, 4)}\n`);
    console.warn('\nsources/SOURCES.json updated with digests.');
}

if (failures > 0) {
    console.error(`\nfetch-sources: ${failures} file(s) failed verification.`);
    console.error('A MISMATCH means the bytes differ from the recorded digest — investigate before regenerating any data.');
    process.exit(1);
}
console.warn('\nAll vendored sources verified.');
