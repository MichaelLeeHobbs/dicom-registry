# Contributing

## Setup

```bash
pnpm install
pnpm run test          # vitest
pnpm run test:coverage # with 95/90/95/95 thresholds
pnpm run lint          # eslint --max-warnings 0
pnpm run typecheck     # TypeScript 7
pnpm run format:check  # prettier
pnpm run build         # tsdown -> ESM + CJS + DTS
```

All of the above must pass before a PR is mergeable.

**Two different Node floors, on purpose.** The library supports Node >= 20.16 (`engines`) and CI runs
the test suite on 20, 22 and 24 to prove it. The _build toolchain_ needs Node >= 22 — tsdown/rolldown
calls `Promise.withResolvers`, which does not exist on Node 20 — so `pnpm run build` runs once, on
Node 24. Building the same sources on three Node versions would verify the bundler, not the library.

## Ground rules

This repo follows `docs/TypeScript Coding Standard for Mission-Critical Systems.md`. The parts the
tooling enforces:

- **No `any`** — use `unknown` plus a type guard.
- **Complexity ≤ 10, ≤ 4 parameters, ≤ 40 lines per function.** Warnings are fatal
  (`--max-warnings 0`); extract a helper rather than raising a limit.
- **No recursion** — iterate with an explicit stack. Parsers here consume third-party text.
- **Typed errors**, never bare strings (see `TagFormatError`).
- **TSDoc on every public API**, with `@param`, `@returns` and `@throws`.

## Data is generated, never hand-edited

Anything under `src/generated/` and `data/` is emitted by `scripts/build-data.mjs`. Editing it by
hand will be silently overwritten on the next build and will fail `pnpm run data:diff`.

To change data, change the parser or the upstream pin:

```bash
pnpm run sources:fetch   # refresh vendored upstreams to the pins in sources/SOURCES.json
pnpm run data:build      # regenerate data/ and src/generated/
pnpm run data:diff       # fail if committed output disagrees with a fresh build
```

**A source bump is its own PR**, carrying the regenerated output and the diff report (entries
added, removed, VRs changed). This is deliberate: upstream shape changes should be reviewed by a
human, not merged inside an unrelated feature.

## Adding a dataset

1. Vendor the input under `sources/<upstream>/` and record its revision in `sources/SOURCES.json`.
2. Write a parser under `scripts/parse/` that **asserts its own expectations** (column counts,
   sentinel rows) and throws on a mismatch. A parser that silently returns fewer entries than the
   committed snapshot must fail the build — brittle upstream formats are the main risk here.
3. Emit both a JSON artifact in `data/` and a packed TS module in `src/generated/`.
4. Add a subpath export in `package.json` and a `tsdown` entry, so the dataset stays opt-in.
5. Cover the public API with tests, including the cases that motivated the dataset.

## Non-goals

- Parsing DICOM byte streams. Parsers depend on this package, never the reverse.
- Language bindings. JSON artifacts plus JSON Schema are the contract for non-TypeScript consumers.
- Site-specific or customer-identifying data of any kind. Vendor/manufacturer entries (when they
  land) must be generic industry facts with recorded provenance.
