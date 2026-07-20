# Ableton MCP Extension

An Ableton Live extension that hosts an [MCP](https://modelcontextprotocol.io)
server inside Live, so AI clients (Claude Code, Claude Desktop, Codex) can connect
to your open live set and work on it with you: inspect the set, compose MIDI, manage
tracks, scenes and clips, control devices and the mixer.

Built on the Ableton Extensions SDK (Node.js). The server runs only while Live is
open and listens on `localhost` (Streamable HTTP, token-protected).

## Status

**Foundation phase.** The MCP server core (10 tools) runs against an in-memory
FakeLive — try it with `npm run dev:fake`. The real Ableton adapter and the
installable extension are in progress (see `docs/plans/`).

- Design spec: [`docs/specs/2026-07-19-ableton-mcp-extension-design.md`](docs/specs/2026-07-19-ableton-mcp-extension-design.md)
- What the Live API can and cannot do: [`docs/capability-map.md`](docs/capability-map.md)
- Architecture decisions: [`docs/decisions/`](docs/decisions/)

## Planned developer workflow

```sh
npm run dev:fake   # run the MCP server standalone against an in-memory fake Live
npm start          # build + run inside real Ableton Live (Developer Mode)
npm test           # unit + component tests (no Ableton required)
npm run lint       # eslint + architecture boundary check
npm run package    # bundle + produce the installable .ablx
```

## License

[MIT](LICENSE)
