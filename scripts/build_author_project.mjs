import { buildProject } from './lib/authorProject.mjs';
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--release')) throw new Error('usage: build_author_project.mjs [--release]');
console.log(JSON.stringify(await buildProject(process.cwd(), args[0] === '--release')));
