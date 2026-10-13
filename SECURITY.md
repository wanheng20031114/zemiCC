# Security model

zemiCC is a local, single-user coding tool. It is not designed for network hosting or untrusted multi-user access.

## Credentials

- There is no credential storage or environment-file loader. Users enter their own key in the app.
- The input is masked and cleared immediately on submission. The UI stores only connection status.
- The backend retains a key in a private in-memory field. It passes the key to the SDK child process environment for authentication. It does not log requests, headers, SDK stderr, or raw SDK events.
- SDK transcript persistence is explicitly disabled. User environment credentials, global Claude settings, custom gateways and inherited entrypoint overrides are excluded from the SDK process.
- App events and local history redact the live key, MCP credential values and common credential formats. Streaming holds back incomplete prefixes of known credentials to avoid exposing them across event boundaries. Redaction is best effort, not a defense against encoded or transformed secrets; very short MCP values are only redacted on exact matches.
- Closing the desktop app terminates its workers and releases the key. Browser mode requires stopping the server. JavaScript strings cannot provide cryptographic zeroization guarantees; memory dumps, swap and hostile software running as the same OS user are outside this boundary.

## Local service

- Listens only on `127.0.0.1`.
- Exact Host and Origin checks reject DNS rebinding and cross-origin calls. No permissive CORS.
- A random per-process capability protects the API. Mutations require a header; reads and SSE use an HttpOnly SameSite cookie. The bootstrap endpoint requires a custom header.
- CSP, frame denial, request size limits, plain text file previews and Markdown without raw HTML reduce browser attack surface. Remote model-supplied images do not load.
- Electron uses an in-memory browser partition, disabled HTTP cache, sandboxed renderers, context isolation, no Node integration and no webview. Its narrow preload bridge exposes only display zoom; IPC validates the sender and numeric bounds. External navigation stays outside the app.

## Agent operations

Read/Write/Edit paths must stay in the selected project. Existing ancestors and symlinks/junctions are resolved; `.env`, private key files, credential directories, `.git`, and app data are blocked by app file APIs and path-based tool checks. This is a defense against common accidental access, not a general secret scanner.

The default **auto** mode allows guarded file reads/edits and source-file searches. Complete shell commands pass through the official SDK's `auto` permission mode: zemiCC never returns a hook allow for commands or extracts a supposedly safe prefix. The SDK evaluates command risk and task context, including compound commands, substitutions, redirections, deletions, publishing, privilege changes and background execution. Parent-relative paths and individual keywords no longer force app-level prompts. A best-effort credential-specific rule still requests human review for recognizable secret-file and environment access; it is not a complete shell parser or security boundary. The SDK may approve, deny or request human authorization. A missing or unavailable classifier never causes zemiCC to silently switch to bypass mode; SDK fallback is shown in the conversation and command prompts remain available.

The optional **manual** mode requests review for file writes, content searches and commands. Users can switch the current conversation and the default for future conversations through an authenticated API, including during execution. The SDK applies the mode to subsequent checks; changing mode does not answer existing approval cards. PreToolUse denies still apply in both modes. Any escalation that reaches `canUseTool` is presented to the user even if a local check looks routine; AskUserQuestion always remains interactive. No bypass-permissions mode or whole-shell permanent allow rule is exposed. Unknown tools request review.

Authenticated user follow-ups are sent through the same SDK input stream with human provenance and unique message IDs. SDK delivery receipts and pending-turn counts keep a conversation active while follow-ups remain. A follow-up does not resolve a permission request. Stopping closes the worker and input queue; pending messages are marked undelivered and excluded from restored context instead of being silently resent. Work already performed cannot be undone by a follow-up or Stop.

Arbitrary shell commands are not sandboxed and can access disk, process credentials and the network after either automatic or human approval. The classifier can make mistakes, and code invoked by a seemingly routine build/test can have arbitrary side effects. Project file-path checks do not constrain shell processes or every file reached by recursive search. Use auto mode only for projects you trust; it is not a guarantee that all dangerous actions will be caught. New tools and external integrations are not enabled implicitly.

