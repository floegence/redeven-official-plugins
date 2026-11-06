import { access, copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";

let releaseWorker;
if (process.env.REDEVPLUGIN_OFFICIAL_RELEASE === '1') {
  const compiled = JSON.parse(await readFile(resolve(root, 'generated/manifest.json'), 'utf8'));
  releaseWorker = resolve(root, '../../dist/release/weather', compiled.plugin.version, 'canonical-weather.wasm');
  run(resolve(root, '../../scripts/build_weather_release_wasm.sh'), [releaseWorker]);
}
await rm(resolve(root, "dist"), { recursive: true, force: true });
run(npm, ["run", "build:ui"]);
let workerSource;
if (releaseWorker) {
  workerSource = resolve(releaseWorker);
  await access(workerSource);
  const bytes = await readFile(workerSource);
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))) {
    throw new Error("canonical Weather Worker is not a WebAssembly module");
  }
} else {
  try {
    await access(resolve(root, "worker/Cargo.lock"));
  } catch {
    run(cargo, ["generate-lockfile", "--manifest-path", "worker/Cargo.toml"]);
  }
  run(cargo, ["build", "--locked", "--release", "--target", "wasm32-unknown-unknown", "--manifest-path", "worker/Cargo.toml"]);
  workerSource = resolve(root, "worker/target/wasm32-unknown-unknown/release/redeven_official_weather_worker.wasm");
}

await mkdir(resolve(root, "dist/ui/assets"), { recursive: true });
await mkdir(resolve(root, "dist/workers"), { recursive: true });
await mkdir(resolve(root, "dist/licenses"), { recursive: true });
await Promise.all([
  copyFile(resolve(root, "generated/manifest.json"), resolve(root, "dist/manifest.json")),
  copyFile(resolve(root, "assets/weather-plugin.png"), resolve(root, "dist/ui/assets/weather-plugin.png")),
  copyFile(resolve(root, "THIRD_PARTY_NOTICES.txt"), resolve(root, "dist/licenses/THIRD_PARTY_NOTICES.txt")),
  copyFile(workerSource, resolve(root, "dist/workers/weather.wasm")),
]);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
