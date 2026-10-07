# Ring art direction

Ring's right to change a coin is expressed through a vintage telephone advertisement and a public call sheet. The interface should feel direct, tangible, and slightly confrontational. Avoid a crypto terminal, generic startup homepage, or fictitious live game dashboard.

The red landline is the signature. It has a raised receiver, physical wear, and a coiled cord. Black type and the phone share the hero; one red action leads to a concrete proposal. The switchboard uses rows and rules, while the hotline resembles a printed call slip. The black rules section changes the density and pace. Mobile puts the telephone below the headline so neither becomes illegible.

## Research applied

[Styles Gallery's AI-interface review](https://styles.gallery/blog/why-ai-built-sites-look-the-same) identifies recurring default component styling, gradient headlines, identical feature grids, and effect-heavy surfaces. Treat its survey counts as the author's claims, not independently established measurements. [Creative Bloq's design commentary](https://www.creativebloq.com/ai/everything-looks-the-same-now-what) discusses brand sameness and the need for specific creative decisions.

These are observations, not a reliable detector of whether a site used AI. No single typeface, color, or component proves authorship. The practical response here is a product-specific design with working interactions.

Choices made for Ring:

- A flush header and asymmetrical hero, rather than a floating pill navigation or centered SaaS stack.
- A real subject: the phone. No coin render, chrome orb, neon grid, aurora, glass card, or sparkle icon.
- A warm white canvas, near-black ink, and vermilion accent. Red is used for the handset, primary action, and selected important details.
- Locally bundled DM Sans and Space Mono. Concrete type sizes and restrained weights; no network font dependency.
- Open row layouts for the proposal board. No invented posts, wallet balances, callers, wins, testimonials, or revenue.
- A native dialog for composition, real buttons and labels, visible focus, keyboard dismissal, explicit unavailable/error states, and reduced-motion behavior.
- Small hover movement only on the telephone, linked to picking it up. No scroll entrance animation or moving backgrounds.

## Generated asset

The built-in image-generation tool produced `public/ring-phone.png`. The final image was copied into the repository with its transparency preserved. Next Image serves appropriately sized versions.

Prompt:

> Create a premium photoreal studio product cutout for a black/white/red website named Ring. A single vintage bright vermilion-red desk landline telephone, 1970s molded plastic pushbutton phone, seen in a dramatic three-quarter front view, angled slightly left. Its matching red handset is lifted clearly above the cradle as if just picked up, hanging diagonally with no person or hand in frame. Black coiled cord connects handset to phone and curls naturally beside the base. Believable physical construction, a square ivory 12-button keypad with small black digits, red plastic with fine wear, rich red color, hard editorial product lighting, restrained photographic highlights. Object fills composition, entire base and handset visible with ample clear transparent margin; absolutely transparent background, no surface, no colored backdrop, no lettering or logo, no effects, no particles, no glow. Portrait 4:5 composition. This should feel like a real vintage telephone photographed for an independent culture magazine, not a shiny futuristic 3D app icon.
