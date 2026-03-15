# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Role & Responsibilities

Your role is to analyze user requirements, delegate tasks to appropriate sub-agents, and ensure cohesive delivery of features that meet specifications and architectural standards.

## Workflows

- Primary workflow: `./.claude/workflows/primary-workflow.md`
- Development rules: `./.claude/workflows/development-rules.md`
- Orchestration protocols: `./.claude/workflows/orchestration-protocol.md`
- Documentation management: `./.claude/workflows/documentation-management.md`
- And other workflows: `./.claude/workflows/*`

**IMPORTANT:** Analyze the skills catalog and activate the skills that are needed for the task during the process.
**IMPORTANT:** You must follow strictly the development rules in `./.claude/workflows/development-rules.md` file.
**IMPORTANT:** Before you plan or proceed any implementation, always read the `./README.md` file first to get context.
**IMPORTANT:** Sacrifice grammar for the sake of concision when writing reports.
**IMPORTANT:** In reports, list any unresolved questions at the end, if any.

## Python Scripts (Skills)

When running Python scripts from `.claude/skills/`, use the venv Python interpreter:
- **Linux/macOS:** `.claude/skills/.venv/bin/python3 scripts/xxx.py`
- **Windows:** `.claude\skills\.venv\Scripts\python.exe scripts\xxx.py`

This ensures packages installed by `install.sh` (google-genai, pypdf, etc.) are available.

## Documentation Management

We keep all important docs in `./docs` folder and keep updating them, structure like below:

```
./docs
├── project-overview-pdr.md
├── code-standards.md
├── codebase-summary.md
├── design-guidelines.md
├── deployment-guide.md
├── system-architecture.md
└── project-roadmap.md
```

**IMPORTANT:** *MUST READ* and *MUST COMPLY* all *INSTRUCTIONS* in project `./CLAUDE.md`, especially *WORKFLOWS* section is *CRITICALLY IMPORTANT*, this rule is *MANDATORY. NON-NEGOTIABLE. NO EXCEPTIONS. MUST REMEMBER AT ALL TIMES!!!*

## Active Technologies
- TypeScript (native execution on Bun 1.x+, no build step for dev) + Hono ^4.x, Drizzle ORM ^0.3x, Effect ^3.x, Vercel AI SDK ^6.x, @ai-sdk/openai ^2.x, Zod ^3.x, ioredis, Pino (002-react-agents-ddd-setup)
- PostgreSQL (postgres.js ^3.x driver), Redis standalone (ioredis) (002-react-agents-ddd-setup)
- TypeScript (Bun 1.x+ native execution) + Hono ^4.x, Drizzle ORM ^0.3x, Effect ^3.x, @crossmint/server-sdk (NEW), Zod ^3.x, Pino (003-crossmint-auth-wallet)
- PostgreSQL (postgres.js ^3.x) — new `users` table (003-crossmint-auth-wallet)

## Recent Changes
- 002-react-agents-ddd-setup Phase 4: Upgraded ai to ^6.x and @ai-sdk/openai to ^2.x (v5/v1 had LanguageModelV1/V2 incompatibility). convertToModelMessages is now async in v6.
