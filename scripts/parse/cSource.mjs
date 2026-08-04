/**
 * Minimal primitives for reading the hand-maintained C++ tables in DCMTK.
 *
 * These are not a C++ parser and do not try to be. They handle exactly the
 * constructs the two tables we consume actually use — comments, preprocessor
 * conditionals, `#define`d string literals, `typedef struct` declarations,
 * enum members, and brace-balanced array initializers — and **throw on
 * anything unexpected**. A silently-degraded parse would ship a smaller or
 * subtly wrong dictionary, which is far worse than a failed build.
 */

/** Thrown when the source does not look the way the parser requires. */
export class CParseError extends Error {
    constructor(message) {
        super(`C source parse: ${message}`);
        this.name = 'CParseError';
    }
}

/** Removes comments, preserving newlines so reported line numbers stay usable. */
export function stripComments(source) {
    let out = '';
    let i = 0;
    while (i < source.length) {
        const two = source.slice(i, i + 2);
        if (two === '//') {
            const end = source.indexOf('\n', i);
            i = end === -1 ? source.length : end;
        } else if (two === '/*') {
            const end = source.indexOf('*/', i + 2);
            if (end === -1) {
                throw new CParseError('unterminated block comment');
            }
            out += source.slice(i, end).replace(/[^\n]/g, ' ');
            i = end + 2;
        } else if (source[i] === '"') {
            const end = endOfStringLiteral(source, i);
            out += source.slice(i, end);
            i = end;
        } else {
            out += source[i];
            i++;
        }
    }
    return out;
}

/** Index one past the closing quote of the string literal starting at `start`. */
function endOfStringLiteral(source, start) {
    let i = start + 1;
    while (i < source.length) {
        if (source[i] === '\\') {
            i += 2;
            continue;
        }
        if (source[i] === '"') {
            return i + 1;
        }
        i++;
    }
    throw new CParseError('unterminated string literal');
}

/**
 * Resolves `#ifdef` / `#ifndef` / `#else` / `#endif` against a set of macros
 * treated as defined, keeping only the surviving branch.
 *
 * Which branch is kept is an editorial decision the caller must make and
 * record — for the transfer syntax table, `WITH_ZLIB` decides whether the
 * deflated syntax reports zlib or "unsupported", and only one of those is a
 * fact about DICOM rather than about a build.
 */
export function applyConditionals(source, defined) {
    const keep = [];
    const stack = [];
    for (const line of source.split('\n')) {
        const directive = /^\s*#\s*(ifdef|ifndef|else|endif|if)\b\s*(\w+)?/.exec(line);
        if (directive === null) {
            keep.push(stack.every(Boolean) ? line : '');
            continue;
        }
        const [, kind, name] = directive;
        if (kind === 'ifdef') {
            stack.push(defined.has(name));
        } else if (kind === 'ifndef') {
            stack.push(!defined.has(name));
        } else if (kind === 'if') {
            stack.push(true); // no #if in the tables we read; keep the branch
        } else if (kind === 'else') {
            if (stack.length === 0) {
                throw new CParseError('#else without a matching #if');
            }
            stack[stack.length - 1] = !stack[stack.length - 1];
        } else if (stack.pop() === undefined) {
            throw new CParseError('#endif without a matching #if');
        }
        keep.push('');
    }
    if (stack.length !== 0) {
        throw new CParseError(`${stack.length} unterminated preprocessor conditional(s)`);
    }
    return keep.join('\n');
}

/** Collects `#define NAME "literal"` macros into a Map. */
export function parseStringDefines(source) {
    const macros = new Map();
    const pattern = /^[ \t]*#[ \t]*define[ \t]+(\w+)[ \t]+("(?:[^"\\]|\\.)*"(?:[ \t]*"(?:[^"\\]|\\.)*")*)[ \t]*$/gm;
    for (const match of source.matchAll(pattern)) {
        macros.set(match[1], joinStringLiteral(match[2]));
    }
    return macros;
}

