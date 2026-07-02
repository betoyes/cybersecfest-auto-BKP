// Armazenamento local — lê/escreve arquivos no clone do repo
'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const { atomicWriteFileSync } = require('./atomic-write.js');

const REPO_ROOT = path.resolve(__dirname, '../..');
const REPO      = process.env.GITHUB_REPO || 'betoyes/cybersecfest-auto';

function abs(relPath) {
  return path.join(REPO_ROOT, relPath);
}

function fileSha(content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
  return crypto.createHash('sha1').update(buf).digest('hex');
}

async function getFile(relPath) {
  const p = abs(relPath);
  if (!fs.existsSync(p)) return null;
  const content = fs.readFileSync(p, 'utf8');
  return { content, sha: fileSha(content) };
}

async function putFile(relPath, content, message) {
  const p = abs(relPath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  atomicWriteFileSync(p, content, 'utf8');
  console.log(`💾 local: ${relPath}`);
  return { sha: fileSha(content), message };
}

async function putBinary(relPath, buffer, message) {
  const p = abs(relPath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  atomicWriteFileSync(p, buffer);
  console.log(`💾 local: ${relPath} (${buffer.length} bytes)`);
  return { sha: fileSha(buffer), message };
}

function ensureDir(relPath) {
  fs.mkdirSync(abs(relPath), { recursive: true });
}

async function getJSON(relPath) {
  const f = await getFile(relPath);
  if (!f) return null;
  return { data: JSON.parse(f.content), sha: f.sha };
}

async function putJSON(relPath, data, message, sha = null) {
  return putFile(relPath, JSON.stringify(data, null, 2) + '\n', message);
}

async function getCommits() { return []; }

async function createRepo() {
  throw new Error('createRepo indisponível em LOCAL_MODE');
}

async function repoExists() { return true; }

async function listTree() {
  const files = [];
  function walk(dir, prefix = '') {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel  = prefix ? `${prefix}/${name}` : name;
      if (fs.statSync(full).isDirectory()) walk(full, rel);
      else files.push({ path: rel, type: 'blob' });
    }
  }
  walk(REPO_ROOT);
  return files;
}

module.exports = {
  getFile, putFile, putBinary, getJSON, putJSON, ensureDir,
  getCommits, createRepo, repoExists, listTree,
  REPO, REPO_ROOT, isLocal: true
};
