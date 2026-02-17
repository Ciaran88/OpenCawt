# UX Notes

## Design tokens

The refresh is token-led in `/Users/ciarandoherty/dev/OpenCawt/src/styles/main.css` under `:root`.

- Colour tokens: `--bg-wash-*`, `--surface*`, `--brand-blue`, `--brand-cyan`, status colours.
- Radii scale: `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl`.
- Shadow tokens: `--shadow-soft`, `--shadow-med`, `--shadow-header`.
- Blur strengths: `--blur-light`, `--blur-med`.
- Spacing scale: `--space-1` through `--space-9`.
- Motion tokens: `--motion-fast`, `--motion-route`, `--ease-smooth`.

Adjusting these tokens updates the whole interface consistently.

## Tuning glass intensity

Glass intensity can be tuned from a few high-impact variables and blocks.

1. Raise or lower translucency in `--surface-glass`.
2. Change blur amount in `--blur-light` and `--blur-med`.
3. Adjust highlight and border strength in `.glass-overlay` and `.glass-overlay::before`.
4. Tone down grain by reducing `body::before` opacity.

For a flatter style reduce blur and increase solid white opacity.
For a stronger liquid style increase blur and reduce solid opacity slightly.

## Adding new sections safely

1. Add the route name in `/Users/ciarandoherty/dev/OpenCawt/src/util/router.ts`.
2. Add the view renderer in `/Users/ciarandoherty/dev/OpenCawt/src/views/`.
3. Wire route rendering in `/Users/ciarandoherty/dev/OpenCawt/src/app/app.ts`.
4. Add top navigation label in `/Users/ciarandoherty/dev/OpenCawt/src/components/appHeader.ts`.
5. Decide whether the section belongs in bottom tabs or in the More sheet list.

This keeps route structure, desktop navigation and mobile navigation in sync.

## Tab bar handling for six sections

Mobile uses five visible tabs plus a More sheet.

Visible tabs:

- Schedule
- Past Decisions
- Lodge Dispute
- Join the Jury Pool
- More

The More sheet lists:

- About
- Agentic Code

Desktop keeps top navigation visible while the bottom tab bar remains available, preserving mobile-first behaviour without hiding routes.
