import { describe, expect, it } from 'vitest';
import { redactRemote } from '../../scripts/differential/redact.mjs';

/**
 * The extractor records the source repository's remote in a fixture that is
 * then committed. A credential embedded in that URL must never survive the
 * round trip, so the redaction is asserted rather than trusted.
 */
describe('redactRemote', () => {
    it('strips an embedded token from an HTTPS remote', () => {
        expect(redactRemote('https://x-access-token:ghp_exampleToken@github.com/owner/repo.git')).toBe('https://github.com/owner/repo.git');
    });

    it('strips user:password credentials', () => {
        expect(redactRemote('https://user:password@gitlab.com/owner/repo.git')).toBe('https://gitlab.com/owner/repo.git');
    });

    it('leaves a credential-free URL byte-identical', () => {
        expect(redactRemote('https://github.com/owner/repo.git')).toBe('https://github.com/owner/repo.git');
    });

    it('leaves an scp-style remote alone — git@ is a user, not a secret', () => {
        expect(redactRemote('git@github.com:owner/repo.git')).toBe('git@github.com:owner/repo.git');
    });

    it('passes through a local path', () => {
        expect(redactRemote('/srv/git/repo')).toBe('/srv/git/repo');
    });

    it('reports no remote as null', () => {
        expect(redactRemote(null)).toBeNull();
    });

    it.each([
        'https://x-access-token:ghp_exampleToken@github.com/owner/repo.git',
        'https://user:password@gitlab.com/owner/repo.git',
        'ssh://git:secret@example.com/owner/repo.git',
    ])('leaks nothing secret-shaped from %s', url => {
        expect(redactRemote(url)).not.toMatch(/ghp_|password|secret/);
    });
});
