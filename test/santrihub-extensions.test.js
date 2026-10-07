'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=path.join(__dirname,'..','src');

test('Extensions navigation opens working installation guide without promising automatic installation',()=>{
  const html=fs.readFileSync(path.join(src,'dashboard.html'),'utf8');
  const ui=fs.readFileSync(path.join(src,'dashboard-ui.js'),'utf8');
  assert.match(html,/data-page="extensions"/);
  assert.match(html,/id="page-extensions"/);
  assert.match(html,/chrome:\/\/extensions/);
  assert.match(html,/Load unpacked/);
  assert.match(html,/Dilarang membagikan/);
  assert.match(ui,/extensions:'Extensions'/);
  assert.match(ui,/dataset\.page===page/);
  assert.doesNotMatch(html,/Terpasang di Gemini/);
});
