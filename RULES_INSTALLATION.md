# Installing the Revised Antigravity Rules

This package replaces the earlier Python-only backend assumptions with the revised architecture requested for the product: **Laravel as the product/control-plane backend, React + TypeScript as the portal, and Python + FastAPI as the AI service**.

## Install
1. Back up or commit the current workspace before changing rules.
2. Extract this package into the project root, preserving hidden paths.
3. Replace the old root `AGENTS.md` and the old `.agents/rules/*.md` files with the versions in this package. Do not simply append contradictory rules.
4. Keep all rule files directly inside `.agents/rules/`; do not nest them.
5. Keep `MASTER_BUILD_PROMPT.md` available to paste into the Antigravity chat when ready.
6. Reload/open the workspace and confirm the files are recognized in Antigravity's rules/customizations panel.

## Important configuration distinction
The app still requires runtime configuration for itself (for example Laravel `APP_KEY`, the platform database connection, queue/mail setup, and the internal Python AI service URL). The prohibition is against requiring environment-file edits for each customer's target database or each user's AI provider keys. Those belong to the authenticated portal and must be stored encrypted and owner-scoped.

## No default/demo account
A fresh install must not pre-create a shared demo login, customer DB connection, AI key, or automation. Self-service registration and onboarding must work. If an optional synthetic demo seed command is provided, it must be explicit and separate from normal setup.

## Official Antigravity rule convention
The workspace root `AGENTS.md` is always active without frontmatter. Each Markdown file under `.agents/rules/` contains a YAML frontmatter `trigger`; the included files use `trigger: always_on`. Official guidance: https://www.antigravity.google/docs/rules/
