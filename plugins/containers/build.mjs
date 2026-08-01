import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { generateDesignAssets } from './build-design-assets.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'ui', 'assets'), { recursive: true });
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const capabilityPin = JSON.parse(readFileSync(join(root, 'host-capability.pin.json'), 'utf8'));
const generatedClient = readFileSync(join(root, 'src', 'generated', 'redeven.container_resources.v4.client.ts'), 'utf8');
const capabilityMethods = [...generatedClient.matchAll(/^  method: "([a-z0-9.]+)",$/gmu)]
  .map((match) => match[1]);
if (capabilityMethods.length !== 52 || new Set(capabilityMethods).size !== capabilityMethods.length) {
  throw new Error('generated Containers capability method projection is invalid');
}
manifest.capability_bindings = [{ binding_id: 'containers-v4', contract: capabilityPin }];
manifest.methods = capabilityMethods.map((method) => ({
  method,
  route: { kind: 'capability', binding_id: 'containers-v4', target_method: method },
}));
writeFileSync(join(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
cpSync(join(root, 'ui', 'index.html'), join(dist, 'ui', 'index.html'));
cpSync(join(root, 'ui', 'assets', 'styles.css'), join(dist, 'ui', 'assets', 'styles.css'));
cpSync(
  join(root, 'assets', 'containers-plugin.png'),
  join(dist, 'ui', 'assets', 'containers-plugin.png'),
);
await generateDesignAssets(root, dist);

const result = await build({
  entryPoints: [join(root, 'src', 'main.ts')],
  outfile: join(dist, 'ui', 'assets', 'app.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  nodePaths: [join(root, 'node_modules')],
  target: ['es2022'],
  legalComments: 'none',
  minify: false,
  sourcemap: false,
  write: false,
});

if (result.outputFiles.length !== 1) throw new Error('expected one bundled Containers plugin worker');
writeFileSync(join(dist, 'ui', 'assets', 'app.js'), rewriteRegularExpressionLiterals(result.outputFiles[0].text));

function rewriteRegularExpressionLiterals(source) {
  const sourceFile = ts.createSourceFile('containers-plugin.js', source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const transform = ts.transform(sourceFile, [
    (context) => {
      const visit = (node) => {
        if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
          const literal = node.text;
          const delimiter = literal.lastIndexOf('/');
          if (delimiter <= 0) throw new Error('invalid regular expression literal in Containers plugin bundle');
          const args = [ts.factory.createStringLiteral(literal.slice(1, delimiter))];
          const flags = literal.slice(delimiter + 1);
          if (flags) args.push(ts.factory.createStringLiteral(flags));
          return ts.factory.createNewExpression(ts.factory.createIdentifier('RegExp'), undefined, args);
        }
        return ts.visitEachChild(node, visit, context);
      };
      return (rootNode) => ts.visitNode(rootNode, visit);
    },
  ]);
  const output = ts.createPrinter({ removeComments: true }).printFile(transform.transformed[0]);
  transform.dispose();
  return output;
}
