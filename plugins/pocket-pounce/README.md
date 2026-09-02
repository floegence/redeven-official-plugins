# Pocket Pounce

Pocket Pounce is an original keyboard-first arcade game for Redeven. Guide a
small jerboa across moonlit desert platforms: hold Space to charge, then
release Space to pounce along the visible diagonal route. A run starts from the
lower left toward the upper right and periodically turns into the opposite
lower-right-to-upper-left diagonal.

Landings use the jerboa's complete support disc against the actual rotated
platform footprint. A safe landing preserves the physical contact point rather
than moving the character to the center. A center landing earns one bonus
point; a foot placed over an edge makes the jerboa tip and fall.

The character, scenery, icon, animation, and game code were created for this
plugin. Runtime graphics use an original software 3D renderer: world-space
meshes are transformed through one perspective camera, depth-sorted, lit, and
rasterized through the sandbox Canvas2D context. Round, square, hexagonal, and
diamond platforms rotate through sandstone, slate, moonstone, and copper art
directions. New targets rise, turn, overshoot, glow, and shed bounded particles
after each landing. The rear-oblique top-down camera follows jump height while
holding its forward anchor. Character squash, ear fold, leg coil, platform
compression, launch stretch, impact rebound, and edge roll all derive from the
same game state used by collision and scoring.

The plugin does not use network access, persistence, audio, telemetry, or
third-party visual assets.

Interaction and camera research consulted the MIT-licensed
[Night's Watch Games Jump Jump](https://github.com/NightsWatchGames/jump-jump)
and [shenmaxg Web Jump](https://github.com/shenmaxg/web-jump). Pocket Pounce
uses only the general principles of alternating course directions, orthographic
composition, charge deformation, platform response, spawn motion, and explicit
edge-fall states. It keeps its own physics, original jerboa and desert art
direction, and original Canvas2D renderer. See `THIRD_PARTY_NOTICES.txt` for
the complete provenance statement.

## Architecture

- The TypeScript UI runs inside the released ReDevPlugin opaque surface.
- One pure model owns two-axis charge physics, route generation, swept landing
  collision, scoring, and restart behavior.
- The view uses the host-provided Canvas2D context; input and lifecycle continue
  to use released ReDevPlugin contracts.
- English and Simplified Chinese copy follow the host locale context.

## Build and test

```bash
npm ci
npm test
npm run build
```
