/**
 * Notation policy shared by the generators.
 *
 * `src/tag.ts` is a faithful *codec*: it reads what a notation literally says.
 * Deciding that PS3.6's `(60XX,3000)` means even groups only is a *policy*
 * judgement about the standard, so it lives here, in the build, where the
 * decision is reviewable as a diff — not inside the codec, where it would make
 * `toTagRange` disagree with the text it was handed.
 */

/** Splits `(gggg,eeee)` into its two halves. */
export function tagHalves(tagText) {
    const [group = '', element = ''] = tagText.replace(/^\(|\)$/g, '').split(',');
    return { group, element };
}

/**
 * Rewrites a PS3.6 group wildcard to the even-only range it actually denotes.
 *
 * PS3.6 writes repeating groups as `(60XX,3000)`, which taken literally covers
 * all 256 groups. PS3.5 §7.1 makes every odd group private, so an odd group can
 * never carry the standard attribute the row describes. The wildcard therefore
 * means `6000-60FF` with an even stride, and writing it out that way keeps
 * `(6001,3000)` from resolving to Overlay Data.
 *
 * Only the group half is rewritten. Elements have no parity rule, so an element
 * wildcard is left exactly as PS3.6 wrote it.
 *
 * @param tagText - A tag in PS3.6 notation
 * @returns The tag with any group wildcard expanded to an even-only range
 */
export function normalizeGroupWildcard(tagText) {
    const { group, element } = tagHalves(tagText);
    if (!/x/i.test(group)) {
        return tagText;
    }
    const lo = group.replace(/x/gi, '0');
    const hi = group.replace(/x/gi, 'F');
    return `(${lo}-${hi},${element})`;
}
