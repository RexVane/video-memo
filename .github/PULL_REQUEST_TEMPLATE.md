## Summary

<!-- What changed and why? -->

## Validation

- [ ] `python -m unittest discover -s tests -v`
- [ ] `python -m compileall -q src tests`
- [ ] `cd obsidian-plugin && npm.cmd ci && npm.cmd run check && npm.cmd run build` (if plugin code changed)

## Compatibility and privacy

- [ ] CLI/output/progress contracts are unchanged or documented.
- [ ] No `.env`, API key, Cookie, media, model weight, Vault data, or generated output is included.
- [ ] Documentation and changelog are updated when user-facing behavior changes.
