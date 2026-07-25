# Security Policy

## Supported versions

Pre-1.0: only the latest published version is supported.

## Reporting a vulnerability

Please report suspected vulnerabilities through **GitHub's private vulnerability reporting**
(Security → Report a vulnerability on this repository), not in a public issue, discussion, or pull
request.

Expect an acknowledgement within 72 hours.

## Scope

This package ships **data and lookup functions only** — it never parses DICOM byte streams, opens
files, or performs network I/O. The realistic risk surface is therefore:

- **Incorrect data.** A wrong VR, VM, UID category or de-identification action code can cause a
  consumer to mis-parse an object or, in the de-identification case, **fail to remove an identifier**.
  Treat data defects affecting `deident` as security-relevant and report them privately.
- **Build-time supply chain.** Data is generated from pinned upstream revisions (DCMTK, Innolitics)
  recorded in `sources/SOURCES.json`. Generated output is committed and diffed on every source bump,
  so an unexpected upstream change fails the build rather than silently altering the data.
- **Denial of service via pathological input** to the lookup functions (e.g. very long strings passed
  to the tag parser).

## Not in scope

- Vulnerabilities in DCMTK, the Innolitics parser, or the DICOM Standard itself — report those
  upstream.
- Consumers misusing the data (for example, relying on the basic de-identification profile alone as
  a complete anonymization strategy).
