# Pocket Pounce

Pocket Pounce is an original keyboard-first arcade game for Redeven. Guide a
small jerboa across moonlit desert stones: hold Space to charge, then release
Space to jump. The authoritative game model moves through horizontal, vertical,
and depth axes while a perspective camera projects the scene. Centered landings
earn a bonus point while each five successful landings makes future stones a
little narrower.

The character, scenery, icon, animation, and game code were created for this
plugin. Runtime graphics are drawn from Canvas primitives with perspective
projection, shaded volumes, squash-and-stretch motion, camera follow, impact
rings, and bounded dust particles. The plugin does not use network access,
persistence, audio, telemetry, or third-party visual assets.

## Architecture

- The TypeScript UI runs inside the released ReDevPlugin opaque surface.
- One pure model owns three-dimensional charge physics, platform generation,
  collision, scoring, and restart behavior.
- The view uses the host-provided Canvas input and lifecycle contracts.
- English and Simplified Chinese copy follow the host locale context.

## Build and test

```bash
npm ci
npm test
npm run build
```
