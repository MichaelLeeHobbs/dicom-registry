import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guards the vendored build-time inputs. Everything this package emits is
// derived from these bytes, so a bad or stale pin is a data defect in every
// downstream dataset — cheaper to catch here than in a generated table.

const SOURCES_ROOT = join(__dirname, '..', 'sources');

interface SourceFile {
    readonly path: string;
    readonly local: string;
    readonly sha256: string | null;
    readonly use: string;
}
interface Source {
    readonly repo: string;
    readonly ref: string;
    readonly sha: string;
    readonly commitDate: string;
    readonly licenseFile: string;
    readonly files: readonly SourceFile[];
}
interface Manifest {
    readonly schemaVersion: number;
    readonly sources: Record<string, Source>;
}

const manifest = JSON.parse(readFileSync(join(SOURCES_ROOT, 'SOURCES.json'), 'utf8')) as Manifest;
const read = (key: string, local: string): Buffer => readFileSync(join(SOURCES_ROOT, key, local));
const readText = (key: string, local: string): string => read(key, local).toString('utf8');

describe('vendored sources — integrity', () => {
    it('pins every source to an immutable commit', () => {
        expect(Object.keys(manifest.sources).sort()).toEqual(['dcmtk', 'innolitics']);
        for (const [key, source] of Object.entries(manifest.sources)) {
            expect(source.sha, `${key}: sha`).toMatch(/^[0-9a-f]{40}$/);
            expect(source.commitDate, `${key}: commitDate`).toMatch(/^\d{4}-\d{2}-\d{2}T/);
            expect(source.files.length, `${key}: files`).toBeGreaterThan(0);
        }
    });

    it.each(Object.entries(manifest.sources).flatMap(([key, source]) => source.files.map(file => [key, file] as const)))(
        '%s/%s matches its recorded digest',
        (key, file) => {
            expect(file.sha256, `${file.local} has no recorded digest`).not.toBeNull();
            const actual = createHash('sha256').update(read(key, file.local)).digest('hex');
            expect(actual, `${key}/${file.local} differs from the recorded bytes`).toBe(file.sha256);
        }
    );

    it('ships the licence text for every source', () => {
        for (const [key, source] of Object.entries(manifest.sources)) {
            const licence = readText(key, source.licenseFile);
            expect(licence.length, `${key}: ${source.licenseFile}`).toBeGreaterThan(200);
        }
        expect(readText('innolitics', 'LICENSE.txt')).toContain('MIT');
        expect(readText('dcmtk', 'COPYRIGHT')).toContain('OFFIS');
    });
});

describe('vendored sources — the pin is current and usable', () => {
    const dicomDic = readText('dcmtk', 'dicom.dic');

    it('declares the DICOM edition it was generated from', () => {
        // this line is what the emitted datasets stamp as `dicomEdition`
        expect(dicomDic).toMatch(/Generated automatically from DICOM PS ?3\.6-\d{4}[a-z]/);
    });

    it('is not a stale copy: the 2019 VRs (SV/UV/OV) are present', () => {
        // the copy previously vendored in d-dart predates these entirely, which
        // is the concrete staleness this package exists to stop
        const rows = dicomDic.split('\n').filter(line => /\t(SV|UV|OV)\t/.test(line));
        expect(rows.length).toBeGreaterThan(5);
    });

    it('carries the repeating-group range grammar the tag codec implements', () => {
        expect(dicomDic).toContain('(6000-60FF,0010)'); // even-only group range
        expect(dicomDic).toMatch(/\([0-9A-F]{4}-o-[0-9A-F]{4},/); // odd-only
        expect(dicomDic).toMatch(/\([0-9A-F]{4}-u-[0-9A-F]{4},/); // unrestricted
    });

    it('has substantially more entries than the copy it replaces', () => {
        const entries = dicomDic.split('\n').filter(line => line.startsWith('('));
        expect(entries.length).toBeGreaterThan(5000);
    });

    it('exposes the C++ tables the generators parse', () => {
        expect(readText('dcmtk', 'dcuid.cc')).toContain('uidNameMap');
        expect(readText('dcmtk', 'dcxfer.cc')).toContain('DcmXfer');
        // the headers are required: dcuid.cc references UIDs by macro, and the
        // literals plus the property struct/enums live in the headers
        expect(readText('dcmtk', 'dcuid.h')).toContain('UID_CTImageStorage');
        expect(readText('dcmtk', 'dcxfer.h')).toContain('E_TransferSyntax');
    });

    it('has private tag definitions to parse', () => {
        const rows = readText('dcmtk', 'private.dic')
            .split('\n')
            .filter(line => line.startsWith('('));
        expect(rows.length).toBeGreaterThan(1000);
    });
});

describe('vendored sources — innolitics shape', () => {
    it('supplies attributes with the fields we depend on, ambiguity intact', () => {
        const attributes = JSON.parse(readText('innolitics', 'attributes.json')) as {
            tag: string;
            keyword: string;
            valueRepresentation: string;
            valueMultiplicity: string;
            retired: string;
            id: string;
        }[];
        expect(attributes.length).toBeGreaterThan(4000);
        const patientName = attributes.find(a => a.id === '00100010');
        expect(patientName).toMatchObject({ keyword: 'PatientName', valueRepresentation: 'PN', valueMultiplicity: '1' });

        // the two properties that make innolitics the right source for attributes:
        // ambiguous VRs are preserved rather than pre-resolved...
        expect(attributes.some(a => / or /.test(a.valueRepresentation))).toBe(true);
        // ...and VM keeps its "multiple of n" form, which [min,max] would lose
        expect(attributes.some(a => /^\d+-\d+n$/.test(a.valueMultiplicity))).toBe(true);
    });

    it('supplies the PS3.15 de-identification action codes', () => {
        const profile = JSON.parse(readText('innolitics', 'confidentiality_profile_attributes.json')) as {
            id: string;
            basicProfile: string;
        }[];
        expect(profile.length).toBeGreaterThan(100);
        expect(profile.find(entry => entry.id === '00100010')?.basicProfile).toBeDefined();
        // the alternation forms (X/Z) are content, not noise — never collapse them
        expect(profile.some(entry => entry.basicProfile.includes('/'))).toBe(true);
    });
});
