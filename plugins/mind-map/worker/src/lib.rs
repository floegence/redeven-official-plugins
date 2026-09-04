use base64::Engine as _;
use redevplugin_worker_sdk::storage::kv;
use redevplugin_worker_sdk::{WorkerError, WorkerRequest, WorkerResult, export_worker};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;

const STORE_ID: &str = "mind-map";
const STATE_KEY: &str = "workspace-v2.json";
const LEGACY_STATE_KEY: &str = "workspace-v1.json";
const STATE_SCHEMA_VERSION: u32 = 2;
const LEGACY_STATE_SCHEMA_VERSION: u32 = 1;
const MAX_DOCUMENTS: usize = 32;
const MAX_NODES: usize = 500;
const MAX_DOCUMENT_TITLE: usize = 80;
const MAX_NODE_CHARACTERS: usize = 512;
const MAX_NODE_NEWLINES: usize = 32;
const MAX_NODE_BYTES: usize = 2_048;
const MAX_LEGACY_NODE_TITLE: usize = 120;
const MAX_WORKSPACE_DSL_BYTES: usize = 3_000_000;
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
    workspace_dsl: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyStoredWorkspace {
    schema_version: u32,
    revision: u64,
    saved_at: Option<String>,
    workspace: Workspace,
}

impl Default for StoredWorkspace {
    fn default() -> Self {
        Self {
            schema_version: STATE_SCHEMA_VERSION,
            revision: 0,
            saved_at: None,
            workspace_dsl: serialize_workspace(&default_workspace()),
        }
    }
}

