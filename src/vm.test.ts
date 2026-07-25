import { describe, expect, it } from 'vitest';
import { isValidVm, parseVm, type Vm } from './vm';

const vm = (text: string): Vm => {
    const parsed = parseVm(text);
    expect(parsed, `should parse: ${text}`).toBeDefined();
    return parsed as Vm;
};

describe('parseVm', () => {
    it('parses an exact count', () => {
        expect(vm('3').alternatives).toEqual([{ min: 3, max: 3, multipleOf: 1 }]);
    });

    it('parses a bounded range', () => {
        expect(vm('1-32').alternatives).toEqual([{ min: 1, max: 32, multipleOf: 1 }]);
    });

    it('parses an unbounded range', () => {
        expect(vm('1-n').alternatives).toEqual([{ min: 1, max: null, multipleOf: 1 }]);
    });

    it('keeps the stride of an n-multiple VM', () => {
        // the constraint a [min, max] model drops: 2-2n is EVEN counts, not
        // "two or more", and both dictionaries this replaces store the pair
        expect(vm('2-2n').alternatives).toEqual([{ min: 2, max: null, multipleOf: 2 }]);
        expect(vm('3-3n').alternatives).toEqual([{ min: 3, max: null, multipleOf: 3 }]);
    });

    it('parses the one alternation PS3.6 uses', () => {
        expect(vm('1-n or 1').alternatives).toEqual([
            { min: 1, max: null, multipleOf: 1 },
            { min: 1, max: 1, multipleOf: 1 },
        ]);
    });

    it('preserves the source text', () => {
        expect(vm('2-2n').source).toBe('2-2n');
    });

    it.each(['', 'n', '1-', 'many', '1-2-3', 'a-b', '1 or', '-1'])('rejects %s', text => {
        expect(parseVm(text)).toBeUndefined();
    });
});

describe('isValidVm', () => {
    it('enforces an exact count', () => {
        expect(isValidVm(3, vm('3'))).toBe(true);
        expect(isValidVm(2, vm('3'))).toBe(false);
        expect(isValidVm(4, vm('3'))).toBe(false);
    });

    it('enforces bounds', () => {
        expect(isValidVm(1, vm('1-32'))).toBe(true);
        expect(isValidVm(32, vm('1-32'))).toBe(true);
        expect(isValidVm(33, vm('1-32'))).toBe(false);
        expect(isValidVm(0, vm('1-32'))).toBe(false);
    });

    it('rejects an odd count for 2-2n — the check a [min, max] model cannot make', () => {
        const evenPairs = vm('2-2n');
        expect(isValidVm(2, evenPairs)).toBe(true);
        expect(isValidVm(4, evenPairs)).toBe(true);
        expect(isValidVm(100, evenPairs)).toBe(true);
        expect(isValidVm(3, evenPairs)).toBe(false);
        expect(isValidVm(5, evenPairs)).toBe(false);
        expect(isValidVm(0, evenPairs)).toBe(false);
    });

    it('rejects counts that are not a multiple of three for 3-3n', () => {
        expect(isValidVm(3, vm('3-3n'))).toBe(true);
        expect(isValidVm(9, vm('3-3n'))).toBe(true);
        expect(isValidVm(4, vm('3-3n'))).toBe(false);
    });

    it('accepts a count matching any alternative', () => {
        const lutData = vm('1-n or 1');
        expect(isValidVm(1, lutData)).toBe(true);
        expect(isValidVm(4096, lutData)).toBe(true);
        expect(isValidVm(0, lutData)).toBe(false);
    });

    it('accepts an unbounded upper end', () => {
        expect(isValidVm(1_000_000, vm('1-n'))).toBe(true);
    });
});
