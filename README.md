# Ableton MCP Extension

An Ableton Live extension that hosts an [MCP](https://modelcontextprotocol.io)
server inside Live, so AI clients (Claude Code, Claude Desktop, Codex) can connect
to your open live set and work on it with you: inspect the set, compose MIDI, manage
tracks, scenes and clips, control devices and the mixer.

Built on the Ableton Extensions SDK (Node.js). The server runs only while Live is
open and listens on `localhost` (Streamable HTTP, token-protected).

## Status

**Extension complete; in-Live validation pending.** The MCP server core (21
tools — see [docs/tools.md](docs/tools.md)) runs against an in-memory FakeLive —
try it with `npm run dev:fake`. The real Ableton adapter, the composition-root
extension shell, and the packaging pipeline are all implemented: the extension
**builds and packages to a `.ablx`**. What remains is **in-Live validation** —
running the built-in self-test inside a Live beta install — which is the release
gate for `v0.1.0`. See [docs/smoke-runbook.md](docs/smoke-runbook.md).

- Design spec: [`docs/specs/2026-07-19-ableton-mcp-extension-design.md`](docs/specs/2026-07-19-ableton-mcp-extension-design.md)
- What the Live API can and cannot do: [`docs/capability-map.md`](docs/capability-map.md)
- Architecture decisions: [`docs/decisions/`](docs/decisions/)

## Developer workflow

Two tiers, depending on whether you have the Ableton Extensions SDK installed
(see [CONTRIBUTING.md](CONTRIBUTING.md) for the full breakdown):

```sh
# No Ableton / SDK required — this is what CI runs:
npm ci
npm test              # unit + component tests
npm run dev:fake      # MCP server standalone against an in-memory fake Live

# Extension development (needs `npm run setup:sdk` first — see CONTRIBUTING.md):
npm start              # bundle + run inside real Ableton Live (Developer Mode)
npm run package        # bundle + produce the installable .ablx
```

## Connecting a stdio-only MCP client

Clients that speak only stdio (e.g. Claude Desktop) connect through the bundled
bridge. Build it once (`npm run build`), then point the client at:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/ableton-mcp-extension/dist/bridge.cjs"]
}
```

The bridge auto-discovers the running extension's URL + token from
`connection.json` (written on activation). To override, set `ABLETON_MCP_URL` (or
`ABLETON_MCP_PORT`) and `ABLETON_MCP_TOKEN` in the client's `env`.

## License

[MIT](LICENSE)
