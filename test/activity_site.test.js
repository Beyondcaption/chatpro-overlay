const { test } = require('node:test');
const assert = require('node:assert');
const { classifySite } = require('../src/activity/site');

test('classifySite: Fan-Name im Titel bleibt draußen', () => {
  assert.equal(classifySite({ appName: 'Google Chrome', title: 'Chat with Jessica Miller - OnlyMonster', url: 'https://app.onlymonster.ai/chats/123' }), 'OnlyMonster');
});
test('classifySite: unbekannte Seite im Browser -> Browser: other', () => {
  assert.equal(classifySite({ appName: 'Microsoft Edge', title: 'Jessica Miller | Bank', url: 'https://bank.example' }), 'Browser: other');
});
test('classifySite: Desktop-App -> App-Name bereinigt', () => {
  assert.equal(classifySite({ appName: 'Discord', title: '#general - Server' }), 'Discord');
  assert.equal(classifySite({ appName: 'Spiel<>™', title: 'x' }), 'Spiel');
});
test('classifySite: Domains, www und Pfad-Unterscheidung', () => {
  const c = (url) => classifySite({ appName: 'Chrome', title: 't', url });
  assert.equal(c('https://www.youtube.com/watch?v=1'), 'YouTube');
  assert.equal(c('https://docs.google.com/document/d/1/edit'), 'Google Docs');
  assert.equal(c('https://docs.google.com/spreadsheets/d/1'), 'Google Sheets');
  assert.equal(c('https://x.com/home'), 'X');
  assert.equal(c('https://twitter.com/home'), 'X');
  assert.equal(c('https://onlyfans.com/my/chats'), 'OnlyFans');
  assert.equal(c('https://web.telegram.org/a/'), 'Telegram');
  assert.equal(c('https://notonlyfans.com/'), 'Browser: other');
});
test('classifySite: Titel-Stichwort als Fallback', () => {
  assert.equal(classifySite({ appName: 'Firefox', title: 'Inbox - OnlyMonster' }), 'OnlyMonster');
  assert.equal(classifySite({ appName: 'Firefox', title: 'Mein onlymonsterhelfer' }), 'Browser: other');
});
test('classifySite: bekannte Domain schlägt Titel, unbekannte Domain mit Titel-Treffer -> Titel', () => {
  assert.equal(classifySite({ appName: 'Chrome', title: 'Fansly', url: 'https://onlyfans.com/' }), 'OnlyFans');
  assert.equal(classifySite({ appName: 'Chrome', title: 'YouTube video', url: 'https://bank.example' }), 'YouTube');
});
test('classifySite: leere Eingabe, null url, unbekannte App', () => {
  assert.equal(classifySite({}), null);
  assert.equal(classifySite(), null);
  assert.equal(classifySite({ appName: '<>™', title: 'x' }), null);
  assert.equal(classifySite({ appName: 'Chrome', title: 'x', url: null }), 'Browser: other');
  assert.equal(classifySite({ appName: 'Notepad', title: 'geheim.txt' }), 'Notepad');
  assert.equal(classifySite({ appName: 'Chrome', title: 'x', url: 'kaputt' }), 'Browser: other');
});
test('classifySite: Ausgabe passt zum Backend-Muster, max 60', () => {
  const out = classifySite({ appName: 'A'.repeat(100) + '!?*', title: 'x' });
  assert.ok(out.length <= 40);
  assert.match(out, /^[\w .:\-]{1,60}$/);
  assert.match(classifySite({ appName: 'Chrome', title: 'x' }), /^[\w .:\-]{1,60}$/);
});
