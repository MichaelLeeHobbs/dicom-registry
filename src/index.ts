/**
 * `@ubercode/dicom-registry` — the DICOM registry as data.
 *
 * Tags, UIDs, SOP classes, transfer syntaxes, private tags, VR/VM rules and
 * de-identification actions, generated from pinned upstream sources with zero
 * runtime dependencies.
 *
 * This barrel re-exports everything. Consumers that care about payload should
 * import the subpath they need instead — `@ubercode/dicom-registry/tag` carries
 * no data tables at all, and `/private` is opt-in for the same reason.
 *
 * **Non-goal:** this package never parses DICOM byte streams. Parsers depend on
 * the registry, never the reverse.
 *
 * @packageDocumentation
 */

export { VERSION } from './version';
export {
    TagFormatError,
    isGroupLength,
    isInTagRange,
    isPrivateTag,
    tag,
    tagElement,
    tagGroup,
    tagRangeBase,
    tagRangeSize,
    tagRangeToString,
    toHex,
    toParenthesized,
    toPrefixed,
    toTag,
    toTagRange,
    tryToTag,
    type Tag,
    type TagLike,
    type TagRange,
} from './tag';
export * from './uid';
export * from './vm';
export * from './vr';
export * from './attributes';
export * from './deident';
