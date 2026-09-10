// Local, deterministic visual-review host. Uses the released sandbox and worker renderer.
// Fixture responses are not live weather and are never included in plugin packages.
import { build } from "esbuild";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "dist/review");
await mkdir(out, { recursive: true });
await build({
  entryPoints: [resolve(root, "ui/src/app.tsx")],
  bundle: true,
  outfile: resolve(out, "worker.js"),
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  jsxImportSource: "@floegence/redevplugin-ui",
});
const host = `import { PluginPlatformClient, PluginSurfaceSlot } from '@floegence/redevplugin-ui';
const params = new URLSearchParams(location.search);
const client = new PluginPlatformClient({fetch: (url, init) => fetch(url + '?' + params, init)});
const stage = document.querySelector('#stage');
if (params.has('width')) stage.style.width = params.get('width') + 'px';
if (params.has('height')) stage.style.height = params.get('height') + 'px';
const slot = PluginSurfaceSlot.create({stage});
const colors = { canvas:'#f4f6fa',surface:'#ffffff',surface_elevated:'#ffffff',text:'#162033',text_muted:'#6b7485',border:'#dce1e9',accent:'#2868d8',accent_text:'#ffffff',success:'#28aa66',warning:'#dd9922',danger:'#cc4455',focus:'#3388ff' };
client.openSurfaceInSlot(slot, {plugin_instance_id:'weather-preview',surface_id:'weather.dashboard'}, {surfaceContext: {schema_version:'redevplugin.surface_context.v1',revision:1,appearance:{color_scheme:'light',colors},locale:{language_tag:params.get('locale') || 'zh-CN',direction:'ltr'}},onError: error => {document.querySelector('#error').textContent = error.message; fetch('/review-error', {method:'POST',body:error.stack || error.message});}}).catch(error => {document.querySelector('#error').textContent = error.message;});`;
await build({
  stdin: { contents: host, resolveDir: root, sourcefile: "review-host.js" },
  bundle: true,
  outfile: resolve(out, "host.js"),
  format: "esm",
  platform: "browser",
});
const locations = [
  {
    id: "review:changsha",
    name: "长沙市",
    admin1: "湖南",
    country: "中国",
    latitude: 28.2,
    longitude: 112.98,
    timezone: "Asia/Shanghai",
  },
  {
    id: "review:beijing",
    name: "北京市",
    admin1: "北京",
    country: "中国",
    latitude: 39.9,
    longitude: 116.4,
    timezone: "Asia/Shanghai",
  },
  {
    id: "review:shanghai",
    name: "上海市",
    admin1: "上海",
    country: "中国",
    latitude: 31.2,
    longitude: 121.5,
    timezone: "Asia/Shanghai",
  },
];
function fixture(location, query) {
  const code = Number(
    query.get("code") ?? (location.id === "review:beijing" ? 0 : 3),
  );
  const is_day = query.get("night") !== "1";
  const days = Array.from({ length: 10 }, (_, i) => ({
    date: `2026-09-${String(10 + i).padStart(2, "0")}`,
    weather_code: [2, 0, 0, 2, 3, 61, 61, 3, 2, 61][i],
    temperature_max: [25, 27, 30, 29, 27, 28, 29, 29, 28, 29][i],
    temperature_min: [21, 19, 22, 21, 23, 22, 23, 22, 22, 22][i],
    precipitation_probability: i < 5 ? 0 : 50,
    precipitation_sum: i < 5 ? 0 : 1.2,
    sunrise: `2026-09-${10 + i}T06:11`,
    sunset: `2026-09-${10 + i}T18:39`,
  }));
  const hourly = days.flatMap((day, d) =>
    Array.from({ length: 24 }, (_, h) => ({
      time: `${day.date}T${String(h).padStart(2, "0")}:00`,
      temperature:
        Math.round(
          (day.temperature_min +
            ((day.temperature_max - day.temperature_min) *
              (Math.sin(((h - 8) / 24) * Math.PI * 2) + 1)) /
              2) *
            10,
        ) / 10,
      apparent_temperature: 20 + Math.sin((h / 12) * Math.PI) * 3,
      weather_code: code,
      is_day: h >= 6 && h < 19,
      precipitation_probability: d < 5 ? 0 : 50,
      humidity: 67,
      wind_speed: 14,
      wind_direction: 345,
      wind_gusts: 36,
      pressure: 1021,
      visibility: 17000,
      uv_index: h >= 7 && h < 18 ? 3 : 0,
    })),
  );
  return {
    timezone: location.timezone,
    timezone_abbreviation: "CST",
    source: "network",
    current: {
      time: "2026-09-10T09:00",
      temperature: 23,
      apparent_temperature: 20,
      humidity: 67,
      weather_code: code,
      wind_speed: 14,
      is_day,
    },
    days,
    hourly,
  };
}
const hash = (value) =>
  "sha256:" + createHash("sha256").update(value).digest("hex");
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/favicon.ico") {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (url.pathname === "/review-error") {
      let body = "";
      for await (const chunk of req) body += chunk;
      console.error(body);
      res.end("ok");
      return;
    }
    if (url.pathname === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Weather · sandbox A/B review</title><style>html,body{margin:0;overflow:hidden;background:#24384b}#stage{width:100vw;height:100vh;margin:auto}iframe{display:block;width:100%;height:100%;border:0}#error{position:fixed;bottom:0;color:red;background:white}</style></head><body><div id="stage"></div><div id="error"></div><script type="module" src="/host.js"></script></body></html>',
      );
      return;
    }
    if (url.pathname === "/host.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(await readFile(resolve(out, "host.js")));
      return;
    }
    const worker = await readFile(resolve(out, "worker.js"), "utf8");
    const css = await readFile(resolve(root, "ui/styles.css"), "utf8");
    const entry = "ui/index.html",
      sha = hash("weather-review");
    const issued_at = new Date().toISOString(),
      expires_at = new Date(Date.now() + 3600000).toISOString();
    const bootstrap = {
      plugin_id: "com.redeven.official.weather",
      plugin_instance_id: "weather-preview",
      plugin_version: "1.0.32",
      surface_id: "weather.dashboard",
      surface_instance_id: "review-surface",
      active_fingerprint: "a".repeat(64),
      entry_path: entry,
      entry_sha256: sha,
      asset_session_nonce: "review-nonce",
      management_revision: 1,
      revoke_epoch: 1,
      runtime_generation_id: "review-runtime",
      asset_ticket: "review-ticket",
      asset_ticket_id: "review-ticket-id",
      bridge_nonce: "review-bridge",
      issued_at,
      expires_at,
    };
    let data;
    if (url.pathname.endsWith("/open")) data = bootstrap;
    else if (url.pathname.endsWith("/prepare"))
      data = {
        asset_session: "review-session",
        asset_session_id: "review-session-id",
        asset_session_nonce: bootstrap.asset_session_nonce,
        entry_path: entry,
        entry_sha256: sha,
        management_revision: 1,
        revoke_epoch: 1,
        issued_at,
        expires_at,
        document: {
          schema_version: "redevplugin.opaque_surface_document.v3",
          entry_path: entry,
          entry_sha256: sha,
          title: "Weather",
          language: "zh-CN",
          direction: "ltr",
          body_html: "<main></main>",
          styles: [
            { path: "ui/assets/styles.css", sha256: hash(css), content: css },
          ],
          worker: {
            path: "ui/assets/app.js",
            sha256: hash(worker),
            type: "classic",
            content: worker,
          },
          assets: [],
          critical_bytes: Buffer.byteLength(css + worker),
        },
      };
    else if (url.pathname.endsWith("/bridge-token"))
      data = {
        plugin_gateway_token: "review-gateway",
        plugin_gateway_token_id: "review-gateway-id",
        asset_session: "review-session",
        asset_session_id: "review-session-id",
        issued_at,
        expires_at,
      };
    else if (url.pathname.endsWith("/rpc")) {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      const params = body.params;
      if (body.method === "weather.state.load")
        data = {
          data: {
            favorites: locations,
            selected: locations[0],
            forecast: fixture(locations[0], url.searchParams),
            location_summaries: locations.map((location) => {
              const f = fixture(location, url.searchParams);
              return {
                location_id: location.id,
                current: f.current,
                today: f.days[0],
              };
            }),
          },
        };
      else if (body.method === "weather.forecast") {
        await new Promise((resolve) => setTimeout(resolve, 500));
        data = {
          data: {
            location: params,
            forecast: fixture(params, url.searchParams),
            favorites: [params, ...locations.filter((x) => x.id !== params.id)],
          },
        };
      } else if (body.method === "weather.locations.search")
        data = {
          data: {
            locations: locations.filter((x) => x.name.includes(params.query)),
          },
        };
      else if (body.method === "weather.locations.remove")
        data = {
          data: { favorites: locations.filter((x) => x.id !== params.id) },
        };
      else throw new Error("Unexpected fixture method: " + body.method);
    } else if (url.pathname.endsWith("/dispose"))
      data = {
        disposed: true,
        state: "closed",
        previous_state: "active",
        revoked: true,
      };
    else throw new Error("Unexpected fixture route: " + url.pathname);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, data }));
  } catch (error) {
    console.error(error);
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        ok: false,
        error: {
          code: "PLUGIN_INTERNAL",
          message: error.message,
          mutation_outcome: "not_committed",
        },
      }),
    );
  }
});
server.listen(
  Number(process.env.WEATHER_PREVIEW_PORT || 4178),
  "127.0.0.1",
  () =>
    console.log(
      "Weather fixture review: http://127.0.0.1:4178 (released opaque sandbox, synthetic weather)",
    ),
);
