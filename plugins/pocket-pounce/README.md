# Pocket Pounce

Pocket Pounce is an original keyboard-first arcade game for Redeven. Guide a
small jerboa across moonlit desert stones: hold Space to charge, then release
Space to jump straight forward into the scene. Centered landings earn a bonus
point while each five successful landings makes future stones a little
narrower.

The character, scenery, icon, animation, and game code were created for this
plugin. Runtime graphics use an original software 3D renderer: world-space
meshes are transformed through one perspective camera, depth-sorted, lit, and
rasterized through the sandbox Canvas2D context. A high oblique camera keeps
the landing surface visible, rises with the jump without chasing it forward,
then eases to the new platform after landing. Character and platform
compression, launch and landing effects, bounded dust, and squash-and-stretch
motion make charge and impact readable. The plugin does not use network access,
persistence, audio, telemetry, or third-party visual assets.

Camera and interaction research used the MIT-licensed
[Night's Watch Games Jump Jump](https://github.com/NightsWatchGames/jump-jump)
as a design reference. Pocket Pounce retains its own forward-only model,
original jerboa and desert art direction, and original Canvas2D renderer. The
repository's third-party notices record this provenance and exclude projects
without an explicit license.

## Architecture

- The TypeScript UI runs inside the released ReDevPlugin opaque surface.
- One pure model owns forward charge physics, platform generation, collision,
  scoring, and restart behavior.
- The view uses the host-provided Canvas2D context; input and lifecycle continue
  to use released ReDevPlugin contracts.
- English and Simplified Chinese copy follow the host locale context.

## Build and test

```bash
npm ci
npm test
npm run build
```
