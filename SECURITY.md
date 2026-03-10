# Security Policy

## Supported use

This repository is a desktop client for Apollo. It should not contain production secrets, shared secrets, bearer tokens, or local environment files.

## Reporting a security issue

Do not open a public issue with secrets, tokens, internal URLs, or server configuration details.

If you find a security issue:

1. Share only the minimum reproduction details required to explain the problem.
2. Redact credentials, tokens, cookies, and private hostnames.
3. Prefer a private disclosure path through GitHub rather than a public issue when sensitive details are involved.

## Local development guidance

- Keep `.env` files and local overrides out of Git.
- Do not commit session tokens captured from the running client.
- Treat screenshots, logs, and copied request payloads as potentially sensitive if they include auth data.
