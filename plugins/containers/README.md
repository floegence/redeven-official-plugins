# Containers

`com.redeven.official.containers` is the first Redeven official plugin. It uses
the Redeven-owned `redeven.capability.container_resources` capability binding,
so Docker and Podman access remains a host capability adapter rather than a
plugin runtime mechanism.

The UI entry is `ui/index.html`. Runtime calls are made through the ReDevPlugin
sandbox bridge after Redeven installs, enables, and opens the plugin through the
embedded ReDevPlugin Host.
