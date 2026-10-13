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
- Electron uses an in-memory browser partition, disabled HTTP cache, sandboxed renderers, context isolation, no Node integration and no webview. Its narrow preload bridge exposes only display zoom; IPC validates the sender and numeric bounds. External navigation stays outside the app.

## Agent operations

Read/Write/Edit paths must stay in the selected project. Existing ancestors and symlinks/junctions are resolved; `.env`, private key files, credential directories, `.git`, and app data are blocked by app file APIs and path-based tool checks. This is a defense against common accidental access, not a general secret scanner.

The default **project auto** mode allows guarded file reads/edits and source-file searches. Shell commands pass through the official SDK's `auto` permission mode: zemiCC does not return a blanket hook allow for commands. Additional best-effort rules request human review for recognizable deletion, history rewriting, publishing, sensitive-data, privilege and background-process commands. These patterns are review triggers, not a complete shell parser or security boundary. The SDK reviews the remaining commands. A missing or unavailable classifier never causes zemiCC to silently switch to bypass mode; SDK fallback is shown in the conversation and command prompts remain available.

The optional **manual** mode requests review for file writes, content searches and commands. Users can switch the current idle conversation and the default for future conversations through an authenticated API; running/pending tasks cannot change modes. PreToolUse denies still apply in both modes. Any escalation that reaches `canUseTool` is presented to the user even if a local check looks routine; AskUserQuestion always remains interactive. No bypass-permissions mode or whole-shell permanent allow rule is exposed. Unknown tools request review.

Arbitrary shell commands are not sandboxed and can access disk, process credentials and the network after either automatic or human approval. The classifier can make mistakes, and code invoked by a seemingly routine build/test can have arbitrary side effects. Project file-path checks do not constrain shell processes or every file reached by recursive search. Use auto mode only for projects you trust; it is not a guarantee that all dangerous actions will be caught. New tools and external integrations are not enabled implicitly.

Each SDK worker has a 40-turn task limit and a USD 5 query-budget option for its lifetime. SDK usage estimates and this budget may exclude separate permission-classifier calls, so neither is a complete billing statement or total-spend guarantee. Stopping a worker is best effort and cannot undo completed side effects or necessarily stop processes deliberately detached by an approved command. The agent is instructed not to detach processes.

## Local data

`.zemicc/` contains project paths and redacted conversations. Each SDK worker gets a separate temporary runtime directory; its non-secret caches and policy identity metadata are removed when the worker closes. A forced process crash can leave that temporary metadata behind, but API keys are not written there. The entire directory is ignored by Git. Session deletion removes the app's current record but is not secure deletion of disk sectors or backups. Project source and conversations may be sent to Anthropic when the user starts a task. No project content is published to GitHub by the app.

Report reproducible security issues privately to the repository owner, without attaching live credentials or private conversations.
