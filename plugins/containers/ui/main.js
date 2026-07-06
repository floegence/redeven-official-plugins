const schemaVersion = 'redeven.capability.container_resources.v1';
const engines = ['docker', 'podman'];

const elements = {
  engine: document.querySelector('#engine'),
  search: document.querySelector('#search'),
  runningOnly: document.querySelector('#runningOnly'),
  refresh: document.querySelector('#refresh'),
  status: document.querySelector('#status'),
  containers: document.querySelector('#containers'),
  details: document.querySelector('#details'),
  engineSummary: document.querySelector('#engineSummary'),
  countSummary: document.querySelector('#countSummary'),
  pullForm: document.querySelector('#pullForm'),
  imageRef: document.querySelector('#imageRef'),
  rowTemplate: document.querySelector('#containerRowTemplate'),
};

const state = {
  bridgeReady: false,
  selectedEngine: normalizeEngine(elements.engine.value),
  selectedKey: '',
  rows: [],
  inspectByKey: new Map(),
  engineStatus: new Map(),
  pendingOperation: '',
  logTextByKey: new Map(),
};

const bridge = createBridgeClient(readBootstrap());

function readBootstrap() {
  const params = new URLSearchParams(window.location.search);
  const allowedParentOrigin = exactOrigin(params.get('parent_origin') || window.location.origin);
  return {
    pluginId: params.get('plugin_id') || 'com.redeven.official.containers',
    surfaceId: params.get('surface_id') || 'containers.activity',
    surfaceInstanceId: params.get('surface_instance_id') || '',
    activeFingerprint: params.get('active_fingerprint') || '',
    bridgeNonce: params.get('bridge_nonce') || '',
    allowedParentOrigin,
  };
}

function exactOrigin(raw) {
  const value = String(raw || '').trim();
  if (!value || value === '*') {
    throw new Error('Plugin parent origin must be exact.');
  }
  return new URL(value, window.location.href).origin;
}

