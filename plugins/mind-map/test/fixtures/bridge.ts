// Application behaviour fixture. This is not Host authorization or WASM evidence.
import {
  PluginBridgeClient as Actual,
  PluginBridgeError,
} from "../../node_modules/@floegence/redevplugin-ui/dist/plugin.js";
import { createPluginTestContext } from "@floegence/redevplugin-ui/testing";
import {
  createWorkspace,
  serializeWorkspaceDSL,
  parseWorkspaceDSL,
} from "../../ui/src/workspace-model";
export { PluginBridgeError };
const channel = new MessageChannel();
let revision = 0,
  dsl = serializeWorkspaceDSL(createWorkspace(1)),
  contextRevision = 0;
let mode = "ok",
  readsAvailable = !new URLSearchParams(location.search).has("load-fails"),
  writes = 0,
  sequence = 0;
const methods: string[] = [],
  exports: any[] = [],
  pending = new Map<string, (value: any) => void>();
function send(value: unknown) {
  channel.port2.postMessage(value);
}
function context(theme = "light", locale = "en-US") {
  const value = createPluginTestContext(locale, ++contextRevision);
  value.appearance.color_scheme = theme as "light" | "dark";
  if (theme === "light")
    Object.assign(value.appearance.colors, {
      canvas: "#f5f5f2",
      surface: "#fbfbf9",
      surface_elevated: "#ffffff",
      text: "#252722",
      text_muted: "#73766e",
      border: "#dedfd8",
      accent: "#5c78b5",
      accent_text: "#ffffff",
    });
  send({ type: "redevplugin.bridge.context", context: value });
}
channel.port2.onmessage = ({ data: m }) => {
  if (m.type === "redevplugin.bridge.methods") {
    methods.splice(0, methods.length, ...m.methods);
    send({ type: "redevplugin.bridge.response", id: m.id, ok: true, data: {} });
    return;
  }
  if (m.type === "redevplugin.bridge.method_result") {
    pending.get(m.invocation_id)?.(m);
    pending.delete(m.invocation_id);
    return;
  }
  if (m.type === "redevplugin.bridge.close_response") {
    pending.get(m.close_id)?.(m.allow);
    pending.delete(m.close_id);
    return;
  }
  if (m.type === "redevplugin.ui.file.export") {
    exports.push({
      fileName: m.file_name,
      mediaType: m.media_type,
      bytes: Array.from(new Uint8Array(m.content)),
    });
    send({ type: "redevplugin.bridge.response", id: m.id, ok: true, data: {} });
    return;
  }
  if (m.type !== "redevplugin.bridge.call") return;
  const { id, method, params } = m.request;
  const ok = (data: unknown) =>
    send({ type: "redevplugin.bridge.response", id, ok: true, data: { data } });
  const fail = (code: string, outcome = "not_committed") =>
    send({
      type: "redevplugin.bridge.response",
      id,
      ok: false,
      error_code: code,
      error: "Fixture failure",
      mutation_outcome: outcome,
    });
  if (method === "mindmap.workspace.load") {
    if (!readsAvailable) return fail("PLUGIN_RUNTIME_UNAVAILABLE");
    ok({
      revision,
      saved_at: revision ? "2026-10-30T00:00:00Z" : null,
      workspace_dsl: dsl,
    });
    return;
  }
  if (method === "mindmap.workspace.save") {
    writes++;
    if (params.expected_revision !== revision) {
      send({
        type: "redevplugin.bridge.response",
        id,
        ok: false,
        error_code: "PLUGIN_WORKER_ERROR",
        error: "Worker rejected stale revision",
        error_details: {
          worker_error_code: "MIND_MAP_CONFLICT",
          worker_error_message: "A newer workspace exists",
          worker_error_origin: "plugin",
        },
        mutation_outcome: "not_committed",
      });
      return;
    }
    if (mode === "fail") return fail("PLUGIN_RUNTIME_UNAVAILABLE");
    if (mode === "unknown-old")
      return fail("PLUGIN_RUNTIME_UNAVAILABLE", "unknown");
    parseWorkspaceDSL(params.workspace_dsl);
    dsl = params.workspace_dsl;
    revision++;
    if (mode === "unknown-committed") {
      mode = "ok";
      return fail("PLUGIN_RUNTIME_UNAVAILABLE", "unknown");
    }
    ok({ revision, saved_at: "2026-10-30T00:00:00Z" });
    return;
  }
  fail("PLUGIN_INVALID_REQUEST");
};
export class PluginBridgeClient extends Actual {
  constructor(options = {}) {
    super({
      ...options,
      port: channel.port1,
      surfaceHandle: "surface_mindmap_fixture",
    });
    context(new URLSearchParams(location.search).get("theme") ?? "light");
    send({ type: "redevplugin.bridge.lifecycle", event: { type: "ready" } });
  }
}
Object.assign(window, {
  __mindMapTest: {
    methods: () => [...methods],
    stored: () => ({ revision, dsl, writes }),
    exports: () => exports,
    remoteSave: () => {
      revision++;
    },
    mode: (value: string) => {
      mode = value;
    },
    reads: (value: boolean) => {
      readsAvailable = value;
    },
    context,
    invoke: (method: string, params: unknown) =>
      new Promise((resolve) => {
        const id = "invoke_" + ++sequence;
        pending.set(id, resolve);
        send({
          type: "redevplugin.bridge.method_invoke",
          invocation: {
            invocation_id: id,
            method,
            params,
            deadline: new Date(Date.now() + 10000).toISOString(),
          },
        });
      }),
    beforeClose: () =>
      new Promise((resolve) => {
        const id = "close_mindmap_" + String(++sequence).padStart(20, "0");
        pending.set(id, resolve);
        send({ type: "redevplugin.bridge.close_request", close_id: id });
      }),
    dispose: () =>
      send({
        type: "redevplugin.bridge.lifecycle",
        event: { type: "dispose" },
      }),
  },
});
