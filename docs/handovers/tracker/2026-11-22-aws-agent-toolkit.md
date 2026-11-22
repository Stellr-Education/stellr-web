# AWS Agent Toolkit set up for Claude Code — 2026-11-22

Slug: `aws-agent-toolkit`. Handover: `HANDOVER-aws-agent-toolkit-2026-11-22.md`. Doc snapshot: `1XhZvH3NRAHUd5v9yH8_g0papSgp1h4ylpF1qMBbYqBs`.
No code PR; this close-out is the only commit. Not promoted (nothing to promote). Migration: none.

Claude Code on the owner's Mac can now reach the AWS project (profile `stellr`,
us-east-2, new AWS experience) through the AWS CLI, 25 AWS skills and the
`aws-mcp` server. None of it is in the repo.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| aws-agent-toolkit.1 | `aws-mcp` server starts in a Claude session | Configured in `~/.claude.json` with `AWS_MCP_PROXY_PROFILES=stellr`. It has not been started yet, and its command is a bare `uvx` that lives in `~/.local/bin` | In a new session, check that `aws-mcp` connects. If it doesn't, set its command to the full path to `uvx` | ☐ |
| aws-agent-toolkit.2 | AWS skills stay current without the auto-update hook | The hook was removed at the owner's request on 22 Nov, so the 25 skills in `~/.claude/skills` are pinned at their 22 Nov versions | Owner decides how to update them: re-run `aws configure agent-toolkit --no-auto-update` from time to time, or accept them as they are | ☐ |
| aws-agent-toolkit.3 | Claude's AWS access is narrower than full access | Signs in through `AccountFullAccessRole`. No narrower role exists | Before the first real AWS build (SES), owner decides whether agents keep full access or get a narrower role or team member | ☐ |
