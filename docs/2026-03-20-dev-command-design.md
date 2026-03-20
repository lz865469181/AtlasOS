# /dev Command — Autonomous Development Agent

## Overview

Add a `/dev` slash command that spawns a Claude CLI subprocess to autonomously execute development tasks: plan, implement, test (TDD), and commit to master.

## Command Format

```
/dev <task>                          # works in default repo (this project)
/dev --repo /path/to/project <task>  # works in specified repo
```

## Architecture

```
Feishu message: /dev --repo /path/to/project <task>
  │
  ├── Parse command → extract --repo (optional) + task description
  ├── ACK → Feishu: "Dev task received, starting..."
  ├── Spawn Claude CLI subprocess
  │     workDir = target repo (or project root as default)
  │     model = claude-sonnet-4-6
  │     prompt = dev workflow with phase markers
  ├── Stream stdout → detect phase markers → Feishu progress updates
  │     [PHASE:PLANNING]      → "Planning..."
  │     [PHASE:IMPLEMENTING]  → "Implementing..."
  │     [PHASE:TESTING]       → "Testing..."
  │     [PHASE:COMMITTING]    → "Committing..."
  └── Final result → Feishu card with commit hash or error
```

## Dev Agent Prompt

The subprocess receives a structured system prompt enforcing:

1. **Plan** — Analyze task, identify files, create step-by-step plan. Output `[PHASE:PLANNING]`.
2. **Implement** — Write code following the plan. Output `[PHASE:IMPLEMENTING]`.
3. **Test (TDD)** — Write tests, run them, fix until green. Output `[PHASE:TESTING]`.
4. **Commit** — Stage, commit with descriptive message. Output `[PHASE:COMMITTING]`.

## Progress Reporting

The orchestrator reads Claude CLI's streaming JSON stdout. When it detects phase marker text in the output, it sends a Feishu markdown message updating the user on progress. Phases are tracked to avoid duplicate notifications.

## Files Changed

| File | Change |
|------|--------|
| `src/router/dev-agent.ts` | New — Dev agent subprocess orchestrator |
| `src/router/commands.ts` | Add `/dev` command routing |

## Error Handling

- Parse errors → send usage help
- Subprocess crash → send error message to chat
- Test failures → included in final report (Claude will attempt to fix)
- Timeout → configurable, default inherits from agent.timeout config
