# MVP_BUILDER

## What is MVP Builder?

MVP Builder is a local, markdown-first planning, gating, handoff, verification, and context-management system for AI-assisted builds.

## Core principles
- **Local-first**: all artifacts are local markdown files
- **Deterministic**: same input produces same output
- **Agent-friendly**: optimized for Codex, Claude Code, and OpenCode
- **Evidence-based**: phase progression requires verification
- **No external dependencies**: no database, auth, or cloud required

## Workflow
1. Plan: create the project package with brief, phases, and gates
2. Validate: check lifecycle status, blockers, and readiness
3. Build: work one phase at a time with entry/exit gates
4. Verify: review implementation against criteria
5. Handoff: summarize work and prepare next phase context
6. Next: advance only with evidence or explicit approval

## Package structure
- Root context files: `00_PROJECT_CONTEXT.md`, `01_CONTEXT_RULES.md`, `AGENTS.md`
- Agent start files: `CODEX_START_HERE.md`, `CLAUDE_START_HERE.md`, `OPENCODE_START_HERE.md`
- Phase folders: `phases/phase-XX/` with brief, gates, prompts, tests, and verification
- State files: `repo/manifest.json`, `repo/mvp-builder-state.json`

## Commands
- `/mvp-builder-plan` — create or update planning package
- `/mvp-builder-validate` — inspect status and blockers
- `/mvp-builder-phase` — load current phase packet
- `/mvp-builder-verify` — review implementation
- `/mvp-builder-handoff` — create handoff summary
- `/mvp-builder-next` — advance phase with evidence
