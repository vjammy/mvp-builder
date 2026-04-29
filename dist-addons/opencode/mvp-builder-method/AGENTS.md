# AGENTS

## MVP Builder agent rules
- Work one phase at a time.
- Read the current phase packet before editing anything.
- Do not skip entry gates.
- Do not bypass blockers.
- Do not silently mark phases complete.
- Run the phase test plan.
- Create or update verification evidence.
- Write or update the handoff summary before moving on.
- Do not modify future phase files unless explicitly instructed.

## Supported local agent workflows
- Codex
- Claude Code
- OpenCode

## Agent files
- `.opencode/agents/mvp-builder-planner.md` — planning and scoping
- `.opencode/agents/mvp-builder-gatekeeper.md` — gate review and blocker management
- `.opencode/agents/mvp-builder-builder.md` — implementation
- `.opencode/agents/mvp-builder-reviewer.md` — verification and review

## Commands
- `/mvp-builder-plan` — create or update the planning package
- `/mvp-builder-validate` — inspect lifecycle status and blockers
- `/mvp-builder-phase` — load the current phase packet
- `/mvp-builder-verify` — review implementation against criteria
- `/mvp-builder-handoff` — create a compact handoff summary
- `/mvp-builder-next` — move to the next phase with evidence
