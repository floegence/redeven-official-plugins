import path from 'node:path';
import { platformCLI } from './platform.mjs';

// The released platform resolves GitHub identity; never accept a numeric ID or
// publisher string from the author as source authority.
export async function prepareRepositoryIdentity(pluginRoot, slug, cli = platformCLI) {
  await cli(['repository', 'identity', pluginRoot, slug]);
  await cli(['scaffold', 'repository-index', path.resolve(pluginRoot, '../..'), 'redeven',
    '--project', `plugins/${slug}`, '--manifest', 'manifest.json',
    '--tag-template', `${slug}-v{version}`, '--package-asset-template', `${slug}-{version}.redevplugin`, '--replace']);
}