/** Concatenates adjacent C string literals and unescapes them. */
function joinStringLiteral(expr) {
    let value = '';
    for (const literal of expr.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
        value += literal[1].replace(/\\(.)/g, (_all, ch) => (ch === 'n' ? '\n' : ch === 't' ? '\t' : ch));
    }
    return value;
}

/**
 * Field names of a `typedef struct { ... } Name;`, in declaration order.
 *
 * Reading the declaration is what lets record fields be mapped **by name**;
 * hard-coding "field 4 is the status" would silently mis-assign every column
 * the day upstream inserts one.
 */
export function parseStructFields(source, typeName) {
    const pattern = new RegExp(`typedef\\s+struct\\s*\\{([\\s\\S]*?)\\}\\s*${typeName}\\s*;`);
    const match = pattern.exec(source);
    if (match === null) {
        throw new CParseError(`struct ${typeName} not found`);
    }
    const fields = [];
    for (const declaration of match[1].split(';')) {
        const name = /(\w+)\s*$/.exec(declaration.trim());
        if (declaration.trim() !== '' && name !== null) {
            fields.push(name[1]);
        }
    }
    if (fields.length === 0) {
        throw new CParseError(`struct ${typeName} declared no fields`);
    }
    return fields;
}

/** Collects every `ENUM_Member = n` into a Map of member name to number. */
export function parseEnumMembers(source) {
    const members = new Map();
    for (const match of source.matchAll(/\b([A-Z][A-Za-z]{1,4}_\w+)\s*=\s*(\d+)/g)) {
        members.set(match[1], Number(match[2]));
    }
    return members;
}

/**
 * Collects the member names declared inside `enum { ... }` blocks.
 *
 * Separate from {@link parseEnumMembers} because DCMTK declares some enums with
 * explicit values (`EXS_LittleEndianImplicit = 0`) and others without
 * (`EUST_Storage,`). Membership, not the numeric value, is what the field
 * mappers check, so this collects both forms.
 */
export function parseEnumTokens(source) {
    const tokens = new Set();
    for (const block of source.matchAll(/\benum\b[^{;]*\{([^}]*)\}/g)) {
        for (const item of block[1].split(',')) {
            const name = /^\s*([A-Z][A-Za-z0-9]*_\w+)/.exec(item);
            if (name !== null) {
                tokens.add(name[1]);
            }
        }
    }
    if (tokens.size === 0) {
        throw new CParseError('no enum members found — the declaration style changed');
    }
    return tokens;
}

/** Collects `#define NAME 0x1234UL` style numeric macros into a Map. */
export function parseNumericDefines(source) {
    const macros = new Map();
    for (const match of source.matchAll(/^[ \t]*#[ \t]*define[ \t]+(\w+)[ \t]+(0[xX][0-9a-fA-F]+|\d+)[UL]*[ \t]*$/gm)) {
        macros.set(match[1], Number(match[2]));
    }
    return macros;
}

/**
 * Resolves an OR-ed flag expression such as
 * `UID_PROP_NON_PATIENT | UID_PROP_NO_DIR_RECORD` to the set of flag names.
 *
 * Returns names rather than a bitmask: the emitted data is meant to be read by
 * a human reviewing a diff, and `['nonPatient']` survives an upstream
 * renumbering where `1` would not.
 */
export function resolveFlags(expr, macros) {
    const names = [];
    for (const token of expr.split('|').map(part => part.trim())) {
        if (token === '') {
            continue;
        }
        if (!macros.has(token)) {
            throw new CParseError(`unknown flag macro '${token}'`);
        }
        if (macros.get(token) !== 0) {
            names.push(token);
        }
    }
    return names;
}

/** The text between the outermost braces of `... name[] = { ... };`. */
export function extractArrayBody(source, arrayName) {
    const start = new RegExp(`\\b${arrayName}\\s*\\[\\s*\\]\\s*=\\s*\\{`).exec(source);
    if (start === null) {
        throw new CParseError(`array ${arrayName}[] not found`);
    }
    const open = start.index + start[0].length - 1;
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        const ch = source[i];
        if (ch === '"') {
            i = endOfStringLiteral(source, i) - 1;
            continue;
        }
        if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0) {
                return source.slice(open + 1, i);
            }
        }
    }
    throw new CParseError(`array ${arrayName}[] initializer is unterminated`);
}