zemiCC does not impose a turn limit or a monetary cutoff: SDK queries omit both `maxTurns` and `maxBudgetUsd`. Long tasks can continue without an app-defined cap, and users can stop them at any time. Provider quotas, rate limits, context handling and network failures still apply. API charges accrue with use; SDK usage estimates may exclude separate permission-classifier calls and are not a complete billing statement. Stopping a worker is best effort and cannot undo completed side effects or necessarily stop processes deliberately detached by an approved command. The agent is instructed not to detach processes.

## MCP integrations

Only servers explicitly configured inside zemiCC are attached. SDK queries use `strictMcpConfig: true`; project and global MCP definitions are not loaded implicitly. Servers may use stdio, Streamable HTTP or SSE. Remote connections require HTTPS except on loopback. Header/token authentication is supported; browser OAuth sign-in is not yet exposed.

The local `mcp-servers.json` contains connection names, commands, arguments, URLs, enabled state and credential field names. Environment variable and header values remain in process memory and must be re-entered after restart. Editing an existing field with a blank value retains its in-memory value; removing the field removes it from subsequent connections. Retired credential values remain in the redactor until process exit, so late output cannot expose them. Configurations go to `setMcpServers()` over the SDK control stream, not secret-bearing command-line arguments or temporary MCP files. The app does not return credentials to the UI. Recognizable credentials in public connection fields are rejected, but this is not a general secret detector: never put credentials in names, commands, arguments or URLs.

MCP stdio processes do not inherit the app's Claude API key by default. Users can explicitly supply credentials to a server through its environment fields. Servers run as the current OS user and are not sandboxed; they can read or modify files and use the network. Remote services receive tool-call parameters and associated data. A connection test starts the configured server, performs protocol discovery and lists tools without a model request or tool invocation; server startup itself can have side effects. Only connect trusted servers.

Registered dynamic MCP tools defer to native SDK review in auto mode; manual mode and unknown provenance request confirmation. Server-provided tool annotations are not used as blanket permission grants. Configuration changes can be saved during active tasks. Each worker retains its current connections and server provenance until its task and queued follow-ups have finished; updates then apply at idle, or before its next prompt, while retaining the conversation. Disabling/removing a server is therefore deferred during an active task; Stop the task to terminate its connections immediately. A 30-second connection-test timeout does not limit agent tasks or MCP tool execution.

## Local data

Image uploads use the same capability and origin checks as other mutations; reads require the local session cookie. Only decoded PNG, JPEG, WebP and GIF rasters are accepted. SVG and remote image URLs are not accepted as attachments. Uploads are limited to 20 MiB and 40 million pixels, oriented, resized to at most 2560 pixels per side, stripped of metadata and re-encoded to PNG or JPEG. GIF uses its first frame. Opaque random IDs select files within the app's image store; the client cannot submit filesystem paths. History and SSE contain metadata, not base64 pixels. Image pixels are user content and cannot be secret-redacted by the text redactor. They are saved locally and sent to Anthropic as native image blocks only when the user sends a message. Unreferenced drafts are removed on startup; session deletion removes its images when no other session refers to them. Restoring a conversation includes at most five recent/current images, with current images taking priority.

The installed application stores project paths and redacted conversations in `%APPDATA%\zemiCC\workspace\`; source development uses the Git-ignored `.zemicc/` directory. Neither is inside the packaged application's code. Each SDK worker gets a separate temporary runtime directory; its non-secret caches and policy identity metadata are removed when the worker closes. A forced process crash can leave that temporary metadata behind, but API keys are not written there. Session deletion removes the app's current record but is not secure deletion of disk sectors or backups. Project source and conversations may be sent to Anthropic when the user starts a task. No project content is published to GitHub by the app.

## Release packages

Windows packages include Electron and the matching native Claude Agent runtime. Packaged SDK workers use the explicit bundled executable, not a user-installed Node.js or global Claude CLI. An allowlist excludes user data, credentials and development tools from builds; package verification checks archive contents and the native runtime checksum. GitHub release artifacts are built in a clean Windows runner with no API credentials. The initial release is unsigned; SHA-256 checksums are included for downloaded artifacts. Updates are manual and preserve local data. The app does not grant administrator privileges or change global Claude/OpenCode configuration.

Report reproducible security issues privately to the repository owner, without attaching live credentials or private conversations.
