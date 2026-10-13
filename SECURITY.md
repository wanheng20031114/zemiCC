# Security model

zemiCC is a local, single-user coding tool. It is not designed for network hosting or untrusted multi-user access.

## Credentials

- There is no credential storage or environment-file loader. Users enter their own key in the app.
- The input is masked and cleared immediately on submission. The UI stores only connection status.
- The backend retains a key in a private in-memory field. It passes the key to the SDK child process environment for authentication. It does not log requests, headers, SDK stderr, or raw SDK events.
- SDK transcript persistence is explicitly disabled. User environment credentials, global Claude settings, custom gateways and inherited entrypoint overrides are excluded from the SDK process.
- App events and local history redact the live key and common credential formats. Streaming holds back incomplete prefixes of the live key to avoid exposing it across event boundaries.
- Closing the desktop app terminates its workers and releases the key. Browser mode requires stopping the server. JavaScript strings cannot provide cryptographic zeroization guarantees; memory dumps, swap and hostile software running as the same OS user are outside this boundary.

## Local service

- Listens only on `127.0.0.1`.
- Exact Host and Origin checks reject DNS rebinding and cross-origin calls. No permissive CORS.
- A random per-process capability protects the API. Mutations require a header; reads and SSE use an HttpOnly SameSite cookie. The bootstrap endpoint requires a custom header.
- CSP, frame denial, request size limits, plain text file previews and Markdown without raw HTML reduce browser attack surface. Remote model-supplied images do not load.
- Electron uses an in-memory browser partition, disabled HTTP cache, sandboxed renderers, context isolation, no Node integration and no webview. External navigation stays outside the app.

## Agent operations

Read/Write/Edit paths must stay in the selected project. Existing ancestors and symlinks/junctions are resolved; `.env`, private key files, credential directories, `.git`, and app data are blocked by app file APIs and path-based tool checks. This is a defense against common accidental access, not a general secret scanner.

PreToolUse hooks enforce checks even when SDK defaults would otherwise allow a tool. Commands, file writes and searches require a one-time approval. No "always allow" or bypass-permissions mode is exposed. Arbitrary shell commands are not sandboxed and, once approved, can bypass path restrictions or access process credentials. Review them carefully. New tools and external integrations are not enabled implicitly.

Each SDK worker has a 40-turn task limit and a USD 5 estimated spend cap for its lifetime. Estimates are not billing statements. Stopping a worker is best effort and cannot undo completed side effects or necessarily stop processes deliberately detached by an approved command. The agent is instructed not to detach processes.

## Local data

`.zemicc/` contains project paths, redacted conversations and non-secret SDK runtime metadata. It is ignored by Git. Session deletion removes the app's current record but is not secure deletion of disk sectors, backups or SDK runtime metadata. Project source and conversations may be sent to Anthropic when the user starts a task. No project content is published to GitHub by the app.

Report reproducible security issues privately to the repository owner, without attaching live credentials or private conversations.
