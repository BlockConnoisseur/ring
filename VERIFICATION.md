# Ring verification · 2026-10-07

## Automated checks

- `npm test`: 20 passing tests covering the game and authenticated API.
- `npm run typecheck`: passed.
- `npm run build`: passed, with no build tracing warning after scoping the runtime database path. Node 24 still labels its built-in SQLite API experimental.
- Dependency installation: npm reported zero known vulnerabilities at install time.

## Browser checks

- Desktop: inspected the hero, rule strip, full switchboard, hotline, rule section, and footer.
- Mobile: inspected at a 390 × 844 viewport. Reworked the hero to stack the phone below the title. Document width did not exceed the viewport.
- Composer: selected description, entered a title/name/body, saved a local draft, and verified the draft appeared in the switchboard. Reopened it with its content intact. Discarded the test draft through the UI afterward.
- Wallet: opened the wallet dialog and exercised a failed wallet connection. The error was visible and the dialog stayed usable. No wallet transaction or live holding claim was made.
- Keyboard: Tab moved from the main proposal action to the phone action, with a visible solid focus outline. Native dialogs provide focus containment, Escape dismissal, and return focus.
- Motion: inspected the `prefers-reduced-motion` rule, which disables animation/transitions and suppresses the phone lift. The browser's OS preference was not changed.
- Browser console: no error or warning entries in the final inspected state.

Screenshots: [desktop](docs/ring-desktop.jpg), [mobile](docs/ring-mobile.jpg), [hero](docs/ring-hero.jpg).

## Verification limits

No live phone number, token mint, provider credentials, production question bank, or transaction signer was supplied. Consequently, no real telephone call, production wallet holding check, AI speech-provider request, Meteora fee claim, or token metadata transaction was run. The phone worker and authenticated execution boundary are implemented but require provider integration testing. The on-chain adapter itself remains to be implemented against the selected token configuration. Fee proposals are blocked at the API until their duration and payout policy are decided.

This is a working prelaunch website and tested game/application foundation, not a claim that Ring is live on mainnet.
