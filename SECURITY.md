# Security Policy

Agent Squad runs local coding CLIs as subprocesses. Treat it as local developer
infrastructure, not as an internet-facing service.

## Supported Use

- Run `agent-squadd` on `127.0.0.1` only.
- Do not expose the daemon port to a public network.
- Review permission profiles before delegating work in sensitive repositories.
- Keep GitHub PATs, npm tokens, and CLI credentials out of committed files.

## Permission Profiles

Some profiles intentionally bypass or auto-approve native CLI permission prompts
so subagents can run unattended. Use these profiles only in repositories where
that level of automation is acceptable.

For untrusted repositories, prefer read-only or prompt-based profiles and review
subagent output before applying changes.

## Reporting Vulnerabilities

For now, report security issues privately through the GitHub repository owner.
Do not include live credentials, tokens, or private repository contents in issue
reports.

