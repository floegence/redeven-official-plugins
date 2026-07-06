# Containers

`com.redeven.official.containers` is the first Redeven official plugin. It uses
the Redeven-owned `redeven.capability.container_resources` capability binding,
so Docker and Podman access remains a host capability adapter rather than a
plugin runtime mechanism.

The UI entry is `ui/index.html`. Runtime calls are made through the ReDevPlugin
sandbox bridge after Redeven installs, enables, and opens the plugin through the
embedded ReDevPlugin Host.

The plugin deliberately treats Docker and Podman as separate engines. Every
container action is keyed by `(engine, container_id)`, and the UI exposes an
engine selector before listing, inspecting, starting, stopping, restarting,
removing containers, reading log tails, or pulling images.

Declared host capability methods:

- `containers.status`
- `containers.list`
- `containers.inspect`
- `containers.start.preflight`
- `containers.start`
- `containers.stop`
- `containers.restart`
- `containers.remove`
- `containers.logs.tail`
- `images.pull`
