---
description: "Security and data handling standards"
alwaysApply: true
---

# Security and data handling standards

## Input and output

- Validate and sanitise **all external input** (HTTP requests, messages, files, environment variables) before use.
- Never build SQL or command strings by concatenating untrusted data; use parameterised queries and safe APIs.
- Encode output appropriately for its context (HTML, JSON, logs) to avoid injection vulnerabilities.

## Authentication and authorisation

- Treat authentication and authorisation as explicit, first‑class concerns:
  - Check authorisation at the appropriate boundary for every sensitive action.
  - Avoid duplicating auth logic in many places; centralise policies where practical.

## Secrets and configuration

- Do not hard‑code secrets, tokens, or credentials in code or templates.
- Store secrets in environment variables or a dedicated secrets manager, and ensure they are not logged or written to disk.

## Dependencies and OWASP awareness

- Prefer well‑maintained, widely used dependencies; avoid unvetted or abandoned libraries.
- Keep dependencies updated and pay attention to security advisories.
- Be aware of common issues from OWASP (such as injection, broken access control, and sensitive data exposure) and design code to avoid them.
