# Changelog

All notable changes to this project are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Until 1.0 the public API may change in any release. Pin an exact version.

## [Unreleased]

### Added

- Project scaffold: TypeScript 7 typecheck, tsdown (ESM + CJS + DTS), Vitest with 95/90/95/95
  coverage thresholds, ESLint with the mission-critical rule set (no `any`, complexity ≤ 10,
  ≤ 4 params, ≤ 40 lines), Prettier, CI on Node 20/22/24, and a tag-triggered publish workflow
  using npm Trusted Publishing with provenance.
- `NOTICE` recording the derivation chain: NEMA (the DICOM Standard) → OFFIS (DCMTK, BSD-style) →
  Innolitics (MIT) → this package. No upstream file is redistributed verbatim.
- **Tag codec** (`@ubercode/dicom-registry/tag`): a single canonical numeric `Tag` with conversions
  to and from all four dialects in circulation — `0x00100010`, `x00100010`, `00100010` and
  `(0010,0010)` — plus `tag()`, `tagGroup()`, `tagElement()`, `isPrivateTag()`, `isGroupLength()`,
  and a typed `TagFormatError` that carries the offending value.
- **Repeating-group ranges as data**: `toTagRange('(6000-60FF,0010)')` parses DCMTK's dictionary
  syntax, and `isInTagRange()` matches only **even** groups — an odd group inside the overlay range
  is a private tag and must not resolve to the overlay definition.
