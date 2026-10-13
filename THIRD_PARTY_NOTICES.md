# Third-party software

The zemiCC application source is licensed under the MIT License. Its bundled dependencies retain their own licenses and terms; zemiCC's MIT license does not relicense them.

- **Electron / Chromium / Node.js**: the distribution includes `LICENSE.electron.txt` and `LICENSES.chromium.html` with the runtime's notices.
- **Claude Agent SDK and Claude Code native runtime**, © Anthropic PBC: use is subject to Anthropic's [legal agreements](https://code.claude.com/docs/en/legal-and-compliance). The SDK README and native runtime license are included in the distribution, under `resources/licenses/claude-agent-sdk/` and `resources/agent/` respectively. API access and charges are the user's responsibility. zemiCC is independent and is not an official Anthropic application.
- Other production dependencies retain their license files inside `resources/app.asar/node_modules/`. The ASAR archive can be inspected with the open-source `@electron/asar` tool.
- **sharp / libvips**: used to decode, normalize and resize user-selected images. Their license and third-party notices ship with the sharp and platform-specific `@img` packages (including unpacked native libraries).

No API credentials, user conversations or project files are included in release artifacts.
