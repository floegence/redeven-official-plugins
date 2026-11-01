import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import { chromium } from "playwright";
let server, browser, base;
before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../ui", import.meta.url)),
    configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
    resolve: {
      alias: [
        {
          find: "@floegence/redevplugin-ui/plugin",
          replacement: fileURLToPath(
            new URL("./fixtures/bridge.ts", import.meta.url),
          ),
        },
      ],
    },
    server: { host: "127.0.0.1", port: 0 },
    logLevel: "error",
  });
  await server.listen();
  base = "http://127.0.0.1:" + server.httpServer.address().port;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
async function ready(t, width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, []);
  });
  await page.goto(base);
  await page.waitForFunction(
    () => window.__mindMapTest?.methods().length === 2,
    null,
    { timeout: 8000 },
  );
  return page;
}
async function read(page) {
  return (
    await page.evaluate(() =>
      window.__mindMapTest.invoke("mindmap.document.read", {}),
    )
  ).data;
}
async function edit(page, operations) {
  const current = await read(page);
  return page.evaluate(
    ({ current, operations }) =>
      window.__mindMapTest.invoke("mindmap.document.edit", {
        document_id: current.document_id,
        expected_revision: current.revision,
        operations,
      }),
    { current, operations },
  );
}
test("the first mounted editor uses the host theme", async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.addInitScript(() => {
    window.__editorThemes = [];
    new MutationObserver(() => {
      if (document.querySelector('.mind-map-app')) window.__editorThemes.push(document.documentElement.classList.contains('dark'));
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto(base + '/?theme=dark');
  await page.waitForFunction(() => window.__mindMapTest?.methods().length === 2);
  const themes = await page.evaluate(() => window.__editorThemes);
  assert.ok(themes.length > 0);
  assert.ok(themes.every(Boolean), 'no light editor is mounted before the host context');
});
test("native keyboard editing and Agent edits share one undo history", async (t) => {
  const page = await ready(t),
    initial = await read(page);
  await page.locator("canvas").focus();
  await page.keyboard.press("Tab");
  const input = page.getByRole("textbox", { name: "Topic", exact: true });
  await input.fill("User child");
  await input.press("Enter");
  const current = await read(page);
  assert.match(current.document_dsl, /User child/);
  const result = await edit(page, [
    {
      type: "rename_node",
      node_id: current.selected_node_id,
      title: "Agent child",
    },
  ]);
  assert.equal(result.data.status, "applied");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.match((await read(page)).document_dsl, /User child/);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  assert.match((await read(page)).document_dsl, /Agent child/);
  const stale = await page.evaluate(
    (initial) =>
      window.__mindMapTest.invoke("mindmap.document.edit", {
        document_id: initial.document_id,
        expected_revision: initial.revision,
        operations: [
          {
            type: "rename_node",
            node_id: initial.selected_node_id,
            title: "Stale",
          },
        ],
      }),
    initial,
  );
  assert.equal(stale.data.status, "conflict");
});
test("IME editor keeps its DOM node and selection across theme changes", async (t) => {
  const page = await ready(t);
  await page.locator("canvas").focus();
  await page.keyboard.press("F2");
  const input = page.getByRole("textbox", { name: "Topic", exact: true });
  await input.fill("中文主题");
  await input.evaluate((el) => {
    window.__editor = el;
    el.setSelectionRange(1, 3);
    el.dispatchEvent(
      new CompositionEvent("compositionstart", { data: "中文" }),
    );
  });
  await page.evaluate(() => window.__mindMapTest.context("dark"));
  assert.equal(
    await input.evaluate(
      (el) => el === window.__editor && document.activeElement === el,
    ),
    true,
  );
  assert.deepEqual(
    await input.evaluate((el) => [el.selectionStart, el.selectionEnd]),
    [1, 3],
  );
  assert.equal(
    await page.evaluate(() => window.__mindMapTest.beforeClose()),
    false,
  );
  await input.evaluate((el) =>
    el.dispatchEvent(
      new CompositionEvent("compositionend", { data: "中文主题" }),
    ),
  );
  await input.press("Enter");
  assert.match((await read(page)).document_dsl, /中文主题/);
});
test("unknown save is read back before close without replaying the write", async (t) => {
  const page = await ready(t);
  await page.evaluate(() => window.__mindMapTest.mode("unknown-committed"));
  const current = await read(page);
  await edit(page, [
    {
      type: "rename_node",
      node_id: current.selected_node_id,
      title: "Persisted despite lost response",
    },
  ]);
  await page.waitForFunction(() => window.__mindMapTest.stored().writes === 1);
  assert.equal(
    await page.evaluate(() => window.__mindMapTest.beforeClose()),
    true,
  );
  assert.equal(
    (await page.evaluate(() => window.__mindMapTest.stored())).writes,
    1,
  );
});
test("unconfirmed writes veto close and disposal never saves", async (t) => {
  const page = await ready(t);
  await page.evaluate(() => window.__mindMapTest.mode("unknown-old"));
  const current = await read(page);
  await edit(page, [
    {
      type: "rename_node",
      node_id: current.selected_node_id,
      title: "Keep this unsaved",
    },
  ]);
  await page.waitForFunction(() => window.__mindMapTest.stored().writes === 1);
  assert.equal(
    await page.evaluate(() => window.__mindMapTest.beforeClose()),
    false,
  );
  assert.equal(
    (await page.evaluate(() => window.__mindMapTest.stored())).writes,
    1,
  );
  await page.evaluate(() => window.__mindMapTest.dispose());
  await page.locator(".mind-map-app").waitFor({ state: "detached" });
  assert.equal(
    (await page.evaluate(() => window.__mindMapTest.stored())).writes,
    1,
  );
});
for (const width of [390, 768, 1280])
  for (const theme of ["light", "dark"])
    test(
      width + " " + theme + " has accessible controls without overflow",
      async (t) => {
        const page = await ready(t, width);
        await page.evaluate(
          (theme) => window.__mindMapTest.context(theme),
          theme,
        );
        await page.waitForFunction(
          (theme) => document.documentElement.classList.contains(theme),
          theme,
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        assert.equal(
          await page
            .locator("canvas")
            .evaluate((el) => el.width > 0 && el.height > 0),
          true,
        );
        if (process.env.MIND_MAP_SCREENSHOTS) {
          await mkdir(process.env.MIND_MAP_SCREENSHOTS, { recursive: true });
          await page.screenshot({
            path:
              process.env.MIND_MAP_SCREENSHOTS +
              "/mind-map-" +
              width +
              "-" +
              theme +
              ".png",
          });
        }
      },
    );

test("invalid import preserves its dialog and content until corrected", async (t) => {
  const page = await ready(t);
  await page.getByRole("button", { name: "Import file", exact: true }).click();
  const dialog = page.getByRole("dialog"),
    input = dialog.getByRole("textbox");
  await input.fill("invalid document");
  await dialog
    .getByRole("button", { name: "Import as new map", exact: true })
    .click();
  await dialog.waitFor();
  assert.equal(await input.inputValue(), "invalid document");
  assert.match(await dialog.getByRole("alert").innerText(), /invalid/i);
  const current = await read(page);
  await input.fill(current.document_dsl);
  await dialog
    .getByRole("button", { name: "Import as new map", exact: true })
    .click();
  await dialog.waitFor({ state: "detached" });
  assert.notEqual((await read(page)).document_id, current.document_id);
});
test("all five exports deliver complete files without changing the visible canvas", async (t) => {
  const page = await ready(t),
    before = await page
      .locator("canvas")
      .evaluate((el) => [el.width, el.height]),
    formats = [
      "PNG image",
      "JPEG image",
      "WebP image",
      "SVG image",
      "Mind map DSL",
    ];
  for (let i = 0; i < formats.length; i++) {
    await page
      .getByRole("button", { name: "Export file", exact: true })
      .click();
    await page.getByRole("menuitem", { name: formats[i], exact: true }).click();
    await page.waitForFunction(
      (n) => window.__mindMapTest.exports().length === n,
      i + 1,
    );
  }
  const files = await page.evaluate(() => window.__mindMapTest.exports());
  assert.deepEqual(
    files.map((f) => f.mediaType),
    ["image/png", "image/jpeg", "image/webp", "image/svg+xml", "text/plain"],
  );
  assert.ok(files.every((f) => f.bytes.length > 100));
  assert.deepEqual(
    files[0].bytes.slice(0, 8),
    [137, 80, 78, 71, 13, 10, 26, 10],
  );
  assert.equal(
    new TextDecoder().decode(Uint8Array.from(files[3].bytes)).includes("<svg"),
    true,
  );
  assert.deepEqual(
    await page.locator("canvas").evaluate((el) => [el.width, el.height]),
    before,
  );
});
test("initial load retry registers Agent methods after recovery", async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.goto(base + "?load-fails");
  await page
    .getByRole("button", { name: "Retry", exact: true })
    .waitFor({ timeout: 22000 });
  await page.evaluate(() => window.__mindMapTest.reads(true));
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.waitForFunction(
    () => window.__mindMapTest.methods().length === 2,
    null,
    { timeout: 5000 },
  );
  assert.ok((await read(page)).document_id);
});
test("known save failure retries and preserves the edited document", async (t) => {
  const page = await ready(t);
  await page.evaluate(() => window.__mindMapTest.mode("fail"));
  const current = await read(page);
  await edit(page, [
    {
      type: "rename_node",
      node_id: current.selected_node_id,
      title: "Retry this title",
    },
  ]);
  await page.getByRole("button", { name: "Retry", exact: true }).waitFor();
  assert.equal((await read(page)).dirty, true);
  await page.evaluate(() => window.__mindMapTest.mode("ok"));
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.waitForFunction(() => window.__mindMapTest.stored().writes === 2);
  assert.equal(
    await page.evaluate(() => window.__mindMapTest.beforeClose()),
    true,
  );
  assert.match((await read(page)).document_dsl, /Retry this title/);
});

test("Worker conflict offers recovery and preserves local edits as a copy", async (t) => {
  const page = await ready(t),
    current = await read(page);
  await page.evaluate(() => window.__mindMapTest.remoteSave());
  await edit(page, [
    {
      type: "rename_node",
      node_id: current.selected_node_id,
      title: "Recovered local title",
    },
  ]);
  await page
    .getByRole("button", { name: "Keep mine as copy", exact: true })
    .waitFor({ timeout: 5000 });
  await page
    .getByRole("button", { name: "Keep mine as copy", exact: true })
    .click();
  await page.waitForFunction(
    () => window.__mindMapTest.stored().revision === 2,
  );
  assert.match((await read(page)).document_dsl, /Recovered local title/);
  assert.notEqual((await read(page)).document_id, current.document_id);
});
test("native drag reparents a branch; context menu, layout, colour and folding remain usable", async (t) => {
  const page = await ready(t),
    root = (await read(page)).selected_node_id;
  await edit(page, [
    { type: "add_child", node_id: root, title: "Design" },
    { type: "add_child", node_id: root, title: "Build" },
  ]);
  await page.getByRole("button", { name: "Center", exact: true }).click();
  const boxes = await page.evaluate(async () => {
    const { parseDocumentDSL } = await import("/src/workspace-model.ts"),
      { layoutDocument, fitLayoutToViewport } = await import("/src/layout.ts");
    const doc = parseDocumentDSL(
        (await window.__mindMapTest.invoke("mindmap.document.read", {})).data
          .document_dsl,
      ),
      canvas = document.querySelector("canvas"),
      ctx = canvas.getContext("2d"),
      bounds = canvas.getBoundingClientRect();
    const layout = layoutDocument(doc, undefined, (text, font) => {
        ctx.font = font;
        return ctx.measureText(text).width;
      }),
      view = fitLayoutToViewport(layout, bounds.width, bounds.height, {
        top: 92,
        right: 28,
        bottom: 114,
        left: 28,
      });
    return Object.fromEntries(
      doc.nodes.map((n) => {
        const b = layout.nodes.get(n.id);
        return [
          n.title,
          {
            id: n.id,
            x: bounds.left + bounds.width / 2 + view.x + b.x * view.zoom,
            y: bounds.top + bounds.height / 2 + view.y + b.y * view.zoom,
          },
        ];
      }),
    );
  });
  await page.mouse.move(boxes.Design.x, boxes.Design.y);
  await page.mouse.down();
  await page.mouse.move(boxes.Build.x, boxes.Build.y, { steps: 12 });
  await page.mouse.up();
  const moved = await page.evaluate(async () => {
    const { parseDocumentDSL } = await import("/src/workspace-model.ts");
    return parseDocumentDSL(
      (await window.__mindMapTest.invoke("mindmap.document.read", {})).data
        .document_dsl,
    ).nodes;
  });
  assert.equal(
    moved.find((n) => n.id === boxes.Design.id).parent_id,
    boxes.Build.id,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Blue", exact: true }).click();
  await page
    .getByRole("button", { name: "Align text left", exact: true })
    .click();
  assert.match((await read(page)).document_dsl, /blue/);
  await page
    .getByRole("button", { name: "Switch to right only", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Switch to both sides", exact: true })
    .waitFor();
  await page.locator("canvas").focus();
  await page.keyboard.press("F2");
  const input = page.getByRole("textbox", { name: "Topic", exact: true }),
    b = await input.boundingBox();
  await input.press("Escape");
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, {
    button: "right",
  });
  await page.getByRole("menuitem", { name: "Child Tab", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Topic", exact: true })
    .fill("Nested topic");
  await page
    .getByRole("textbox", { name: "Topic", exact: true })
    .press("Enter");
  assert.match((await read(page)).document_dsl, /Nested topic/);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  const zoom = await page.locator(".zoom-controls > span").innerText();
  await page.locator("canvas").hover();
  await page.mouse.wheel(0, 150);
  await page.waitForFunction(
    (old) =>
      document.querySelector(".zoom-controls > span").textContent !== old,
    zoom,
  );
  const current = await read(page);
  await edit(page, [{ type: "toggle_collapsed", node_id: root }]);
  assert.match((await read(page)).document_dsl, /folded: true/);
  await page
    .getByRole("button", { name: "Fold / unfold", exact: true })
    .click();
});
test("mobile sidebar exposes readable map names and file import preserves all nodes", async (t) => {
  const page = await ready(t, 390),
    current = await read(page);
  await page.getByRole("button", { name: "Maps", exact: true }).click();
  assert.equal(await page.locator(".document-copy").isVisible(), true);
  await page.getByRole("button", { name: "New map", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("Travel plan");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Import file", exact: true }).click();
  await page
    .getByRole("dialog")
    .locator("input[type=file]")
    .setInputFiles({
      name: "original.mindmap",
      mimeType: "text/plain",
      buffer: Buffer.from(current.document_dsl),
    });
  await page
    .getByRole("button", { name: "Import as new map", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.match((await read(page)).document_dsl, /Central topic/);
  await page.locator(".sidebar-dismiss").click();
  assert.equal(await page.locator(".document-sidebar").isVisible(), false);
});
