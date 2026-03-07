#!/usr/bin/env node
// validate.js — Zero-dependency .vync file validator
// Usage: node validate.js <file.vync>
// Exit 0 = valid, Exit 1 = invalid (errors on stderr)

const fs = require('node:fs');
const path = require('node:path');

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node validate.js <file.vync>');
  process.exit(1);
}

try {
  const content = fs.readFileSync(path.resolve(filePath), 'utf-8');
  const data = JSON.parse(content);

  const errors = [];

  if (typeof data.version !== 'number') errors.push('missing or invalid "version" field');
  if (!data.viewport || typeof data.viewport !== 'object') {
    errors.push('missing "viewport" object');
  } else {
    if (typeof data.viewport.zoom !== 'number') errors.push('viewport.zoom must be a number');
    if (typeof data.viewport.x !== 'number') errors.push('viewport.x must be a number');
    if (typeof data.viewport.y !== 'number') errors.push('viewport.y must be a number');
  }
  if (!Array.isArray(data.elements)) {
    errors.push('"elements" must be an array');
  } else {
    // Check element IDs and collect for duplicate detection
    const ids = new Set();
    function collectIds(elements) {
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        if (!el.id || typeof el.id !== 'string') {
          errors.push(`elements[${i}]: missing or invalid "id"`);
        } else {
          if (ids.has(el.id)) errors.push(`duplicate id: "${el.id}"`);
          ids.add(el.id);
        }
        if (Array.isArray(el.children)) collectIds(el.children);
      }
    }
    collectIds(data.elements);
  }

  if (errors.length > 0) {
    console.error(`[vync-validate] ${filePath}: ${errors.length} error(s)`);
    errors.forEach(function(e) { console.error('  - ' + e); });
    process.exit(1);
  }

  console.log(`[vync-validate] ${filePath}: OK`);
  process.exit(0);
} catch (err) {
  if (err instanceof SyntaxError) {
    console.error(`[vync-validate] ${filePath}: Invalid JSON — ${err.message}`);
  } else {
    console.error(`[vync-validate] ${filePath}: ${err.message}`);
  }
  process.exit(1);
}
