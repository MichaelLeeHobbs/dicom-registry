# @ubercode/dicom-registry

The DICOM registry as data — tags, UIDs, SOP classes, transfer syntaxes, private tags, VR/VM rules
and de-identification actions — generated from pinned upstream sources, with **zero runtime
dependencies**.

> **Status: pre-1.0, internal-first.** This is built for our own DICOM stack
> ([`@ubercode/dicom-parser`](https://github.com/MichaelLeeHobbs/dicomParser), `@ubercode/dcmtk`, and
> an internal router). It is public because it may be useful to you — but there are **no
> backwards-compatibility promises before 1.0**. Pin an exact version.

## Why

Every DICOM project rebuilds the same facts, and then disagrees about them. Across three of our own
repos we had three generators parsing the same DCMTK dictionary into three shapes, and **three
incompatible ways of writing a tag**:

| Repo | Tag looks like             |
| ---- | -------------------------- |
| A    | `(0010,0010)`              |
| B    | `"00100010"`               |
| C    | `0x00100010` / `x00100010` |

So nothing was shareable, every boundary needed a converter, one copy of the dictionary was five
years stale, and hand-written SOP-class predicates and transfer-syntax lists drifted independently.

This package is the single generated source of truth those projects consume. Dependency direction is
one-way: **parsers depend on the registry, never the reverse.** This package never parses DICOM byte
streams — that is an explicit non-goal.

## Install

```bash
pnpm add @ubercode/dicom-registry   # or npm i / yarn add
```

## Tags — one type, every dialect

```ts
import { toTag, toHex, toParenthesized, toPrefixed } from '@ubercode/dicom-registry/tag';

toTag('(0010,0010)'); // 0x00100010 — canonical form is the number
toTag('x00100010'); // 0x00100010
toTag('00100010'); // 0x00100010

toParenthesized(0x00100010); // '(0010,0010)'
toHex(0x00100010); // '00100010'
toPrefixed(0x00100010); // 'x00100010'
```

Repeating groups are data, not a hardcoded `0x6000` check — which is the bug class this exists to
prevent (an odd group inside `6000-60FF` is a _private_ tag and must not resolve to the overlay
definition):

```ts
import { isInTagRange, toTagRange } from '@ubercode/dicom-registry/tag';

const overlays = toTagRange('(6000-60FF,0010)'); // DCMTK's dictionary syntax
isInTagRange('(6000,0010)', overlays); // true  — OverlayRows
isInTagRange('(6002,0010)', overlays); // true  — second overlay plane
isInTagRange('(6001,0010)', overlays); // false — odd group: private
```

The `/tag` subpath carries **no data tables at all**, so importing it costs nothing.

## Where the data comes from

Nothing upstream is redistributed verbatim; every dataset is regenerated into this project's schema,
and each carries its provenance (`dicomEdition`, `dcmtkVersion`, `innoliticsSha`, `generatedAt`).

| Dataset                                    | Upstream                    | Why that one                                                                                                   |
| ------------------------------------------ | --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Attributes (tag, keyword, VR, VM, retired) | innolitics/dicom-standard   | official PS3.6 keywords, ambiguous VRs (`US or SS`) preserved, regenerated monthly                             |
| Repeating-group ranges                     | DCMTK `dicom.dic`           | ranges are native there: `(6000-60FF,0010)`                                                                    |
| UIDs, SOP classes, **categories**          | DCMTK `dcuid.cc`            | UID + keyword + DCMTK alias + storage/image/SR/worklist classification — categories exist as data nowhere else |
| Transfer syntaxes + properties             | DCMTK `dcxfer.cc`           | byte order, explicit/implicit VR, encapsulated, lossy/lossless, MIME type                                      |
| Private tags                               | DCMTK `private.dic`         | not published as data anywhere else                                                                            |
| De-identification actions                  | innolitics (PS3.15 Annex E) | the standard's own X/Z/D/C action codes                                                                        |

See [`NOTICE`](./NOTICE) for the full attribution chain: NEMA (the Standard), OFFIS (DCMTK,
BSD-style) and Innolitics (MIT).

## Design notes

- **Value multiplicity keeps its constraint.** `"2-2n"` becomes `{ min: 2, max: null, multipleOf: 2 }`.
  Storing `[min, max]` — as most implementations do — silently accepts a VM of 3.
- **Ambiguous VRs stay ambiguous.** `US or SS` is reported as `['US','SS']` with a resolver that
  takes PixelRepresentation, rather than a guess baked in at build time.
- **No JSON imports at runtime.** Data ships as generated TS/JS modules (import attributes are a
  bundler compatibility minefield); the raw JSON is shipped as artifacts for other languages.
- **Subpath exports per dataset**, so a VR lookup never pulls the private-tag table.

## Status

Under active construction. Landed: the tag codec. Next: UIDs/SOP classes/transfer syntaxes, then
attributes, then private tags and de-identification.

## License

MIT — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
