## What

<!-- What changed, and why. Link the issue if there is one. -->

## Checklist

- [ ] `pnpm run lint`, `pnpm run typecheck`, `pnpm run format:check` pass
- [ ] `pnpm run test:coverage` passes (95/90/95/95 thresholds)
- [ ] Public API changes carry TSDoc with `@param` / `@returns` / `@throws`
- [ ] New behaviour has a test that **fails without the change**
- [ ] Data changes were produced by `pnpm run data:build`, not hand-edited, and `pnpm run data:diff` passes
- [ ] An upstream source bump is in **its own PR** with the diff report in the description
- [ ] `CHANGELOG.md` updated under `## [Unreleased]`
