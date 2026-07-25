/**
 * GENERATED FILE — do not edit.
 *
 * Provenance of the generated datasets.
 */

/** Where the shipped data came from, and which DICOM edition it reflects. */
export const PROVENANCE = {
    registryVersion: '0.1.0-alpha.0',
    dicomEdition: '2025e',
    generatedAt: '2026-04-17T13:04:17Z',
    sources: [
        {
            key: 'dcmtk',
            repo: 'DCMTK/dcmtk',
            ref: 'DCMTK-3.7.0',
            sha: 'ccfd10b84ff3c9a40b7b331698aedf06d421fc43',
            commitDate: '2025-12-15T07:28:13Z',
        },
        {
            key: 'innolitics',
            repo: 'innolitics/dicom-standard',
            ref: 'master',
            sha: '90571bcc4e46b08bc815bd683e6c466308bcff9a',
            commitDate: '2026-04-17T13:04:17Z',
        },
    ],
    notes: [
        'dcxfer.cc parsed with WITH_ZLIB defined, so the deflated syntax reports streamCompression \'deflate\' rather than \'unsupported\'',
        'XferNames entry \'Virtual Big Endian Implicit\' has no UID (DCMTK-internal); omitted from the dataset',
        'UID registry lists transfer syntax 1.2.840.10008.1.2.7.1 (SMPTEST211020UncompressedProgressiveActiveVideo) with no XferNames properties row',
        'UID registry lists transfer syntax 1.2.840.10008.1.2.7.2 (SMPTEST211020UncompressedInterlacedActiveVideo) with no XferNames properties row',
        'UID registry lists transfer syntax 1.2.840.10008.1.2.7.3 (SMPTEST211030PCMDigitalAudio) with no XferNames properties row',
        'UID registry lists transfer syntax 1.2.840.10008.1.2.6.1 (RFC2557MIMEEncapsulation) with no XferNames properties row',
        'UID registry lists transfer syntax 1.2.840.10008.1.2.6.2 (XMLEncoding) with no XferNames properties row',
    ],
} as const;
