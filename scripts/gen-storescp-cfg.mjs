/**
 * Generates a DCMTK association configuration (`storescp.cfg`) from the registry.
 *
 *   node scripts/gen-storescp-cfg.mjs [output.cfg]
 *
 * A hand-maintained association config is a 500-line file that is entirely
 * derivable: every presentation context is one storage SOP class paired with a
 * transfer syntax profile, and both lists are data this registry already holds.
 * Hand-maintaining it means it silently goes stale as the standard adds SOP
 * classes, and nothing detects that.
 *
 * The two things that make this generatable are the two things nothing else
 * publishes as data: DCMTK's association-config TOKEN for each transfer syntax
 * (`JPEGBaseline`, not the UID and not the `EXS_` enum name), and the
 * storage/query-retrieve classification of each SOP class.
 *
 * The output is generic — standard SOP classes and standard transfer syntaxes,
 * nothing site-specific. Point it at a real deployment's requirements by
 * choosing a profile, not by editing the result.
 */

import { writeFileSync } from 'node:fs';
import { allTransferSyntaxes, findUids, PROVENANCE } from '../dist/uid.js';

// flags may come in any position, so the output path is the first non-flag
// argument rather than argv[2] — otherwise `--standard-only` alone would be
// taken as a filename and written to
const outputPath = process.argv.slice(2).find(argument => !argument.startsWith('--'));

/**
 * Transfer syntax profiles, in DCMTK's `[[TransferSyntaxes]]` form.
 *
 * `LocalEndianExplicit` / `OppositeEndianExplicit` are DCMTK's build-relative
 * aliases; they are not registry data and are written literally.
 */
const PROFILES = [
    { name: 'Uncompressed', tokens: ['LocalEndianExplicit', 'OppositeEndianExplicit', 'LittleEndianImplicit'] },
    {
        name: 'UncompressedOrZlib',
        tokens: ['DeflatedLittleEndianExplicit', 'LocalEndianExplicit', 'OppositeEndianExplicit', 'LittleEndianImplicit'],
    },
    { name: 'AnyTransferSyntax', tokens: null },
];

/** Ordered so uncompressed syntaxes are offered before compressed ones. */
function anySyntaxTokens() {
    const uncompressed = [];
    const compressed = [];
    for (const syntax of allTransferSyntaxes()) {
        if (syntax.dcmtkName === null || syntax.status === 'internal') {
            continue;
        }
        (syntax.pixelDataEncoding === 'native' ? uncompressed : compressed).push(syntax.dcmtkName);
    }
    return [...uncompressed, ...compressed];
}

function transferSyntaxSection() {
    const lines = ['[[TransferSyntaxes]]', ''];
    for (const profile of PROFILES) {
        lines.push(`[${profile.name}]`);
        const tokens = profile.tokens ?? anySyntaxTokens();
        tokens.forEach((token, index) => {
            lines.push(`TransferSyntax${index + 1} = ${token}`);
        });
        lines.push('');
    }
    return lines;
}

/**
 * Retired and draft storage classes are included by default.
 *
 * They are exactly what a legacy archive sends. Refusing a study because its
 * SOP class was retired in 2004 is a worse outcome than accepting it, and an
 * SCP that only advertises current classes silently rejects real traffic. Pass
 * `--standard-only` for a config that advertises current classes alone.
 */
const STANDARD_ONLY = process.argv.includes('--standard-only');
const ACCEPTED_STATUS = STANDARD_ONLY ? new Set(['standard']) : new Set(['standard', 'retired', 'draft']);

/**
 * DICONDE (industrial non-destructive testing) and DICOS (security screening)
 * are excluded by default.
 *
 * They are separate domains that happen to reuse the DICOM encoding — a
 * teleradiology SCP has no reason to advertise baggage-screening classes. Pass
 * `--all-standards` to include them.
 */
const ALL_STANDARDS = process.argv.includes('--all-standards');
const ACCEPTED_STANDARD = ALL_STANDARDS ? null : new Set(['DICOM']);

/**
 * The name a presentation context must use is DCMTK's, not PS3.6's.
 *
 * DCMTK's association-config parser resolves these against its own UID name
 * table (`dcuid.cc` column 3), so it wants `VerificationSOPClass` and
 * `MultiframeGrayscaleByteSecondaryCaptureImageStorage` — not the official
 * keywords `Verification` and `MultiFrameGrayscale...`, which it will reject.
 * This is the same distinction that applies to transfer syntax tokens.
 */
function configName(entry) {
    return entry.dcmtkName ?? entry.keyword;
}

function presentationContextSection(profileName) {
    const verification = findUids({ type: 'sopClass' }).find(entry => entry.uid === '1.2.840.10008.1.1');
    // Verification is not a storage class, but every SCP must support it
    const classes = [
        ...(verification === undefined ? [] : [verification]),
        ...findUids({ type: 'sopClass', service: 'storage' }).filter(
            entry => ACCEPTED_STATUS.has(entry.status) && (ACCEPTED_STANDARD === null || ACCEPTED_STANDARD.has(entry.standard)) && configName(entry) !== null
        ),
    ];
    const lines = ['[[PresentationContexts]]', '', `[${profileName}]`];
    classes.forEach((sopClass, index) => {
        const label = `PresentationContext${index + 1}`;
        lines.push(`${label.padEnd(24)} = ${configName(sopClass)}\\AnyTransferSyntax`);
    });
    lines.push('');
    return { lines, count: classes.length };
}

function profileSection(profileName) {
    return ['[[Profiles]]', '', '[Default]', `PresentationContexts = ${profileName}`, ''];
}

const profileName = 'GenericStorageSCP';
const contexts = presentationContextSection(profileName);
const dcmtk = PROVENANCE.sources.find(source => source.key === 'dcmtk');
const header = [
    '#',
    '# DCMTK association configuration — GENERATED FILE, do not edit.',
    '#',
    '# Generated by @ubercode/dicom-registry (scripts/gen-storescp-cfg.mjs) from',
    `# DICOM PS 3.6-${PROVENANCE.dicomEdition} and DCMTK ${dcmtk?.ref ?? 'unknown'}.`,
    '#',
    '# Every presentation context below is one standard storage SOP class paired',
    '# with a transfer syntax profile. Regenerate rather than edit: a hand-edited',
    '# config goes stale as the standard adds SOP classes, and nothing notices.',
    '#',
    `# ${contexts.count} presentation contexts.`,
    '#',
    '',
];

const output = [...header, ...transferSyntaxSection(), ...contexts.lines, ...profileSection(profileName)].join('\n');

if (outputPath === undefined) {
    process.stdout.write(output);
} else {
    writeFileSync(outputPath, output);
    console.warn(`${contexts.count} presentation contexts -> ${outputPath}`);
}
