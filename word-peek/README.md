<!-- project-home:start -->
**[Word Peek project homepage](https://lewfkrad.github.io/word-peek/)** · [Documentation](https://github.com/lEWFkRAD/word-peek#install-and-open)

Explore a document with Hermes beside it, keeping your place and your questions together.

<!-- project-home:end -->

# Word Peek

![Word Peek - Read. Ask. Understand. A magnifying lens reveals a highlighted word on a document.](https://raw.githubusercontent.com/lEWFkRAD/word-peek/master/docs/hero.png)

Word Peek is a Hermes Desktop plugin for exploring HTML passages, asking questions in the passage's chat, and saving notes or whole-document edits with backups and verified Undo.

## Install and open

Install from this repository with Hermes's plugin installer, or use the Word Peek catalog entry after maintainer approval. The native package is `plugin.yaml` plus `desktop/plugin.js`. The older `word-peek/plugin.js` and `desktop-plugins/word-peek/plugin.js` copies are generated compatibility artifacts.

Use **Word Peek: open HTML document** in the command palette. Grant a folder through Hermes's own picker, choose an HTML file, select a passage in the Word Peek reader, and right-click. The reader disables scripts and external resources; it preserves them in the original file. Saved animations/scripts can be viewed separately in the usual browser.

For a web page, use **Word Peek: explore browser selection**. Hermes asks permission for that plugin and web origin. Web selections are read-only. Word Peek does not scrape app webviews, bypass browser consent, or reach into internal composer markup.

This release needs a Hermes Desktop build exposing `ctx.files`, `ctx.preview` and correlated prompt completion receipts. Unsupported operations fail with an explanatory error. Development verification uses Hermes commit `d8039c60228a9e71a004ed26f4588d3e0441d648`.

## Questions and edits

**Ask Hermes** submits a normal chat turn using the captured session and profile owner. Answers appear in chat and the passage panel. Follow-up history stays with the passage. Busy or uncorrelated turns are refused; another turn's completion cannot become this answer or an HTML write. Cancel stops this plugin's waiting work; an already accepted model turn may continue in chat.

Use **Use as my note** to avoid a model call. Choose an expandable note, insertion below, or selection replacement, preview, then apply. **Edit document** sends the document and instruction to the same Hermes agent loop for a whole-document rewrite.

File reads/writes use only folder handles granted through Hermes. UTF-8 documents are limited to 900,000 characters. Each change creates an exclusive `.word-peek-*.bak` backup, verifies the backup, rechecks the original immediately before writing, and verifies the saved result. Undo refuses to overwrite a later external change. An uncertain write retains recovery information. Hermes's file API has no atomic compare-and-swap, so an external program can still race the final read/write interval.

The reader is intentionally inert. Whole-document edits may contain scripts, images, audio and external URLs; review them before opening the saved file in a normal browser. Inline notes escape text and permit only reference URLs already supplied by the document.

## Data and network disclosure

- Selected passages, surrounding text, references, questions and (for whole edits) document contents go through the configured Hermes model and ordinary agent loop, with that chat's context and tools. Word Peek makes no direct third-party model or telemetry calls.
- Files are read only from the plugin data folder and folders granted by the user. Document edits and backups stay in the selected folder. Permissions remain revocable in Hermes.
- Glossary entries and recovery metadata persist in plugin storage. Passage question history lasts for the plugin lifetime.
- The bundled glossary contains personal seed notes, not a verified research source. Check its factual statements before relying on them.
- Optional `wn-dict.json` and `wn-thes.json` files are not redistributed. Place your licensed copies in Word Peek's SDK data folder; missing data leaves the other features usable.
- Bundles parse5 and entities; notices are in `word-peek/THIRD-PARTY-NOTICES.txt`. Existing notices cover those dependencies and do not assign a license to this repository's original code.

## Development and checks

Editable source is `word-peek/dev/`. Run `npm ci`, then `npm run release` to rebuild the native and compatibility bundles. `npm run check:release` verifies that every shipped bundle matches the source build.

Run `npm test` with `HERMES_CHECKOUT` pointing at the recorded Hermes checkout. Browser tests use Playwright Chromium by default; `PLAYWRIGHT_CHANNEL=msedge` selects installed Edge. Run `npx playwright install chromium` if needed. `scripts/check.ps1` checks repository hygiene and secret patterns. GitHub CI runs the tests on Linux and Windows and checks release bundle parity.

Tests exercise the actual generated bundle, real DOM selections, the actual Hermes runtime loader, and mocked gateway/file SDK contracts. They do not certify a live model, native Electron permission dialogs, or production document editing. Native interactive acceptance remains a separate check.

Maintained by Jeff Watts / @lEWFkRAD. This review and hardening pass was assisted by OpenAI Codex.
