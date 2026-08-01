import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { generateDesignAssets } from '../build-design-assets.mjs';

const requiredAppicaTokens = ['--radius-sm', '--radius-md', '--shadow-sm', '--shadow-md', '--text-xs', '--text-sm'];
const requiredLucideIcons = [
  'activity', 'box', 'boxes', 'circle-stop', 'database', 'download', 'ellipsis',
  'folder-kanban', 'images', 'layout-dashboard', 'minus', 'package-plus', 'play',
  'plus', 'refresh-cw', 'rotate-cw', 'search', 'square', 'trash-2', 'x',
];

test('generates a bounded Appica token bridge and rasterized Lucide icon subset', async () => {
  const fixture = await designFixture();
  await generateDesignAssets(fixture.root, fixture.dist);
  const theme = await readFile(join(fixture.dist, 'ui', 'assets', 'appica-theme.css'), 'utf8');
  const icons = await readFile(join(fixture.dist, 'ui', 'assets', 'lucide-icons.css'), 'utf8');
  const appicaLicense = await readFile(join(fixture.dist, 'licenses', 'appica-ui-MIT.txt'), 'utf8');
  const lucideLicense = await readFile(join(fixture.dist, 'licenses', 'lucide-ISC-MIT.txt'), 'utf8');
  assert.match(theme, /@appica\/ui-react@1\.0\.0/u);
  assert.match(theme, /--appica-radius-control/u);
  assert.match(icons, /lucide-static@1\.27\.0/u);
  assert.match(icons, /url\("icons\/box\.png"\)/u);
  assert.doesNotMatch(icons, /data:/u);
  assert.doesNotMatch(icons, /@font-face|\.woff2/u);
  const generatedRules = icons.match(/\.lucide-(?!icon\b)[a-z0-9-]+::before/g) ?? [];
  assert.equal(generatedRules.length, requiredLucideIcons.length);
  const box = await readFile(join(fixture.dist, 'ui', 'assets', 'icons', 'box.png'));
  assert.deepEqual([...box.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(appicaLicense, 'appica-license-fixture');
  assert.equal(lucideLicense, 'lucide-license-fixture');
});

test('fails closed when Appica tokens or Lucide SVG assets drift', async () => {
  const missingToken = await designFixture({ appicaTokens: requiredAppicaTokens.slice(1) });
  await assert.rejects(() => generateDesignAssets(missingToken.root, missingToken.dist), /design token is missing/u);
  const missingIcon = await designFixture({ lucideIcons: requiredLucideIcons.slice(1) });
  await assert.rejects(() => generateDesignAssets(missingIcon.root, missingIcon.dist), /ENOENT/u);
  const driftedIcon = await designFixture({ lucideIcons: requiredLucideIcons, driftedIcon: 'box' });
  await assert.rejects(() => generateDesignAssets(driftedIcon.root, driftedIcon.dist), /digest does not match/u);
});

test('fails closed when a design dependency version changes', async () => {
  const fixture = await designFixture({ appicaVersion: '1.0.1' });
  await assert.rejects(() => generateDesignAssets(fixture.root, fixture.dist), /expected @appica\/ui-react@1\.0\.0/u);
});

async function designFixture({ appicaTokens = requiredAppicaTokens, lucideIcons = requiredLucideIcons, appicaVersion = '1.0.0', driftedIcon } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'redeven-containers-design-'));
  const dist = join(root, 'dist');
  const appica = join(root, 'node_modules', '@appica', 'ui-react');
  const lucide = join(root, 'node_modules', 'lucide-static');
  await mkdir(join(dist, 'ui', 'assets'), { recursive: true });
  await mkdir(appica, { recursive: true });
  await mkdir(join(lucide, 'icons'), { recursive: true });
  await mkdir(join(root, 'assets', 'icons'), { recursive: true });
  await writeFile(join(appica, 'package.json'), JSON.stringify({ version: appicaVersion }));
  await writeFile(join(appica, 'styles.css'), appicaTokens.map((token) => token + ': 1px;').join('\n'));
  await writeFile(join(appica, 'LICENSE'), 'appica-license-fixture');
  await writeFile(join(lucide, 'package.json'), JSON.stringify({ version: '1.27.0' }));
  const manifest = { icons: {} };
  await Promise.all(lucideIcons.map(async (name) => {
    const svg = '<svg viewBox="0 0 24 24"><path stroke="currentColor" d="M2 12h20"/></svg>';
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, name.length]);
    await writeFile(join(lucide, 'icons', name + '.svg'), name === driftedIcon ? svg.replace('M2', 'M3') : svg);
    await writeFile(join(root, 'assets', 'icons', name + '.png'), png);
    manifest.icons[name] = { source_sha256: digest(normalize(svg)), png_sha256: digest(png) };
  }));
  await writeFile(join(root, 'assets', 'icons', 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(lucide, 'LICENSE'), 'lucide-license-fixture');
  return { root, dist };
}

function normalize(source) { return source.replace(/\r?\n|\t/gu, ' ').replace(/\s{2,}/gu, ' ').replaceAll('currentColor', '#000000').trim(); }
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
