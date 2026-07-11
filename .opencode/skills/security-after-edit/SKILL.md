---
name: security-after-edit
description: Use after ANY code edit to api/index.js, js/auth.js, js/audit.js, js/db.js, js/pos.js, or sw.js. Automatically triggers a security penetration test to verify no vulnerabilities were introduced. Trigger keywords: edit, write, modify, update, fix, add, change, refactor, security, pentest.
---

# Security After Edit

This skill automatically runs a security check after every code modification to the nawah-pos project.

## When This Runs

After ANY edit to these files:
- `api/index.js` — Backend API
- `js/auth.js` — Authentication
- `js/audit.js` — Audit logging
- `js/db.js` — Database layer
- `js/pos.js` — POS frontend
- `js/admin.js` — Admin panel
- `js/super-admin.js` — Super admin panel
- `js/app.js` — Router and sync
- `sw.js` — Service Worker

## What To Do

1. **Read the modified file** completely
2. **Run the pentester checklist** from `.opencode/agent/pentester.md`
3. **Focus on the changed code** — what was modified, what attack surface changed
4. **Report findings** using the severity format:
   - CRITICAL: Fix immediately (auth bypass, injection, data leak)
   - HIGH: Fix before deploy (missing validation, exposed secrets)
   - MEDIUM: Fix soon (missing rate limiting, weak CORS)
   - LOW: Best practice improvements
   - INFO: Observations

5. **If CRITICAL or HIGH found**, suggest the exact fix code
6. **If all checks pass**, say: "✅ Security check passed — no vulnerabilities introduced"

## Quick Check Rules

- Every `req.body` used in a DB query → check for NoSQL injection
- Every `res.json()` → check for data leakage
- Every `innerHTML` → check for XSS
- Every `password` field → check it's not in responses
- Every `find/update/delete` → check ObjectId validation
- Every `JWT` operation → check expiry and secret handling