function createBridgeClient(bootstrap) {
  let requestID = 0;
  const pending = new Map();

  window.addEventListener('message', (event) => {
    if (event.origin !== bootstrap.allowedParentOrigin) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'redevplugin.bridge.lifecycle') {
      if (data.event?.type === 'ready') {
        state.bridgeReady = true;
        void refreshEngine();
      }
      if (data.event?.type === 'dispose') {
        for (const waiter of pending.values()) {
          window.clearTimeout(waiter.timer);
          waiter.reject(new Error('Plugin bridge was disposed.'));
        }
        pending.clear();
      }
      return;
    }

    if (data.type !== 'redevplugin.bridge.response') return;
    const waiter = pending.get(data.id);
    if (!waiter) return;
    pending.delete(data.id);
    window.clearTimeout(waiter.timer);
    if (data.ok) {
      waiter.resolve(data.data);
      return;
    }
    waiter.reject(new Error(String(data.error || data.error_code || 'Plugin request failed')));
  });

  function handshake() {
    if (!bootstrap.surfaceInstanceId || !bootstrap.activeFingerprint || !bootstrap.bridgeNonce) {
      setStatus('Plugin bridge bootstrap is incomplete. Reopen this surface from Plugin Center.', 'error');
      return;
    }
    window.parent.postMessage({
      type: 'redevplugin.bridge.handshake',
      plugin_id: bootstrap.pluginId,
      surface_id: bootstrap.surfaceId,
      surface_instance_id: bootstrap.surfaceInstanceId,
      active_fingerprint: bootstrap.activeFingerprint,
      bridge_nonce: bootstrap.bridgeNonce,
      ui_protocol_version: 'plugin-ui-v1',
    }, bootstrap.allowedParentOrigin);
  }

  function call(method, params) {
    const id = `containers-${++requestID}`;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Plugin bridge call ${id} timed out.`));
      }, 45000);
      pending.set(id, { resolve, reject, timer });
      window.parent.postMessage({
        type: 'redevplugin.bridge.call',
        request: { id, method, params },
      }, bootstrap.allowedParentOrigin);
    });
  }

  return { call, handshake };
}

function setStatus(message, tone = 'neutral') {
  elements.status.textContent = message;
  elements.status.dataset.tone = tone;
}

function normalizeEngine(value) {
  const engine = String(value || '').trim().toLowerCase();
  return engines.includes(engine) ? engine : 'docker';
}

function requireResponseEngine(value) {
  const engine = String(value || '').trim().toLowerCase();
  if (engines.includes(engine)) return engine;
  throw new Error('Container response engine is missing or unsupported.');
}

function requireSelectedEngine(value, label) {
  const engine = requireResponseEngine(value);
  if (engine !== state.selectedEngine) {
    throw new Error(`${label} returned ${engineLabel(engine)} while ${engineLabel(state.selectedEngine)} is selected.`);
  }
  return engine;
}

function containerKey(row) {
  return `${row.engine}:${row.containerID}`;
}

function methodPayload(extra = {}) {
  return {
    schema_version: schemaVersion,
    engine: state.selectedEngine,
    ...extra,
  };
}

async function callMethod(method, params) {
  const result = await bridge.call(method, params);
  if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'data')) {
    return result.data;
  }
  return result;
}

async function refreshEngine() {
  elements.refresh.disabled = true;
  setStatus(`Loading ${state.selectedEngine} containers...`);
  try {
    const status = await callMethod('containers.status', methodPayload());
    const statusEngine = requireSelectedEngine(status?.engine, 'Container status');
    state.engineStatus.set(statusEngine, status);
    if (!status?.available) {
      state.rows = [];
      renderAll();
      setStatus(`${engineLabel(state.selectedEngine)} is unavailable. Choose another engine or start it locally.`, 'warning');
      return;
    }

    const list = await callMethod('containers.list', methodPayload({ all: true }));
    const listEngine = requireSelectedEngine(list?.engine, 'Container list');
    const rows = Array.isArray(list?.containers) ? list.containers.map((item) => normalizeContainer(listEngine, item)) : [];
    state.rows = rows;
    if (state.selectedKey && !rows.some((row) => containerKey(row) === state.selectedKey)) {
      state.selectedKey = '';
    }
    if (!state.selectedKey && rows.length > 0) {
      state.selectedKey = containerKey(rows[0]);
    }
    renderAll();
    setStatus(`${rows.length} ${state.selectedEngine} container${rows.length === 1 ? '' : 's'} loaded.`, 'success');
    if (state.selectedKey) {
      void inspectSelected();
    }
  } catch (error) {
    state.rows = [];
    renderAll();
    setStatus(errorMessage(error), 'error');
  } finally {
    elements.refresh.disabled = false;
  }
}

function normalizeContainer(engine, item) {
  const responseEngine = requireResponseEngine(engine);
  const containerID = String(item?.container_id || '').trim();
  if (!containerID) {
    throw new Error('Container response is missing container_id.');
  }
  const image = item?.image && typeof item.image === 'object' ? item.image : {};
  return {
    engine: responseEngine,
    containerID,
    name: String(item?.name || containerID || 'Unnamed'),
    imageRef: String(image.reference || item?.image || 'Unknown image'),
    imageDigest: String(image.digest || ''),
    digestPinned: Boolean(image.digest_pinned || image.digest),
    state: String(item?.state || 'unknown').toLowerCase(),
    createdAtUnixMs: Number(item?.created_at_unix_ms || 0),
    ports: Array.isArray(item?.ports) ? item.ports : [],
  };
}

function visibleRows() {
  const query = elements.search.value.trim().toLowerCase();
  return state.rows.filter((row) => {
    if (elements.runningOnly.checked && row.state !== 'running') return false;
    if (!query) return true;
    return [row.name, row.imageRef, row.imageDigest, row.state, row.containerID, row.engine]
      .some((field) => String(field || '').toLowerCase().includes(query));
  });
}

function renderAll() {
  renderSummary();
  renderRows();
  renderDetails();
}

function renderSummary() {
  const status = state.engineStatus.get(state.selectedEngine);
  const version = status?.engine_version ? ` ${status.engine_version}` : '';
  elements.engineSummary.textContent = `${engineLabel(state.selectedEngine)}${version}`;
  elements.countSummary.textContent = `${visibleRows().length} shown / ${state.rows.length} total`;
}

function renderRows() {
  elements.containers.replaceChildren();
  const rows = visibleRows();
  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = state.rows.length === 0 ? 'No containers were returned by this engine.' : 'No containers match the current filter.';
    elements.containers.append(empty);
    return;
  }

  for (const row of rows) {
    const node = elements.rowTemplate.content.firstElementChild.cloneNode(true);
    const key = containerKey(row);
    node.dataset.containerKey = key;
    node.dataset.selected = String(key === state.selectedKey);
    node.querySelector('.row-title').textContent = row.name;
    node.querySelector('.row-subtitle').textContent = `${shortID(row.containerID)} · ${row.imageRef} · ${portsLabel(row.ports)}`;
    const pill = node.querySelector('.state-pill');
    pill.textContent = row.state || 'unknown';
    pill.dataset.state = row.state;
    node.addEventListener('click', () => {
      state.selectedKey = key;
      renderAll();
      void inspectSelected();
    });
    elements.containers.append(node);
  }
}

function renderDetails() {
  const row = state.rows.find((candidate) => containerKey(candidate) === state.selectedKey);
  if (!row) {
    elements.details.className = 'details-empty';
    elements.details.textContent = 'Select a container to inspect it.';
    return;
  }

  const inspected = state.inspectByKey.get(state.selectedKey)?.container;
  const runtime = inspected?.runtime || {};
  const mounts = Array.isArray(inspected?.mounts) ? inspected.mounts : Array.isArray(runtime.mounts) ? runtime.mounts : [];
  const devices = Array.isArray(inspected?.devices) ? inspected.devices : Array.isArray(runtime.devices) ? runtime.devices : [];
  const logText = state.logTextByKey.get(state.selectedKey) || 'No logs requested yet.';

  elements.details.className = '';
  elements.details.replaceChildren(
    el('div', { className: 'details-header' }, [
      el('div', { className: 'details-title' }, [
        el('h2', {}, row.name),
        el('p', {}, `${engineLabel(row.engine)} · ${row.containerID}`),
      ]),
      el('div', { className: 'action-bar' }, actionButtons(row)),
    ]),
    el('div', { className: 'details-grid' }, [
      stat('State', row.state),
      stat('Image', imageLabel(row)),
      stat('Ports', portsLabel(row.ports)),
      stat('Privileged', runtime.privileged ? 'Yes' : 'No'),
      stat('Network', runtime.network_mode || '-'),
      stat('Restart', runtime.restart_policy || '-'),
    ]),
    section('Runtime', [
      chip(`Env ${runtime.env?.total ?? 0} (${runtime.env?.secret_like_count ?? 0} secret-like)`),
      chip(`Labels ${runtime.labels?.total ?? inspected?.labels?.total ?? 0}`),
      chip(`Mounts ${mounts.length}`),
      chip(`Devices ${devices.length}`),
      ...(runtime.cap_add || []).slice(0, 6).map((cap) => chip(`cap+ ${cap}`)),
    ]),
    section('Mounts', mounts.length > 0
      ? mounts.slice(0, 8).map((mount) => chip(`${mount.type || 'mount'} ${mount.target || ''}${mount.container_socket ? ' · socket' : ''}`))
      : [chip('No mounts reported')]),
    section('Logs', [
      el('button', { type: 'button', onClick: () => void loadLogs(row) }, 'Load tail'),
      el('div', { className: 'log-panel' }, logText),
    ]),
  );
}

function actionButtons(row) {
  const actions = [];
  if (row.state === 'running') {
    actions.push(actionButton('Stop', () => runContainerAction('containers.stop', row)));
    actions.push(actionButton('Restart', () => runContainerAction('containers.restart', row)));
  } else {
    actions.push(actionButton('Start', () => runContainerAction('containers.start', row)));
  }
  actions.push(actionButton('Remove', () => runContainerAction('containers.remove', row, { force: false }), 'danger'));
  return actions;
}

function actionButton(label, onClick, className = '') {
  return el('button', { type: 'button', className, onClick }, label);
}

async function inspectSelected() {
  const row = state.rows.find((candidate) => containerKey(candidate) === state.selectedKey);
  if (!row) return;
  const key = containerKey(row);
  try {
    const response = await callMethod('containers.inspect', {
      schema_version: schemaVersion,
      engine: row.engine,
      container_id: row.containerID,
    });
    state.inspectByKey.set(key, response);
    renderDetails();
  } catch (error) {
    setStatus(errorMessage(error), 'error');
  }
}

async function runContainerAction(method, row, extra = {}) {
  const label = method.replace('containers.', '');
  if (method === 'containers.remove' && !window.confirm(`Remove ${row.name} from ${engineLabel(row.engine)}?`)) {
    return;
  }
  state.pendingOperation = `${label} ${row.name}`;
  setStatus(`Starting ${state.pendingOperation}...`);
  try {
    const result = await callMethod(method, {
      schema_version: schemaVersion,
      engine: row.engine,
      container_id: row.containerID,
      ...extra,
    });
    const op = result?.operation_id ? ` Operation ${result.operation_id} started.` : '';
    setStatus(`${capitalize(label)} requested for ${row.name}.${op}`, 'success');
    window.setTimeout(() => void refreshEngine(), 900);
  } catch (error) {
    setStatus(errorMessage(error), 'error');
  } finally {
    state.pendingOperation = '';
  }
}

async function loadLogs(row) {
  const key = containerKey(row);
  state.logTextByKey.set(key, 'Requesting log stream...');
  renderDetails();
  try {
    const result = await bridge.call('containers.logs.tail', {
      schema_version: schemaVersion,
      engine: row.engine,
      container_id: row.containerID,
      tail_lines: 100,
      follow: false,
    });
    const streamID = result?.stream_id || result?.data?.stream_id;
    const streamTicket = result?.stream_ticket || result?.data?.stream_ticket;
    if (!streamID || !streamTicket) {
      state.logTextByKey.set(key, 'Log stream request completed without readable stream data.');
      return;
    }
    const events = await readStreamEvents(streamID, streamTicket);
    const logText = events
      .map(formatStreamEvent)
      .filter(Boolean)
      .join('\n');
    state.logTextByKey.set(key, logText || 'No log lines were returned.');
  } catch (error) {
    state.logTextByKey.set(key, errorMessage(error));
  }
  renderDetails();
}

async function readStreamEvents(streamID, streamTicket) {
  const url = `/_redeven_plugin/stream/${encodeURIComponent(streamID)}?ticket=${encodeURIComponent(streamTicket)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/x-ndjson, application/json' },
    credentials: 'same-origin',
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Log stream request failed with HTTP ${response.status}`);
  }
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function formatStreamEvent(event) {
  if (!event || typeof event !== 'object') return '';
  if (event.error) return String(event.error);
  const decoded = decodeBase64Text(event.data);
  if (!decoded) return '';
  try {
    const line = JSON.parse(decoded);
    const message = String(line.message || line.line || '').trim();
    const stream = String(line.stream || '').trim();
    const timestamp = String(line.timestamp || line.time || '').trim();
    return [timestamp, stream, message || decoded].filter(Boolean).join(' ');
  } catch {
    return decoded.trim();
  }
}

function decodeBase64Text(value) {
  const encoded = String(value || '').trim();
  if (!encoded) return '';
  const binary = window.atob(encoded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function pullImage(event) {
  event.preventDefault();
  const imageRef = elements.imageRef.value.trim();
  if (!imageRef) {
    setStatus('Enter an image reference before pulling.', 'warning');
    elements.imageRef.focus();
    return;
  }
  setStatus(`Starting image pull for ${imageRef} on ${state.selectedEngine}...`);
  try {
    const result = await callMethod('images.pull', methodPayload({ image_ref: imageRef }));
    const op = result?.operation_id ? ` Operation ${result.operation_id} started.` : '';
    setStatus(`Image pull requested for ${imageRef}.${op}`, 'success');
    elements.imageRef.value = '';
    window.setTimeout(() => void refreshEngine(), 1200);
  } catch (error) {
    setStatus(errorMessage(error), 'error');
  }
}

function stat(label, value) {
  return el('div', { className: 'stat' }, [
    el('div', { className: 'stat-label' }, label),
    el('div', { className: 'stat-value' }, String(value || '-')),
  ]);
}

function section(title, children) {
  return el('section', { className: 'detail-section' }, [
    el('h3', {}, title),
    el('div', { className: title === 'Logs' ? '' : 'chips' }, children),
  ]);
}

function chip(text) {
  return el('span', { className: 'chip' }, String(text || '-'));
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'className') {
      node.className = value;
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value !== undefined && value !== null) {
      node.setAttribute(key, String(value));
    }
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function imageLabel(row) {
  if (row.imageDigest) return `${row.imageRef}@${shortID(row.imageDigest)}`;
  return row.imageRef;
}

function portsLabel(ports) {
  if (!Array.isArray(ports) || ports.length === 0) return 'No ports';
  return ports.slice(0, 3).map((port) => {
    const host = port.host_port ? `${port.host_ip || '0.0.0.0'}:${port.host_port}->` : '';
    return `${host}${port.port}/${port.protocol || 'tcp'}`;
  }).join(', ');
}

function shortID(value) {
  const text = String(value || '').trim();
  if (text.length <= 16) return text || 'unknown';
  return text.slice(0, 12);
}

function engineLabel(engine) {
  return engine === 'podman' ? 'Podman' : 'Docker';
}

function capitalize(value) {
  const text = String(value || '');
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'Plugin request failed');
}

elements.engine.addEventListener('change', () => {
  state.selectedEngine = normalizeEngine(elements.engine.value);
  state.selectedKey = '';
  state.rows = [];
  renderAll();
  if (state.bridgeReady) {
    void refreshEngine();
  }
});
elements.search.addEventListener('input', renderAll);
elements.runningOnly.addEventListener('change', renderAll);
elements.refresh.addEventListener('click', () => void refreshEngine());
elements.pullForm.addEventListener('submit', pullImage);

renderAll();
setStatus('Waiting for plugin bridge handshake...');
try {
  bridge.handshake();
} catch (error) {
  setStatus(errorMessage(error), 'error');
}
