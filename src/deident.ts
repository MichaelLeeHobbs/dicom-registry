/**
 * De-identification actions — PS3.15 Annex E Table E.1-1.
 *
 * The table has two halves, and using only the first is the common mistake.
 * The **Basic Profile** gives a baseline action for every attribute it names.
 * Ten **retained options** then each say what changes if a de-identifier
 * chooses to keep something — device identity, longitudinal dates, UIDs. An
 * implementation carrying only the basic profile column cannot support any
 * option, and options are most of real de-identification.
 *
 * Actions are kept as ordered alternatives, not resolved. `X/Z` means "remove,
 * unless a zero-length value is needed to keep the IOD conformant" — a question
 * only the caller writing the IOD can answer.
 *
 * **This module says what the standard requires. It does not de-identify
 * anything**, and applying these actions correctly is the caller's
 * responsibility: PS3.15 conformance also depends on pixel data, burned-in
 * annotation and private attributes that no table can decide for you.
 *
 * @module deident
 */

import { DEIDENTIFICATION, DEIDENTIFICATION_OPTIONS, type PackedDeidentification } from './generated/deidentification';
import { isInTagRange, tagRangeSize, toTag, toTagRange, type TagLike, type TagRange } from './tag';

/**
 * A PS3.15 §E.1 action code.
 *
 * - `X` — remove the attribute
 * - `Z` — replace with a zero-length value
 * - `D` — replace with a non-zero-length dummy value
 * - `U` — replace with a new, internally consistent UID
 * - `K` — keep unchanged
 * - `C` — clean: replace with a value of similar meaning, free of identity
 */
export type DeidAction = 'X' | 'Z' | 'D' | 'U' | 'K' | 'C';

/** The retained options PS3.15 defines, in table column order. */
export type DeidOption = (typeof DEIDENTIFICATION_OPTIONS)[number];

/** An action cell: ordered alternatives plus the notation they came from. */
export interface DeidActionSpec {
    /** The cell verbatim, e.g. `X/Z/U*`. The `*` marks the clean variant of `U`. */
    readonly source: string;
    /** The codes, in the order the standard lists them. */
    readonly codes: readonly DeidAction[];
}

/** One row of Table E.1-1. */
export interface DeidEntry {
    /** The tag in dictionary notation; repeating groups are even-only ranges. */
    readonly tag: string;
    /** The tags this row covers. */
    readonly range: TagRange;
    readonly name: string | null;
    /** Whether the attribute appears in a standard composite IOD. */
    readonly inStandardIod: boolean;
    /** The Basic Profile action. */
    readonly basicProfile: DeidActionSpec;
    /** Per-option actions; an option absent here says nothing about this attribute. */
    readonly options: Readonly<Partial<Record<DeidOption, DeidActionSpec>>>;
}

function toSpec(source: string): DeidActionSpec {
    return { source, codes: source.replace(/\*/g, '').split('/') as DeidAction[] };
}

function toEntry(row: PackedDeidentification): DeidEntry {
    const range = toTagRange(row[0]);
    if (range === undefined) {
        throw new Error(`deident: generated table contains an unreadable tag '${row[0]}'`);
    }
    const options: Partial<Record<DeidOption, DeidActionSpec>> = {};
    DEIDENTIFICATION_OPTIONS.forEach((option, position) => {
        const cell = row[4][position];
        if (cell !== null && cell !== undefined) {
            options[option] = toSpec(cell);
        }
    });
    return { tag: row[0], range, name: row[1], inStandardIod: row[2], basicProfile: toSpec(row[3]), options };
}

interface Index {
    readonly all: readonly DeidEntry[];
    /** Narrowest range first, so a named attribute beats the private catch-all. */
    readonly ordered: readonly DeidEntry[];
}

let index: Index | undefined;

function indexed(): Index {
    if (index === undefined) {
        const all = DEIDENTIFICATION.map(toEntry);
        const ordered = [...all].sort((a, b) => tagRangeSize(a.range) - tagRangeSize(b.range));
        index = { all, ordered };
    }
    return index;
}

/**
 * Looks up the de-identification rule for a tag.
 *
 * Repeating groups and the odd-group private catch-all resolve through their
 * ranges, narrowest first — so a specifically named attribute wins over the
 * blanket private rule.
 *
 * @param tag - The tag, in any supported notation
 * @returns The rule, or `undefined` when PS3.15 names no action for it
 */
export function lookupDeidentification(tag: TagLike): DeidEntry | undefined {
    const resolved = toTag(tag);
    return indexed().ordered.find(entry => isInTagRange(resolved, entry.range));
}

/** Every row of Table E.1-1, in table order. */
export function allDeidentification(): readonly DeidEntry[] {
    return indexed().all;
}

/** Every retained option PS3.15 defines. */
export function deidentificationOptions(): readonly DeidOption[] {
    return DEIDENTIFICATION_OPTIONS;
}

/**
 * The action for a tag under the Basic Profile plus a chosen set of options.
 *
 * Options are applied in PS3.15 column order, and the last enabled option that
 * names this attribute wins. The standard does not define what should happen
 * when two options disagree about one attribute, so this is a stated
 * convention rather than a rule read off the table — {@link lookupDeidentification}
 * exposes every cell if you need to arbitrate differently.
 *
 * @param tag - The tag, in any supported notation
 * @param options - Retained options in force
 * @returns The effective action, or `undefined` when PS3.15 names none
 * @example
 * ```ts
 * // StudyInstanceUID is U under the basic profile, kept when UIDs are retained
 * deidentificationAction('(0020,000D)', []);            // codes: ['U']
 * deidentificationAction('(0020,000D)', ['retainUids']); // codes: ['K']
 * ```
 */
export function deidentificationAction(tag: TagLike, options: readonly DeidOption[]): DeidActionSpec | undefined {
    const entry = lookupDeidentification(tag);
    if (entry === undefined) {
        return undefined;
    }
    let action = entry.basicProfile;
    for (const option of DEIDENTIFICATION_OPTIONS) {
        const override = options.includes(option) ? entry.options[option] : undefined;
        if (override !== undefined) {
            action = override;
        }
    }
    return action;
}