/** Splits on `,` at brace/paren depth zero, ignoring commas inside strings. */
export function splitTopLevel(text) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"') {
            const end = endOfStringLiteral(text, i);
            current += text.slice(i, end);
            i = end - 1;
            continue;
        }
        if (ch === '{' || ch === '(') {
            depth++;
        } else if (ch === '}' || ch === ')') {
            depth--;
        }
        if (ch === ',' && depth === 0) {
            parts.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    parts.push(current);
    return parts.map(part => part.trim()).filter(part => part !== '');
}

/** Strips one layer of `{ ... }` from a record, or throws. */
export function unwrapBraces(record, context) {
    const trimmed = record.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
        throw new CParseError(`${context}: expected a brace-wrapped record, got ${trimmed.slice(0, 60)}`);
    }
    return trimmed.slice(1, -1);
}

/**
 * Resolves a field that should be a string: a literal, adjacent literals, or a
 * macro that expands to one.
 *
 * @returns the string, or `undefined` when the expression is not string-valued
 */
export function resolveString(expr, macros) {
    const trimmed = expr.trim();
    if (trimmed.startsWith('"')) {
        return joinStringLiteral(trimmed);
    }
    if (/^\w+$/.test(trimmed) && macros.has(trimmed)) {
        return macros.get(trimmed);
    }
    return undefined;
}

/**
 * Resolves a string field that must be string-valued — `NULL` is as much a
 * parse failure as an unrecognized expression.
 *
 * @throws CParseError when the expression is not string-valued
 */
export function resolveRequiredString(expr, macros, field) {
    const value = resolveString(expr, macros);
    if (value === undefined) {
        throw new CParseError(`${field}: expected a string literal or a string macro — got '${expr.trim().slice(0, 60)}'`);
    }
    return value;
}

/**
 * Resolves a string field that upstream may deliberately leave as `NULL`.
 *
 * The distinction matters: `null` means DCMTK states there is no value (a
 * private transfer syntax has no official PS3.6 keyword), whereas a field this
 * parser merely failed to understand must fail the build rather than quietly
 * become empty.
 *
 * @throws CParseError when the expression is neither NULL nor string-valued
 */
export function resolveNullableString(expr, macros, field) {
    const trimmed = expr.trim();
    if (trimmed === 'NULL' || trimmed === '0') {
        return null;
    }
    const value = resolveString(trimmed, macros);
    if (value === undefined) {
        throw new CParseError(`${field}: expected a string literal, a string macro, or NULL — got '${trimmed.slice(0, 60)}'`);
    }
    return value;
}

/** Resolves an integer field such as `0L`, `1L`, `12`. */
export function resolveInt(expr) {
    const match = /^(\d+)[UL]*$/i.exec(expr.trim());
    if (match === null) {
        throw new CParseError(`expected an integer literal, got '${expr.trim()}'`);
    }
    return Number(match[1]);
}

/** Resolves `OFTrue` / `OFFalse`. */
export function resolveBool(expr) {
    const trimmed = expr.trim();
    if (trimmed === 'OFTrue') {
        return true;
    }
    if (trimmed === 'OFFalse') {
        return false;
    }
    throw new CParseError(`expected OFTrue/OFFalse, got '${trimmed}'`);
}

/**
 * Resolves an enum field, checking the token against the members declared in
 * the header. An unknown token means upstream added a state we do not model.
 */
export function resolveEnum(expr, prefix, members) {
    const token = expr.trim();
    if (!token.startsWith(prefix)) {
        throw new CParseError(`expected a ${prefix}* enum member, got '${token}'`);
    }
    if (!members.has(token)) {
        throw new CParseError(`enum member '${token}' is not declared in the header — upstream added a state we do not model`);
    }
    return token;
}
