/**
 * Redaction for provenance recorded into committed fixtures.
 *
 * Kept in its own module rather than inline in the extractor so it can be
 * tested: a silent regression here writes someone's token into a file whose
 * whole purpose is to be committed.
 */

/**
 * Strips any userinfo from a remote URL.
 *
 * A clone URL may carry a credential (`https://x-access-token:ghp_...@host/o/r`).
 * The host and path are the provenance that matters; the userinfo never is. An
 * scp-style `git@host:o/r` is not a URL and has no secret to strip, so it is
 * returned unchanged.
 *
 * @param url - the remote URL, or `null` when git reported none
 * @returns the URL without userinfo
 */
export function redactRemote(url) {
    if (url === null) {
        return null;
    }
    try {
        const parsed = new URL(url);
        if (parsed.username === '' && parsed.password === '') {
            return url;
        }
        parsed.username = '';
        parsed.password = '';
        return parsed.toString();
    } catch {
        // not a parseable URL (scp-style, or a local path) — no userinfo syntax
        return url;
    }
}
