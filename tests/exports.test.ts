import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const packageJson = JSON.parse(read('package.json')) as {
    exports: Record<string, unknown>;
    files: string[];
};

describe('package entry points', () => {
    it('publishes a subpath for every dataset', () => {
        expect(Object.keys(packageJson.exports)).toEqual(['.', './tag', './uid', './vm', './vr', './attributes', './deident', './private', './package.json']);
    });

    it('keeps the private dictionary OUT of the barrel', () => {
        // the opt-in is the subpath: a consumer that never imports
        // `@ubercode/dicom-registry/private` never pays for the largest table
        // here. Re-exporting it from the barrel would silently undo that, and
        // nothing else would fail, so it is asserted rather than commented.
        const barrel = read('src/index.ts');
        expect(barrel).not.toMatch(/from '\.\/private'/);
        expect(barrel).not.toMatch(/from '\.\/generated\/privateTags'/);
    });

    it('reaches every other module from the barrel', () => {
        const barrel = read('src/index.ts');
        for (const module of ['./tag', './uid', './vm', './vr', './attributes', './deident']) {
            expect(barrel, `barrel should re-export ${module}`).toContain(`'${module}'`);
        }
    });

    it('builds an entry for every published subpath', () => {
        const config = read('tsdown.config.ts');
        for (const name of ['index', 'tag', 'uid', 'vm', 'vr', 'attributes', 'deident', 'private']) {
            expect(config, `tsdown should build ${name}`).toMatch(new RegExp(`\\b${name}: 'src/`));
        }
    });

    it('ships the JSON artifacts alongside the code', () => {
        expect(packageJson.files).toContain('data');
        expect(packageJson.files).toContain('dist');
    });
});
