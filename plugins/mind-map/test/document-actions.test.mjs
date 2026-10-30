import {it} from 'node:test';
import assert from 'node:assert/strict';
import {prepareDocumentEdit} from '../ui/src/document-actions.ts';
import {createWorkspace,createHistory,undoHistory,selectedDocument} from '../ui/src/workspace-model.ts';
it('applies an Agent batch as one user-undoable transaction',()=>{
  const workspace=createWorkspace(1),history=createHistory(workspace),document=selectedDocument(workspace);
  const result=prepareDocumentEdit(workspace,4,{document_id:document.id,expected_revision:4,operations:[{type:'rename_node',node_id:document.nodes[0].id,title:'Agent title'},{type:'add_child',node_id:document.nodes[0].id,title:'Child'}]});
  assert.equal(result.status,'applied');history.commit(result.workspace);
  assert.equal(selectedDocument(result.workspace).nodes.length,2);
  assert.deepEqual(undoHistory(history,result.workspace),workspace);
});
it('rejects stale revisions, wrong documents and invalid batches without mutation',()=>{
  const workspace=createWorkspace(1),before=JSON.stringify(workspace),document=selectedDocument(workspace);
  assert.equal(prepareDocumentEdit(workspace,2,{document_id:document.id,expected_revision:1,operations:[]}).status,'conflict');
  assert.equal(prepareDocumentEdit(workspace,2,{document_id:'different',expected_revision:2,operations:[]}).status,'wrong_document');
  const result=prepareDocumentEdit(workspace,2,{document_id:document.id,expected_revision:2,operations:[{type:'rename_node',node_id:document.nodes[0].id,title:'First'},{type:'rename_node',node_id:'missing',title:'Second'}]});
  assert.equal(result.status,'invalid');assert.equal(JSON.stringify(workspace),before);
});
