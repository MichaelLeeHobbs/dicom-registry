/**
 * Value Multiplicity — how many values an attribute may carry.
 *
 * VM is routinely stored as a `[min, max]` pair, which silently discards the
 * part that matters most. `2-2n` does not mean "two or more"; it means an
 * **even** number of values, two or more — an odd count is malformed. Both
 * implementations this registry replaces store the pair and lose the stride, so
 * neither can reject a three-value `ImagePositionPatient`-style violation.
 *
 * PS3.6 also uses one alternation, `1-n or 1`, where the permitted count
 * depends on which VR is in use ({@link https://dicom.nema.org/medical/dicom/current/output/chtml/part06/chapter_6.html | PS3.6 Table 6-1},
 * LUT Data). That is kept rather than flattened, so a validator can accept
 * either reading instead of guessing one.
 *
 * @module vm
 */

/** One permitted count range. */
export interface VmConstraint {
    /** Fewest values permitted. */
    readonly min: number;
    /** Most values permitted, or `null` when unbounded (`n`). */
    readonly max: number | null;
    /**
     * Values must arrive in groups of this size. `1` for most attributes; `2`
     * for `2-2n`, `3` for `3-3n`. This is the field a `[min, max]` model drops.
     */
    readonly multipleOf: number;
}

/** A parsed VM: one or more alternative constraints, plus the source text. */
export interface Vm {
    /** The PS3.6 text this was parsed from, e.g. `2-2n`. */
    readonly source: string;
    /** Alternatives; length 1 for every VM except `1-n or 1`. */
    readonly alternatives: readonly VmConstraint[];
}

/** `3`, `1-3`, `1-n`, `2-2n` — the four shapes PS3.6 uses. */
const SINGLE = /^(\d+)(?:-(\d+)?(n)?)?$/;
const ALTERNATION = ' or ';

function parseConstraint(text: string): VmConstraint | undefined {
    const match = SINGLE.exec(text);
    if (match === null) {
        return undefined;
    }
    const min = Number.parseInt(match[1] as string, 10);
    const bound = match[2];
    const unbounded = match[3] === 'n';
    if (text.includes('-') && bound === undefined && !unbounded) {
        return undefined; // `1-` states no upper end at all
    }
    if (bound === undefined) {
        // `3` is exactly three; `3-n` is three or more
        return unbounded ? { min, max: null, multipleOf: 1 } : { min, max: min, multipleOf: 1 };
    }
    const value = Number.parseInt(bound, 10);
    // `2-2n` — the bound is a stride, not a maximum
    return unbounded ? { min, max: null, multipleOf: value } : { min, max: value, multipleOf: 1 };
}

/**
 * Parses a VM in PS3.6 notation.
 *
 * @param text - The VM text, e.g. `1`, `1-n`, `2-2n`, `1-n or 1`
 * @returns The parsed VM, or `undefined` when the text is not valid VM notation
 * @example
 * ```ts
 * parseVm('2-2n')?.alternatives[0]; // { min: 2, max: null, multipleOf: 2 }
 * ```
 */
export function parseVm(text: string): Vm | undefined {
    const alternatives: VmConstraint[] = [];
    for (const part of text.split(ALTERNATION)) {
        const constraint = parseConstraint(part.trim());
        if (constraint === undefined) {
            return undefined;
        }
        alternatives.push(constraint);
    }
    return alternatives.length === 0 ? undefined : { source: text, alternatives };
}

function satisfies(count: number, constraint: VmConstraint): boolean {
    if (count < constraint.min || (constraint.max !== null && count > constraint.max)) {
        return false;
    }
    return count % constraint.multipleOf === 0;
}

/**
 * Whether a value count satisfies a VM.
 *
 * A VM with alternatives is satisfied when **any** alternative accepts the
 * count, since the standard permits either reading.
 *
 * @param count - Number of values present
 * @param vm - The parsed VM
 * @returns `true` when the count is permitted
 * @example
 * ```ts
 * isValidVm(3, parseVm('2-2n')!); // false — must be even
 * ```
 */
export function isValidVm(count: number, vm: Vm): boolean {
    return vm.alternatives.some(constraint => satisfies(count, constraint));
}
