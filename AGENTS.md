# Agent guide

## Commits

Write **Conventional Commit** messages: `<type>(<scope>): <summary>`.

- **Types**: `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `chore`.
- **Scope**: the area touched, lower-case and short (e.g. `aerial`, `background`, `settings`, `music`).
- **Summary**: imperative mood, no trailing period.
- **Body**: explain the why, not the what. Reference the issue (`Refs #11`, `Closes #12`) in the body or footer.

Example: `feat(aerial): add the aerial-video background source (#11)`

## Repository layout

Where each module and directory lives, the `@apps`/`@music` import aliases, and
the build/test commands: see `docs/agents/layout.md`. Read it before exploring
the tree.

## Guides

- **`CONTEXT.md`**: the domain glossary. Use its terms in code, tests and issues.
- **`docs/agents/architecture.md`**: how `main.ts` composes the modules, the focus router, and the lifecycle.
- **`docs/agents/config-and-backups.md`**: the settings tree, schema/migrations, and backup compatibility.
- **`docs/agents/adding-a-setting.md`**: the end-to-end path for a new setting.
- **`docs/agents/simulator.md`**: running Ember on LG's webOS TV Simulator instead of the TV.
- **`DEVELOPMENT.md`**: the human-facing version of the above: commands, the Simulator loop, deploying.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues, managed with the `gh` CLI; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles use their default label strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
