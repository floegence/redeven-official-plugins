const requestSchemaVersion = 'redeven.capability.container_resources.v1';
const statusEl = document.querySelector('#status');
const tableBody = document.querySelector('#containers');
const refreshButton = document.querySelector('#refresh');

let requestID = 0;
const pending = new Map();

function setStatus(message, tone = 'neutral') {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}

function sendBridgeCall(method, params) {
  const id = `containers-${++requestID}`;
  const parent = window.parent;
  if (!parent || parent === window) {
    return Promise.reject(new Error('Plugin bridge parent is unavailable.'));
  }
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    parent.postMessage({
      type: 'redevplugin.bridge.call',
      request: { id, method, params },
    }, '*');
    window.setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error('Container request timed out.'));
    }, 30000);
  });
}

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'redevplugin.bridge.lifecycle' && data.event?.type === 'ready') {
    void refreshContainers();
    return;
  }
  if (data.type !== 'redevplugin.bridge.response') return;
  const waiter = pending.get(data.id);
  if (!waiter) return;
  pending.delete(data.id);
  if (data.ok) {
    waiter.resolve(data.data);
    return;
  }
  waiter.reject(new Error(String(data.error || data.error_code || 'Plugin request failed')));
});

function containerRows(payload) {
  const containers = Array.isArray(payload?.containers) ? payload.containers : [];
  const engine = String(payload?.engine || 'docker');
  return containers.map((item) => ({
    name: String(item?.name || item?.names?.[0] || item?.id || 'Unnamed'),
    image: String(item?.image || item?.image_name || 'Unknown'),
    state: String(item?.state || item?.status || 'Unknown'),
    engine,
  }));
}

function renderRows(rows) {
  tableBody.replaceChildren();
  if (rows.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.className = 'empty';
    cell.textContent = 'No containers were returned by the selected engine.';
    row.append(cell);
    tableBody.append(row);
    return;
  }
  for (const item of rows) {
    const row = document.createElement('tr');
    for (const value of [item.name, item.image, item.state, item.engine]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    tableBody.append(row);
  }
}

async function refreshContainers() {
  refreshButton.disabled = true;
  setStatus('Loading containers...');
  try {
    const result = await sendBridgeCall('containers.list', {
      schema_version: requestSchemaVersion,
      engine: 'docker',
      all: true,
    });
    const rows = containerRows(result);
    renderRows(rows);
    setStatus(`${rows.length} container${rows.length === 1 ? '' : 's'} loaded.`, 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'error');
    renderRows([]);
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener('click', () => {
  void refreshContainers();
});

setStatus('Waiting for plugin bridge handshake...');
