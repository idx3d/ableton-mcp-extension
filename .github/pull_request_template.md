## Summary

<!-- What does this PR do, and why? Link the issue if one exists. -->

## Checklist

- [ ] `npm test`, `npm run lint`, `npm run typecheck` pass locally
- [ ] Architecture rules hold (see CLAUDE.md): SDK imports only in `src/adapters/sdk-*`; layer direction port ← domain ← mcp
- [ ] Changes to `src/port/` or `src/adapters/` come with a matching update to `docs/capability-map.md` and/or an ADR in `docs/decisions/`
- [ ] Write tools keep the contract: one undo step per call, all-or-nothing batches, structured `{ok:false, code, hint}` errors
- [ ] Token budgets respected for new/changed tool output (asserted in component tests)
