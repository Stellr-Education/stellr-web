# Handover: AWS Agent Toolkit set up for Claude Code — 2026-11-22

Tracker: `tracker/2026-11-22-aws-agent-toolkit.md`.

**This session changed no repo code. Nothing was committed apart from this
handover, and nothing was promoted.** All the changes are on the owner's Mac,
outside the repo.

## Context

The owner asked for Claude Code to be connected to AWS by following AWS's
[Agent Toolkit setup instructions](https://raw.githubusercontent.com/aws/agent-toolkit-for-aws/refs/heads/main/setup-instructions/setup.md).
Stellr's AWS account uses the **new AWS experience**, so Claude calls it a
"project". Its Region is **us-east-2**. Nothing in stellr-web uses AWS yet. The
nearest planned use is Amazon SES, funded by TechSoup AWS credits (owner's
memory `nonprofit-discounts-2026-11-22`).

## What changed (on the owner's machine, not in the repo)

| What | Where |
|---|---|
| AWS CLI 2.42.1 and uv 0.13.9, user installs with no sudo; AWS's package signature checked out | `~/.local` (binaries in `~/.local/bin`) |
| `~/.local/bin` put on PATH | `~/.zshrc` |
| CLI profile `stellr`, Region us-east-2, signed in with `aws login` (12h credentials that renew without the browser for 90 days) | `~/.aws/config` |
| 25 default AWS skills | `~/.claude/skills` |
| `aws-mcp` MCP server (`uvx mcp-proxy-for-aws`), with `env.AWS_MCP_PROXY_PROFILES = "stellr"` added | `~/.claude.json` |
| AWS rules for the new experience, between `<!-- BEGIN/END AWS Agent Toolkit rules -->` markers | user-level `~/.claude/CLAUDE.md` |
| Skill auto-update hook added by the toolkit, then **removed** at the owner's request | `~/.claude/settings.json` |

Two deliberate departures from AWS's instructions:

- **Where the rules went.** The instructions say to append the rules to the
  project's `CLAUDE.md`. stellr-web is a public repo, so the owner chose the
  user-level file instead, and the repo's `CLAUDE.md` is unchanged. The rules
  therefore apply in every project. Where they conflict with a project's own
  rules, the project's rules win.
- **The update hook.** The owner had the skill auto-update hook removed.
  Re-running `aws configure agent-toolkit` adds it back unless you pass
  `--no-auto-update`.

## What is verified

- `aws sts get-caller-identity --profile stellr` returned the project's
  account, signed in through `AccountFullAccessRole`.
- `aws agent-toolkit list-available-skills --region us-east-1 --profile stellr`
  listed 130 skills.
- `~/.claude/settings.json` no longer mentions `agent-toolkit`, and the
  web-gate hooks are intact.

## What is NOT verified

- **The `aws-mcp` server has not been started in a Claude session.** Its
  command is a bare `uvx`, which lives in `~/.local/bin`. The desktop app
  may not have that folder on its PATH. If the server fails to start, change
  the command to the full path to `uvx` (row `aws-agent-toolkit.1`).
- **Credentials have full access.** They sign in through
  `AccountFullAccessRole`, so a Claude session has full rights on the AWS
  project. No narrower role exists yet (row `aws-agent-toolkit.3`).

## Open items

See the tracker file: `aws-agent-toolkit.1`–`.3`.
