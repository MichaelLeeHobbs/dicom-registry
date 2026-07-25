import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VERSION } from './version';

describe('VERSION', () => {
    it('matches package.json (a release with these out of step is a broken release)', () => {
        const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version: string };
        expect(VERSION).toBe(manifest.version);
    });
});
