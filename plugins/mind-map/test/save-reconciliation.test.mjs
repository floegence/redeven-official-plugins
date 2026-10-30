import {it} from 'node:test';
import assert from 'node:assert/strict';
import {reconcilePendingSave} from '../ui/src/save-reconciliation.ts';
it('recognizes exactly the persisted snapshot after a lost response',()=>{
  assert.equal(reconcilePendingSave({revision:4,workspace_dsl:'sent'}, {revision:5,workspace_dsl:'sent'}),'committed');
});
it('never treats an old read or different bytes as permission to replay',()=>{
  assert.equal(reconcilePendingSave({revision:4,workspace_dsl:'sent'}, {revision:4,workspace_dsl:'old'}),'unknown');
  assert.equal(reconcilePendingSave({revision:4,workspace_dsl:'sent'}, {revision:5,workspace_dsl:'other'}),'conflict');
  assert.equal(reconcilePendingSave({revision:4,workspace_dsl:'sent'}, {revision:6,workspace_dsl:'sent'}),'conflict');
});
