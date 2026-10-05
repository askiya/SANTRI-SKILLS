'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { parseGithubRepo } = require('../src/repo');
const { extractTarGz } = require('../src/targz');

test('repo URL accepts only exact GitHub HTTPS owner/repo', () => {
 assert.deepEqual(parseGithubRepo('https://github.com/acme/useful-skills'), { owner:'acme', repo:'useful-skills' });
 assert.deepEqual(parseGithubRepo('https://github.com/acme/useful-skills.git'), { owner:'acme', repo:'useful-skills' });
 for (const bad of ['http://github.com/a/b','https://evil.test/a/b','https://github.com/a/b/issues','https://user@github.com/a/b','https://github.com/a/../b','git@github.com:a/b.git']) assert.throws(()=>parseGithubRepo(bad));
});

function tarEntry(name, data, type='0') {
 const h=Buffer.alloc(512);h.write(name,0,100);h.write('0000777\0',100);h.write('0000000\0',108);h.write('0000000\0',116);h.write(data.length.toString(8).padStart(11,'0')+'\0',124);h[156]=type.charCodeAt(0);h.write('ustar\0',257);return Buffer.concat([h,data,Buffer.alloc((512-data.length%512)%512)]);
}
test('archive extraction rejects traversal, links, and expanded-size excess', () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'santri-tar-'));
 assert.throws(()=>extractTarGz(zlib.gzipSync(Buffer.concat([tarEntry('../escape',Buffer.from('x')),Buffer.alloc(1024)])),dir));
 assert.throws(()=>extractTarGz(zlib.gzipSync(Buffer.concat([tarEntry('/root/evil',Buffer.from('x')),Buffer.alloc(1024)])),dir,{strip:1}));
 assert.throws(()=>extractTarGz(zlib.gzipSync(Buffer.concat([tarEntry('link',Buffer.alloc(0),'2'),Buffer.alloc(1024)])),dir));
 assert.throws(()=>extractTarGz(zlib.gzipSync(Buffer.concat([tarEntry('big',Buffer.alloc(20)),Buffer.alloc(1024)])),dir,{maxBytes:10}));
 fs.rmSync(dir,{recursive:true,force:true});
});
