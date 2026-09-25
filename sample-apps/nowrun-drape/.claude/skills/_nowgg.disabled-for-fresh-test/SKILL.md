---
name: nowgg-publishing
description: Publish and manage Android & HTML5 games on now.gg / BlueStacks studio using the `nowgg` CLI. Use whenever the user wants to upload a build, deploy to a test track, publish to production, check status/readiness, or manage monetization (SKUs, pricing, subscriptions) for a now.gg app.
---

# Publishing to now.gg with the `nowgg` CLI

The `nowgg` CLI drives now.gg studio publishing using a **publisher token**. You
operate it; the human only handles app configuration in the Studio web UI.

## First: discover the tool (don't guess commands)

The CLI is **self-documenting** — read it at runtime instead of relying on memory:

```bash
nowgg help --json        # every command, subcommand, argument, and the workflow
nowgg <command> -h       # details for one command (e.g. nowgg h5 deploy -h)
```

**Always pass `--json`** on commands you run — you get a structured envelope
(`{"ok": true, "data": ...}` or `{"ok": false, "error": {...}}`) and a non-zero
exit code on failure, so you can react programmatically.

## Check you're authenticated

The `nowgg` CLI is already installed (this skill ships with it). Confirm auth:

```bash
nowgg whoami        # shows the logged-in identity + company
```

If it says "Not logged in", ask the user to authenticate — they hold the token:
`nowgg init -t <publisher_token>`. Never ask for or guess the token.

Bind a project folder to an app so you don't repeat `-a` every command:

```bash
nowgg use <game_id>     # writes nowgg.json; commands then default to this app
```

## What you do vs. what the human does

- **Human (Studio web UI):** creates the app and fills store listing, assets,
  compliance/legal (privacy policy, age rating), distribution channels, regions.
- **You (CLI):** integrate SDKs, upload builds, deploy, publish, and manage monetization.
  For SDK integration details, use the **now.gg-docs MCP server** if it's configured
  (resources like SDK modules, payments/IAP, verifyPurchase) — add it with `nowgg mcp install`.

Run `nowgg validate` first — it reports what listing/compliance fields are still
missing. If it says NOT READY, tell the user what to finish in Studio; don't try
to publish.

## Core flows

- **Android, test track:** `nowgg build upload …` then `nowgg deploy -t t1 …`,
  then poll `nowgg status -s <submission_id>` until it returns a play URL.
- **Android, production:** `nowgg release deploy …` then poll `nowgg release status …`;
  `nowgg release publish -s <id>` promotes a READY_FOR_PUBLISHING submission.
- **H5:** `nowgg h5 deploy -f <zip>` (zip must have index.html at the root).
- **Monetization (SKUs):** create a pricing template, then the SKU (run `-h` for exact flags):
  `nowgg pricing add --name "0.99 USD" --price 0.99` → note the template id from `nowgg pricing list`,
  then `nowgg iap add --title "100 Coins" --sku coins_100 --description "…" --template <template_id>`.

## Rules & gotchas (learned the hard way)

- **Confirm with the user before any production publish** (`release publish`,
  `release deploy`, production with `--managed`). Test tracks are safe to use freely.
- **H5 has no test track.** `h5 deploy` goes to the production track and lands in
  **`submitted` = now.gg QA review** — that's the normal, complete result for H5.
  Going live needs review (or `--managed`, which requires `MANAGED_DEPLOYMENT` access).
- **Android deploy is async.** After `deploy`/`release deploy`, poll `status`;
  `job_status: progress` means the cloud build is running; `success` yields the play URL.
- **`submitted` means "in review," not failed.** A 429 with "in progress" means a
  deployment is already running — poll, don't retry.
- For any command or argument you're unsure about, **read `nowgg <cmd> -h`** — never invent flags.
