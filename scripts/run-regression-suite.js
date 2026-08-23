#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const testDir = path.join(root, 'test');
const allFiles = fs.readdirSync(testDir).filter(name => name.endsWith('.js')).sort();
const start = Math.max(0, Number.parseInt(process.argv[2] || '0', 10) || 0);
const count = Math.max(1, Number.parseInt(process.argv[3] || String(allFiles.length), 10) || allFiles.length);
const files = allFiles.slice(start, start + count);
let passed = 0;
const failures = [];

console.log(`TEST_BATCH start=${start} count=${files.length} suiteTotal=${allFiles.length}`);
for (const name of files) {
  const result = spawnSync(process.execPath, [path.join(testDir, name)], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status === 0) {
    passed += 1;
    console.log(`FILE_PASS ${name}`);
    continue;
  }
  failures.push(name);
  console.error(`FILE_FAIL ${name}`);
  if (result.stdout) console.error(result.stdout.trim());
  if (result.stderr) console.error(result.stderr.trim());
  if (result.error) console.error(result.error.stack || result.error.message);
}

console.log(`SUITE_SUMMARY passed=${passed} failed=${failures.length} total=${files.length}`);
if (failures.length) process.exit(1);
