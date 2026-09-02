use base64::Engine as _;
use redevplugin_worker_sdk::storage::kv;
use redevplugin_worker_sdk::{WorkerError, WorkerRequest, WorkerResult, export_worker};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

const STORE_ID: &str = "mind-map";
const STATE_KEY: &str = "workspace-v1.json";
const STATE_SCHEMA_VERSION: u32 = 1;
const MAX_DOCUMENTS: usize = 32;
const MAX_NODES: usize = 500;
const MAX_DOCUMENT_TITLE: usize = 80;
const MAX_NODE_TITLE: usize = 120;
const MAX_STORED_BYTES: usize = 3_670_016;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Workspace {
    schema_version: String,
    selected_document_id: String,
    documents: Vec<Document>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Document {
    schema_version: String,
    id: String,
    title: String,
    layout: String,
    nodes: Vec<Node>,
    updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Node {
    id: String,
    parent_id: Option<String>,
    order: usize,
    side: String,
    title: String,
    color: String,
    collapsed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredWorkspace {
    schema_version: u32,
    revision: u64,
    saved_at: Option<String>,
    workspace: Workspace,
}

impl Default for StoredWorkspace {
    fn default() -> Self {
        let document_id = "map-1".to_string();
        Self {
            schema_version: STATE_SCHEMA_VERSION,
            revision: 0,
            saved_at: None,
            workspace: Workspace {
                schema_version: "mind-map.workspace.v1".to_string(),
                selected_document_id: document_id.clone(),
                documents: vec![Document {
                    schema_version: "mind-map.document.v1".to_string(),
                    id: document_id.clone(),
                    title: "New Mind Map".to_string(),
                    layout: "bilateral".to_string(),
                    nodes: vec![Node {
                        id: format!("{document_id}:node-1"),
                        parent_id: None,
                        order: 0,
                        side: "right".to_string(),
                        title: "Central topic".to_string(),
                        color: "accent".to_string(),
                        collapsed: false,
                    }],
                    updated_at: "1970-01-01T00:00:00.000Z".to_string(),
                }],
            },
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EmptyRequest {}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct SaveRequest {
    expected_revision: u64,
    workspace: Workspace,
}

fn handle(request: WorkerRequest) -> WorkerResult {
    match request.method.as_str() {
        "mindmap.workspace.load" => {
            let _: EmptyRequest = decode(request.params)?;
            load_workspace()
        }
        "mindmap.workspace.save" => save_workspace(decode(request.params)?),
        _ => Err(WorkerError::invalid_request("unsupported Mind Map method")),
    }
}

fn load_workspace() -> WorkerResult {
    let stored = load_state()?;
    Ok(public_workspace(&stored))
}

fn save_workspace(request: SaveRequest) -> WorkerResult {
    let current = load_state()?;
    let next = save_against(&current, request)?;
    save_state(&next)?;
    Ok(json!({
        "revision": next.revision,
        "saved_at": next.saved_at.as_deref().unwrap_or_default(),
    }))
}

fn save_against(
    current: &StoredWorkspace,
    request: SaveRequest,
) -> Result<StoredWorkspace, WorkerError> {
    if request.expected_revision != current.revision {
        return Err(WorkerError::new(
            "MIND_MAP_CONFLICT",
            "the workspace changed after it was loaded",
        ));
    }
    validate_workspace(&request.workspace)?;
    let revision = current.revision.checked_add(1).ok_or_else(|| {
        WorkerError::new(
            "MIND_MAP_CAPACITY_EXCEEDED",
            "workspace revision is exhausted",
        )
    })?;
    Ok(StoredWorkspace {
        schema_version: STATE_SCHEMA_VERSION,
        revision,
        saved_at: request
            .workspace
            .documents
            .iter()
            .map(|document| document.updated_at.as_str())
            .max()
            .map(str::to_string),
        workspace: request.workspace,
    })
}

fn public_workspace(stored: &StoredWorkspace) -> Value {
    json!({
        "revision": stored.revision,
        "saved_at": stored.saved_at,
        "workspace": stored.workspace,
    })
}

fn load_state() -> Result<StoredWorkspace, WorkerError> {
    let response = match kv::get(kv::GetRequest {
        store_id: STORE_ID.to_string(),
        key: STATE_KEY.to_string(),
        max_bytes: Some(MAX_STORED_BYTES as u64),
    }) {
        Ok(response) => response,
        Err(error) if error.code == "NOT_FOUND" => return Ok(StoredWorkspace::default()),
        Err(error) => return Err(error),
    };
    let bytes = redevplugin_worker_sdk::decode_base64(&response.value_base64)?;
    if bytes.len() > MAX_STORED_BYTES {
        return Err(WorkerError::new(
            "MIND_MAP_CAPACITY_EXCEEDED",
            "stored workspace is too large",
        ));
    }
    let state: StoredWorkspace = serde_json::from_slice(&bytes)
        .map_err(|error| WorkerError::hostcall(format!("decode Mind Map workspace: {error}")))?;
    validate_stored(&state)?;
    Ok(state)
}

fn save_state(state: &StoredWorkspace) -> Result<(), WorkerError> {
    validate_stored(state)?;
    let bytes = serde_json::to_vec(state)
        .map_err(|error| WorkerError::hostcall(format!("encode Mind Map workspace: {error}")))?;
    if bytes.len() > MAX_STORED_BYTES {
        return Err(WorkerError::new(
            "MIND_MAP_CAPACITY_EXCEEDED",
            "workspace exceeds its storage limit",
        ));
    }
    kv::put(kv::PutRequest {
        store_id: STORE_ID.to_string(),
        key: STATE_KEY.to_string(),
        value_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    })?;
    Ok(())
}

fn validate_stored(state: &StoredWorkspace) -> Result<(), WorkerError> {
    if state.schema_version != STATE_SCHEMA_VERSION
        || state
            .saved_at
            .as_ref()
            .is_some_and(|value| value.len() > 64)
    {
        return Err(invalid("stored workspace envelope is invalid"));
    }
    validate_workspace(&state.workspace)
}

fn validate_workspace(workspace: &Workspace) -> Result<(), WorkerError> {
    if workspace.schema_version != "mind-map.workspace.v1"
        || workspace.documents.is_empty()
        || workspace.documents.len() > MAX_DOCUMENTS
        || !valid_id(&workspace.selected_document_id)
    {
        return Err(invalid("workspace is invalid"));
    }
    let mut document_ids = HashSet::new();
    for document in &workspace.documents {
        if !document_ids.insert(document.id.as_str()) {
            return Err(invalid("document id is duplicated"));
        }
        validate_document(document)?;
    }
    if !document_ids.contains(workspace.selected_document_id.as_str()) {
        return Err(invalid("selected document does not exist"));
    }
    Ok(())
}

fn validate_document(document: &Document) -> Result<(), WorkerError> {
    if document.schema_version != "mind-map.document.v1"
        || !valid_id(&document.id)
        || !valid_text(&document.title, MAX_DOCUMENT_TITLE)
        || !matches!(document.layout.as_str(), "bilateral" | "right")
        || document.updated_at.len() > 64
        || document.nodes.is_empty()
        || document.nodes.len() > MAX_NODES
    {
        return Err(invalid("document is invalid"));
    }
    let mut nodes = HashMap::<&str, &Node>::new();
    let mut roots = Vec::new();
    for node in &document.nodes {
        if !valid_id(&node.id)
            || nodes.insert(node.id.as_str(), node).is_some()
            || node.parent_id.as_ref().is_some_and(|id| !valid_id(id))
            || !matches!(node.side.as_str(), "left" | "right")
            || !valid_text(&node.title, MAX_NODE_TITLE)
            || !matches!(
                node.color.as_str(),
                "accent" | "blue" | "green" | "amber" | "rose" | "violet"
            )
        {
            return Err(invalid("node is invalid"));
        }
        if node.parent_id.is_none() {
            roots.push(node);
        }
    }
    if roots.len() != 1 || roots[0].order != 0 {
        return Err(invalid("document must contain exactly one root"));
    }
    for node in &document.nodes {
        let mut cursor = node;
        let mut visited = HashSet::new();
        while let Some(parent_id) = cursor.parent_id.as_deref() {
            if !visited.insert(cursor.id.as_str()) {
                return Err(invalid("document contains a cycle"));
            }
            cursor = nodes
                .get(parent_id)
                .copied()
                .ok_or_else(|| invalid("node parent does not exist"))?;
        }
    }
    for parent in &document.nodes {
        let mut children = document
            .nodes
            .iter()
            .filter(|node| node.parent_id.as_deref() == Some(parent.id.as_str()))
            .collect::<Vec<_>>();
        children.sort_by_key(|node| node.order);
        if children
            .iter()
            .enumerate()
            .any(|(index, node)| node.order != index)
        {
            return Err(invalid("sibling order is invalid"));
        }
        for child in children {
            let branch_side = if parent.parent_id.is_none() {
                child.side.as_str()
            } else {
                parent.side.as_str()
            };
            if child.side != branch_side {
                return Err(invalid("branch side is inconsistent"));
            }
        }
    }
    Ok(())
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
}

fn valid_text(value: &str, maximum: usize) -> bool {
    let count = value.chars().count();
    count > 0 && count <= maximum && value.trim() == value && !value.chars().any(char::is_control)
}

fn decode<T: for<'de> Deserialize<'de>>(value: Value) -> Result<T, WorkerError> {
    serde_json::from_value(value).map_err(|error| WorkerError::invalid_request(error.to_string()))
}

fn invalid(message: impl Into<String>) -> WorkerError {
    WorkerError::new("MIND_MAP_INVALID_WORKSPACE", message)
}

export_worker!(handle);

#[cfg(test)]
mod tests {
    use super::*;

    fn save_request(current: &StoredWorkspace) -> SaveRequest {
        SaveRequest {
            expected_revision: current.revision,
            workspace: current.workspace.clone(),
        }
    }

    #[test]
    fn default_workspace_is_valid() {
        let state = StoredWorkspace::default();
        validate_stored(&state).expect("default workspace");
        assert_eq!(state.workspace.documents.len(), 1);
        assert_eq!(state.workspace.documents[0].nodes.len(), 1);
    }

    #[test]
    fn save_advances_revision_and_rejects_stale_revision() {
        let current = StoredWorkspace::default();
        let next = save_against(&current, save_request(&current)).expect("save");
        assert_eq!(next.revision, 1);
        let error = save_against(&next, save_request(&current)).expect_err("stale save");
        assert_eq!(error.code, "MIND_MAP_CONFLICT");
    }

    #[test]
    fn missing_parent_and_cycles_are_rejected() {
        let mut workspace = StoredWorkspace::default().workspace;
        workspace.documents[0].nodes.push(Node {
            id: "node-2".to_string(),
            parent_id: Some("missing".to_string()),
            order: 0,
            side: "right".to_string(),
            title: "Missing parent".to_string(),
            color: "blue".to_string(),
            collapsed: false,
        });
        assert_eq!(
            validate_workspace(&workspace)
                .expect_err("missing parent")
                .code,
            "MIND_MAP_INVALID_WORKSPACE"
        );

        let root_id = workspace.documents[0].nodes[0].id.clone();
        workspace.documents[0].nodes[1].parent_id = Some(root_id.clone());
        workspace.documents[0].nodes[0].parent_id = Some("node-2".to_string());
        assert_eq!(
            validate_workspace(&workspace).expect_err("cycle").code,
            "MIND_MAP_INVALID_WORKSPACE"
        );
    }

    #[test]
    fn sibling_orders_must_be_contiguous() {
        let mut workspace = StoredWorkspace::default().workspace;
        let root = workspace.documents[0].nodes[0].id.clone();
        workspace.documents[0].nodes.push(Node {
            id: "node-2".to_string(),
            parent_id: Some(root),
            order: 3,
            side: "right".to_string(),
            title: "Gap".to_string(),
            color: "blue".to_string(),
            collapsed: false,
        });
        assert_eq!(
            validate_workspace(&workspace).expect_err("order gap").code,
            "MIND_MAP_INVALID_WORKSPACE"
        );
    }
}
