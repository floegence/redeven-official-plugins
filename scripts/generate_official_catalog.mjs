import { platformCLI } from './lib/platform.mjs';
import { repoRootFrom } from './lib/officialPlugins.mjs';
// The repository index is the only discovery declaration. Package presentation
// is obtained by the market from released CLI inspection, never copied here.
const result = await platformCLI(['repository', 'validate', repoRootFrom(import.meta.url)]);
console.log(JSON.stringify(result, null, 2));