fn default_workspace() -> Workspace {
    let document_id = "map-1".to_string();
    Workspace {
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
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EmptyRequest {}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct SaveRequest {
    expected_revision: u64,
    workspace_dsl: String,
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
    let workspace = parse_workspace_dsl(&request.workspace_dsl)?;
    let workspace_dsl = serialize_workspace(&workspace);
    enforce_dsl_size(&workspace_dsl)?;
    let revision = current.revision.checked_add(1).ok_or_else(|| {
        WorkerError::new(
            "MIND_MAP_CAPACITY_EXCEEDED",
            "workspace revision is exhausted",
        )
    })?;
    let next = StoredWorkspace {
        schema_version: STATE_SCHEMA_VERSION,
        revision,
        saved_at: workspace
            .documents
            .iter()
            .map(|document| document.updated_at.as_str())
            .max()
            .map(str::to_string),
        workspace_dsl,
    };
    validate_stored(&next)?;
    Ok(next)
}

fn public_workspace(stored: &StoredWorkspace) -> Value {
    json!({
        "revision": stored.revision,
        "saved_at": stored.saved_at,
        "workspace_dsl": stored.workspace_dsl,
    })
}

fn load_state() -> Result<StoredWorkspace, WorkerError> {
    if let Some(bytes) = load_key(STATE_KEY)? {
        return decode_stored_state(&bytes);
    }
    let Some(bytes) = load_key(LEGACY_STATE_KEY)? else {
        return Ok(StoredWorkspace::default());
    };
    let migrated = migrate_legacy_state(&bytes)?;
    save_state(&migrated)?;
    Ok(migrated)
}

fn load_key(key: &str) -> Result<Option<Vec<u8>>, WorkerError> {
    let response = match kv::get(kv::GetRequest {
        store_id: STORE_ID.to_string(),
        key: key.to_string(),
        max_bytes: Some(MAX_STORED_BYTES as u64),
    }) {
        Ok(response) => response,
        Err(error) if error.code == "NOT_FOUND" => return Ok(None),
        Err(error) => return Err(error),
    };
    let bytes = redevplugin_worker_sdk::decode_base64(&response.value_base64)?;
    if bytes.len() > MAX_STORED_BYTES {
        return Err(WorkerError::new(
            "MIND_MAP_CAPACITY_EXCEEDED",
            "stored workspace is too large",
        ));
    }
    Ok(Some(bytes))
}

fn decode_stored_state(bytes: &[u8]) -> Result<StoredWorkspace, WorkerError> {
    let state: StoredWorkspace = serde_json::from_slice(bytes)
        .map_err(|error| WorkerError::hostcall(format!("decode Mind Map v2 workspace: {error}")))?;
    validate_stored(&state)?;
    Ok(state)
}

fn migrate_legacy_state(bytes: &[u8]) -> Result<StoredWorkspace, WorkerError> {
    let legacy: LegacyStoredWorkspace = serde_json::from_slice(bytes).map_err(|error| {
        WorkerError::hostcall(format!("decode legacy Mind Map workspace: {error}"))
    })?;
    validate_legacy_stored(&legacy)?;
    let migrated = StoredWorkspace {
        schema_version: STATE_SCHEMA_VERSION,
        revision: legacy.revision,
        saved_at: legacy.saved_at,
        workspace_dsl: serialize_workspace(&legacy.workspace),
    };
    validate_stored(&migrated)?;
    Ok(migrated)
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
    enforce_dsl_size(&state.workspace_dsl)?;
    let workspace = parse_workspace_dsl(&state.workspace_dsl)?;
    if serialize_workspace(&workspace) != state.workspace_dsl {
        return Err(invalid("stored workspace DSL is not canonical"));
    }
    Ok(())
}

fn validate_legacy_stored(state: &LegacyStoredWorkspace) -> Result<(), WorkerError> {
    if state.schema_version != LEGACY_STATE_SCHEMA_VERSION
        || state
            .saved_at
            .as_ref()
            .is_some_and(|value| value.len() > 64)
    {
        return Err(invalid("legacy stored workspace envelope is invalid"));
    }
    validate_workspace(&state.workspace, true)
}

fn parse_workspace_dsl(serialized: &str) -> Result<Workspace, WorkerError> {
    enforce_dsl_size(serialized)?;
    let normalized = serialized.replace("\r\n", "\n").replace('\r', "\n");
    if normalized.contains('\t') {
        return Err(invalid("tabs are not allowed in Mind Map DSL"));
    }
    let mut lines = normalized.split('\n').collect::<Vec<_>>();
    if lines.last() == Some(&"") {
        lines.pop();
    }
    for (index, line) in lines.iter().enumerate() {
        let leading = line.bytes().take_while(|byte| *byte == b' ').count();
        if leading % 2 != 0 {
            return Err(invalid(format!(
                "invalid indentation at line {}",
                index + 1
            )));
        }
    }
    let mut cursor = 0;
    expect_line(&lines, &mut cursor, "mind-map 1")?;
    expect_line(&lines, &mut cursor, "kind: workspace")?;
    let selected_document_id = parse_json_string_field(
        lines.get(cursor).copied(),
        "selected: ",
        "selected document id",
    )?;
    cursor += 1;
    expect_line(&lines, &mut cursor, "")?;
    let mut documents = Vec::new();
    while cursor < lines.len() {
        let map_line = lines[cursor];
        cursor += 1;
        let map_id = map_line
            .strip_prefix("map ")
            .ok_or_else(|| invalid(format!("expected map at line {cursor}")))?;
        let id = parse_json_string(map_id, "map id")?;
        let title = parse_json_string_field(lines.get(cursor).copied(), "  title: ", "map title")?;
        cursor += 1;
        let layout = match lines.get(cursor).copied() {
            Some("  layout: bilateral") => "bilateral".to_string(),
            Some("  layout: right") => "right".to_string(),
            _ => return Err(invalid(format!("invalid layout at line {}", cursor + 1))),
        };
        cursor += 1;
        let updated_at = parse_json_string_field(
            lines.get(cursor).copied(),
            "  updated-at: ",
            "map updated-at",
        )?;
        cursor += 1;
        let mut nodes = Vec::new();
        let mut node_ids = HashSet::new();
        parse_dsl_node(&lines, &mut cursor, 1, None, &mut nodes, &mut node_ids)?;
        documents.push(Document {
            schema_version: "mind-map.document.v1".to_string(),
            id,
            title,
            layout,
            nodes,
            updated_at,
        });
        if cursor == lines.len() {
            break;
        }
        expect_line(&lines, &mut cursor, "")?;
    }
    let workspace = Workspace {
        schema_version: "mind-map.workspace.v1".to_string(),
        selected_document_id,
        documents,
    };
    validate_workspace(&workspace, false)?;
    Ok(workspace)
}

fn parse_dsl_node(
    lines: &[&str],
    cursor: &mut usize,
    depth: usize,
    parent_id: Option<&str>,
    output: &mut Vec<Node>,
    ids: &mut HashSet<String>,
) -> Result<(), WorkerError> {
    let prefix = "  ".repeat(depth);
    let field_prefix = "  ".repeat(depth + 1);
    let content_prefix = "  ".repeat(depth + 2);
    let line = lines
        .get(*cursor)
        .copied()
        .ok_or_else(|| invalid("node is missing"))?;
    *cursor += 1;
    let id = parse_json_string(
        line.strip_prefix(&format!("{prefix}node "))
            .ok_or_else(|| invalid(format!("invalid node indentation at line {cursor}")))?,
        "node id",
    )?;
    if !ids.insert(id.clone()) {
        return Err(invalid(format!("duplicate node id {id}")));
    }
    let side = match lines.get(*cursor).copied() {
        Some(line) if line == format!("{field_prefix}side: left") => "left".to_string(),
        Some(line) if line == format!("{field_prefix}side: right") => "right".to_string(),
        _ => {
            return Err(invalid(format!(
                "invalid node side at line {}",
                *cursor + 1
            )));
        }
    };
    *cursor += 1;
    let color_prefix = format!("{field_prefix}color: ");
    let color = lines
        .get(*cursor)
        .and_then(|line| line.strip_prefix(&color_prefix))
        .filter(|value| {
            matches!(
                *value,
                "accent" | "blue" | "green" | "amber" | "rose" | "violet"
            )
        })
        .ok_or_else(|| invalid(format!("invalid node color at line {}", *cursor + 1)))?
        .to_string();
    *cursor += 1;
    let collapsed = match lines.get(*cursor).copied() {
        Some(line) if line == format!("{field_prefix}folded: true") => true,
        Some(line) if line == format!("{field_prefix}folded: false") => false,
        _ => {
            return Err(invalid(format!(
                "invalid folded value at line {}",
                *cursor + 1
            )));
        }
    };
    *cursor += 1;
    expect_line(lines, cursor, &format!("{field_prefix}text: |-"))?;
    let mut text_lines = Vec::new();
    while let Some(line) = lines.get(*cursor) {
        let Some(text) = line.strip_prefix(&content_prefix) else {
            break;
        };
        text_lines.push(text);
        *cursor += 1;
    }
    if text_lines.is_empty() {
        return Err(invalid(format!(
            "node text is missing at line {}",
            *cursor + 1
        )));
    }
    let order = output
        .iter()
        .filter(|node| node.parent_id.as_deref() == parent_id)
        .count();
    output.push(Node {
        id: id.clone(),
        parent_id: parent_id.map(str::to_string),
        order,
        side,
        title: text_lines.join("\n"),
        color,
        collapsed,
    });
    let child_prefix = format!("{field_prefix}node ");
    while lines
        .get(*cursor)
        .is_some_and(|line| line.starts_with(&child_prefix))
    {
        parse_dsl_node(lines, cursor, depth + 1, Some(&id), output, ids)?;
    }
    Ok(())
}

fn serialize_workspace(workspace: &Workspace) -> String {
    let mut output = String::new();
    writeln!(output, "mind-map 1").expect("write string");
    writeln!(output, "kind: workspace").expect("write string");
    writeln!(
        output,
        "selected: {}",
        serde_json::to_string(&workspace.selected_document_id).expect("serialize selected id")
    )
    .expect("write string");
    output.push('\n');
    for (index, document) in workspace.documents.iter().enumerate() {
        if index > 0 {
            output.push('\n');
        }
        serialize_map(&mut output, document);
    }
    output
}

fn serialize_map(output: &mut String, document: &Document) {
    writeln!(
        output,
        "map {}",
        serde_json::to_string(&document.id).expect("serialize map id")
    )
    .expect("write string");
    writeln!(
        output,
        "  title: {}",
        serde_json::to_string(&document.title).expect("serialize map title")
    )
    .expect("write string");
    writeln!(output, "  layout: {}", document.layout).expect("write string");
    writeln!(
        output,
        "  updated-at: {}",
        serde_json::to_string(&document.updated_at).expect("serialize updated-at")
    )
    .expect("write string");
    let root = document
        .nodes
        .iter()
        .find(|node| node.parent_id.is_none())
        .expect("validated document has one root");
    serialize_node(output, document, root, 1);
}

fn serialize_node(output: &mut String, document: &Document, node: &Node, depth: usize) {
    let prefix = "  ".repeat(depth);
    let field_prefix = "  ".repeat(depth + 1);
    let text_prefix = "  ".repeat(depth + 2);
    writeln!(
        output,
        "{prefix}node {}",
        serde_json::to_string(&node.id).expect("serialize node id")
    )
    .expect("write string");
    writeln!(output, "{field_prefix}side: {}", node.side).expect("write string");
    writeln!(output, "{field_prefix}color: {}", node.color).expect("write string");
    writeln!(output, "{field_prefix}folded: {}", node.collapsed).expect("write string");
    writeln!(output, "{field_prefix}text: |-").expect("write string");
    for line in node.title.split('\n') {
        writeln!(output, "{text_prefix}{line}").expect("write string");
    }
    let mut children = document
        .nodes
        .iter()
        .filter(|candidate| candidate.parent_id.as_deref() == Some(node.id.as_str()))
        .collect::<Vec<_>>();
    children.sort_by_key(|candidate| candidate.order);
    for child in children {
        serialize_node(output, document, child, depth + 1);
    }
}

fn validate_workspace(workspace: &Workspace, legacy: bool) -> Result<(), WorkerError> {
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
        validate_document(document, legacy)?;
    }
    if !document_ids.contains(workspace.selected_document_id.as_str()) {
        return Err(invalid("selected document does not exist"));
    }
    Ok(())
}

fn validate_document(document: &Document, legacy: bool) -> Result<(), WorkerError> {
    if document.schema_version != "mind-map.document.v1"
        || !valid_id(&document.id)
        || !valid_single_line_text(&document.title, MAX_DOCUMENT_TITLE)
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
        let valid_title = if legacy {
            valid_legacy_text(&node.title)
        } else {
            valid_node_text(&node.title)
        };
        if !valid_id(&node.id)
            || nodes.insert(node.id.as_str(), node).is_some()
            || node.parent_id.as_ref().is_some_and(|id| !valid_id(id))
            || !matches!(node.side.as_str(), "left" | "right")
            || !valid_title
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

fn valid_single_line_text(value: &str, maximum: usize) -> bool {
    let count = value.chars().count();
    count > 0 && count <= maximum && value.trim() == value && !value.chars().any(char::is_control)
}

fn valid_legacy_text(value: &str) -> bool {
    valid_single_line_text(value, MAX_LEGACY_NODE_TITLE)
}

fn valid_node_text(value: &str) -> bool {
    !value.trim().is_empty()
        && value.chars().count() <= MAX_NODE_CHARACTERS
        && value.matches('\n').count() <= MAX_NODE_NEWLINES
        && value.len() <= MAX_NODE_BYTES
        && !value
            .chars()
            .any(|character| character != '\n' && character.is_control())
}

fn enforce_dsl_size(value: &str) -> Result<(), WorkerError> {
    if value.len() > MAX_WORKSPACE_DSL_BYTES {
        return Err(WorkerError::new(
            "MIND_MAP_CAPACITY_EXCEEDED",
            "workspace DSL exceeds its storage limit",
        ));
    }
    Ok(())
}

fn parse_json_string_field(
    line: Option<&str>,
    prefix: &str,
    label: &str,
) -> Result<String, WorkerError> {
    let source = line
        .and_then(|line| line.strip_prefix(prefix))
        .ok_or_else(|| invalid(format!("expected {}", prefix.trim())))?;
    parse_json_string(source, label)
}

fn parse_json_string(source: &str, label: &str) -> Result<String, WorkerError> {
    serde_json::from_str(source).map_err(|_| invalid(format!("{label} must be a JSON string")))
}

fn expect_line(lines: &[&str], cursor: &mut usize, expected: &str) -> Result<(), WorkerError> {
    if lines.get(*cursor).copied() != Some(expected) {
        return Err(invalid(format!(
            "expected {expected:?} at line {}",
            *cursor + 1
        )));
    }
    *cursor += 1;
    Ok(())
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
            workspace_dsl: current.workspace_dsl.clone(),
        }
    }

    #[test]
    fn default_workspace_is_canonical_and_valid() {
        let state = StoredWorkspace::default();
        validate_stored(&state).expect("default workspace");
        let workspace = parse_workspace_dsl(&state.workspace_dsl).expect("parse default workspace");
        assert_eq!(workspace.documents.len(), 1);
        assert_eq!(workspace.documents[0].nodes.len(), 1);
        assert_eq!(serialize_workspace(&workspace), state.workspace_dsl);
    }

    #[test]
    fn multiline_workspace_round_trips_without_losing_spaces() {
        let mut workspace = default_workspace();
        workspace.documents[0].nodes[0].title = "Root\n\n  details".to_string();
        let serialized = serialize_workspace(&workspace);
        let parsed = parse_workspace_dsl(&serialized).expect("parse workspace");
        assert_eq!(parsed, workspace);
        assert_eq!(serialize_workspace(&parsed), serialized);
    }

    #[test]
    fn save_canonicalizes_dsl_and_rejects_stale_revision() {
        let current = StoredWorkspace::default();
        let noncanonical = current.workspace_dsl.replace('\n', "\r\n");
        let next = save_against(
            &current,
            SaveRequest {
                expected_revision: 0,
                workspace_dsl: noncanonical,
            },
        )
        .expect("save");
        assert_eq!(next.revision, 1);
        assert!(next.workspace_dsl.ends_with('\n'));
        let error = save_against(&next, save_request(&current)).expect_err("stale save");
        assert_eq!(error.code, "MIND_MAP_CONFLICT");
    }

    #[test]
    fn legacy_state_migrates_once_with_records_and_revision_preserved() {
        let mut workspace = default_workspace();
        workspace.documents[0].nodes.push(Node {
            id: "map-1:node-2".to_string(),
            parent_id: Some("map-1:node-1".to_string()),
            order: 0,
            side: "right".to_string(),
            title: "Preserved child".to_string(),
            color: "blue".to_string(),
            collapsed: true,
        });
        let legacy = LegacyStoredWorkspace {
            schema_version: 1,
            revision: 7,
            saved_at: Some("2026-09-04T12:00:00.000Z".to_string()),
            workspace: workspace.clone(),
        };
        let migrated = migrate_legacy_state(&serde_json::to_vec(&legacy).expect("legacy JSON"))
            .expect("migrate legacy state");
        assert_eq!(migrated.revision, 7);
        assert_eq!(migrated.saved_at, legacy.saved_at);
        assert_eq!(
            parse_workspace_dsl(&migrated.workspace_dsl).expect("migrated DSL"),
            workspace
        );
    }

    #[test]
    fn schema_drift_and_future_state_are_rejected() {
        let mut future = StoredWorkspace::default();
        future.schema_version = 3;
        assert_eq!(
            validate_stored(&future).expect_err("future state").code,
            "MIND_MAP_INVALID_WORKSPACE"
        );

        let mut noncanonical = StoredWorkspace::default();
        noncanonical.workspace_dsl = noncanonical.workspace_dsl.trim_end().to_string();
        assert_eq!(
            validate_stored(&noncanonical)
                .expect_err("noncanonical state")
                .code,
            "MIND_MAP_INVALID_WORKSPACE"
        );

        let mut legacy = LegacyStoredWorkspace {
            schema_version: 1,
            revision: 0,
            saved_at: None,
            workspace: default_workspace(),
        };
        legacy.workspace.documents[0].nodes[0].title = "legacy\nnewline".to_string();
        assert_eq!(
            migrate_legacy_state(&serde_json::to_vec(&legacy).expect("legacy JSON"))
                .expect_err("legacy drift")
                .code,
            "MIND_MAP_INVALID_WORKSPACE"
        );
    }

    #[test]
    fn missing_parent_cycles_and_order_gaps_are_rejected() {
        let mut workspace = default_workspace();
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
            validate_workspace(&workspace, false)
                .expect_err("missing parent")
                .code,
            "MIND_MAP_INVALID_WORKSPACE"
        );

        let root_id = workspace.documents[0].nodes[0].id.clone();
        workspace.documents[0].nodes[1].parent_id = Some(root_id.clone());
        workspace.documents[0].nodes[0].parent_id = Some("node-2".to_string());
        assert_eq!(
            validate_workspace(&workspace, false)
                .expect_err("cycle")
                .code,
            "MIND_MAP_INVALID_WORKSPACE"
        );

        workspace = default_workspace();
        workspace.documents[0].nodes.push(Node {
            id: "node-2".to_string(),
            parent_id: Some(root_id),
            order: 3,
            side: "right".to_string(),
            title: "Gap".to_string(),
            color: "blue".to_string(),
            collapsed: false,
        });
        assert_eq!(
            validate_workspace(&workspace, false)
                .expect_err("order gap")
                .code,
            "MIND_MAP_INVALID_WORKSPACE"
        );
    }
}
