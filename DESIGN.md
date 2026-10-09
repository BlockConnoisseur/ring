# Ring art direction

Ring's right to change a coin is expressed through a vintage telephone advertisement and a public call sheet. The interface should feel direct, tangible, and slightly confrontational. Avoid a crypto terminal, generic startup homepage, or fictitious live game dashboard.

The red landline is the signature. It has a raised receiver, physical wear, and a coiled cord. Black type and the phone share the hero; one red action leads to a concrete proposal. The switchboard uses rows and rules, while the hotline resembles a printed call slip. The black rules section changes the density and pace. Mobile puts the telephone below the headline so neither becomes illegible.

## Research applied

[Styles Gallery's AI-interface review](https://styles.gallery/blog/why-ai-built-sites-look-the-same) identifies recurring default component styling, gradient headlines, identical feature grids, and effect-heavy surfaces. Treat its survey counts as the author's claims, not independently established measurements. [Creative Bloq's design commentary](https://www.creativebloq.com/ai/everything-looks-the-same-now-what) discusses brand sameness and the need for specific creative decisions.

These are observations, not a reliable detector of whether a site used AI. No single typeface, color, or component proves authorship. The practical response here is a product-specific design with working interactions.

Choices made for Ring:

- A floating capsule header, explicitly requested by the owner, and an asymmetrical telephone-poster hero. The header stays opaque, with clear active-page links and a theme control.
- A real subject: the phone. No coin render, chrome orb, neon grid, aurora, glass card, or sparkle icon.
- The supplied Ring brand palette: white canvas (#FFFFFF), Ink (#161616), Black (#0A0A0A), Ring Red (#E10600), Signal Red (#FF3B30), and Dial Tone Deep (#8F0A06). Ring Red leads actions; Signal Red stays legible on dark surfaces; Dial Tone Deep supplies light-surface focus and pressed states.
- Locally bundled DM Sans and Space Mono. Concrete type sizes and restrained weights; no network font dependency.
- Open row layouts for the proposal board. No invented posts, wallet balances, callers, wins, testimonials, or revenue.
- A native dialog for composition, real buttons and labels, visible focus, keyboard dismissal, explicit unavailable/error states, and reduced-motion behavior.
- Small hover movement only on the telephone, linked to picking it up. No scroll entrance animation or moving backgrounds.

## Brand refinement — October 8, 2026

The user supplied a [Ring brand sheet](https://conferencing-mar-safer-uncle.trycloudflare.com/) containing a white handset with red signal arcs, an uppercase RING wordmark with a red I, the palette above, and the tagline “Pick up the future.” The mark is preserved as a small static SVG in `public/ring-mark.svg` and the app favicon, independent of the temporary reference tunnel. Black header/footer bands carry the white wordmark. The existing photographic landline, asymmetrical hero, proposal form and game behavior remain the product's core.

[Impeccable](https://github.com/pbakaus/impeccable) v4.5.0 supplied the context, polish and craft-floor guidance for this refinement. Its context command and one mechanical detector pass ran locally from an ignored reference checkout; no runtime dependency or automatic edit hook was added. The existing design is the authority for the large headline and call-sheet labels; this pass refines brand consistency rather than replacing that composition. Shared focus states include the native dropdown, placeholders have explicit contrast, and no perpetual logo animation was added.

## Generated asset

## Dark mode and page structure — October 8, 2026

The owner's next brief requested a bolder site, dark mode, a floating pill header, a single-line hotline and actual separate pages. `/` is the telephone-poster introduction with a red hotline band; `/switchboard` contains the proposal board and call slip; `/rules` explains the game. Each has one primary heading and a page-specific title. The same proposal, wallet and call components serve all routes.

Dark is the first-visit default. The toggle stores `ring:theme:v1` and an early local-only script restores the choice before the page is painted. Semantic tokens cover body copy, borders, inputs, dialogs, focus and proposal details in both themes. The header is a compact opaque capsule with active-route indicators; mobile keeps both route links visible. The hotline uses unbroken tabular numerals and responsive sizing, including the mobile call slip.

Verification: Next production build and TypeScript passed; Impeccable's single mechanical scan returned no findings. Browser checks covered dark Home and Switchboard, light Rules, mobile navigation, the dark proposal form and keyboard focus/dismissal, theme persistence across routes and reload, and the phone number at desktop, 390px and 320px widths. No document or phone-number overflow was measured. Core game and server permissions were not changed.

The built-in image-generation tool produced `public/ring-phone.png`. The final image was copied into the repository with its transparency preserved. Next Image serves appropriately sized versions.

Prompt:

> Create a premium photoreal studio product cutout for a black/white/red website named Ring. A single vintage bright vermilion-red desk landline telephone, 1970s molded plastic pushbutton phone, seen in a dramatic three-quarter front view, angled slightly left. Its matching red handset is lifted clearly above the cradle as if just picked up, hanging diagonally with no person or hand in frame. Black coiled cord connects handset to phone and curls naturally beside the base. Believable physical construction, a square ivory 12-button keypad with small black digits, red plastic with fine wear, rich red color, hard editorial product lighting, restrained photographic highlights. Object fills composition, entire base and handset visible with ample clear transparent margin; absolutely transparent background, no surface, no colored backdrop, no lettering or logo, no effects, no particles, no glow. Portrait 4:5 composition. This should feel like a real vintage telephone photographed for an independent culture magazine, not a shiny futuristic 3D app icon.

## Call lobby — October 8, 2026

The telephone opens a two-column call lobby using the official shadcn/ui Card composition, manually adapted to the existing CSS system (source and MIT license in THIRD_PARTY_NOTICES.md). A red hotline plate carries the real number, game target and answer instructions. A readiness card and four-slot private-code ticket show the wallet, holding and proposal state. Mobile stacks these in call order. Authored SVG icons replace Unicode icon stand-ins.

The dial action is available only with a live line, eligible session, unexpired code and no cooldown or active game. An active game displays its locked target and hides the consumed code. Prelaunch never displays a fabricated code or an active-call claim. Existing queue refresh/cancel and game-result messages are preserved. A native dialog retains focus containment and Escape dismissal. Focused server-rendered tests cover readiness gates, expiry, cooldown and active-game target/code behavior.

## Typography and transparent mark — October 8, 2026

The owner requested a transparent logo, less basic typography and removal of the red dot beside the homepage line status. Removed the black SVG background rectangle without changing the handset paths; the header mark and favicon now have transparent backgrounds. Barlow Condensed 700 gives primary headlines an uppercase telephone-poster voice, while Archivo Variable replaces DM Sans for readable UI and body text. Both fonts are pinned, self-hosted Fontsource packages. The homepage status is now text only.
