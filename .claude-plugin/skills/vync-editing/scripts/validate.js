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

  if (typeof data.version !== 'number')
    errors.push('missing or invalid "version" field');
  if (!data.viewport || typeof data.viewport !== 'object') {
    errors.push('missing "viewport" object');
  } else {
    if (typeof data.viewport.zoom !== 'number')
      errors.push('viewport.zoom must be a number');
    if (typeof data.viewport.x !== 'number')
      errors.push('viewport.x must be a number');
    if (typeof data.viewport.y !== 'number')
      errors.push('viewport.y must be a number');
  }
  // Valid shape names (must match Plait enum values — camelCase)
  const validShapes = new Set([
    // BasicShapes
    'rectangle',
    'ellipse',
    'diamond',
    'roundRectangle',
    'parallelogram',
    'text',
    'triangle',
    'leftArrow',
    'rightArrow',
    'trapezoid',
    'cross',
    'cloud',
    'star',
    'pentagon',
    'hexagon',
    'octagon',
    'pentagonArrow',
    'processArrow',
    'twoWayArrow',
    'comment',
    'roundComment',
    // FlowchartSymbols
    'process',
    'decision',
    'data',
    'connector',
    'terminal',
    'manualInput',
    'preparation',
    'manualLoop',
    'merge',
    'delay',
    'storedData',
    'or',
    'summingJunction',
    'predefinedProcess',
    'offPage',
    'document',
    'multiDocument',
    'database',
    'hardDisk',
    'internalStorage',
    'noteCurlyRight',
    'noteCurlyLeft',
    'noteSquare',
    'display',
  ]);

  if (!Array.isArray(data.elements)) {
    errors.push('"elements" must be an array');
  } else {
    // Check element IDs, shapes, and collect for duplicate detection
    const ids = new Set();
    function collectIds(elements, prefix) {
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        const loc = prefix ? `${prefix}.children[${i}]` : `elements[${i}]`;
        if (!el.id || typeof el.id !== 'string') {
          errors.push(`${loc}: missing or invalid "id"`);
        } else {
          if (ids.has(el.id)) errors.push(`duplicate id: "${el.id}"`);
          ids.add(el.id);
        }
        if (el.type === 'geometry' && el.shape && !validShapes.has(el.shape)) {
          errors.push(
            `${loc}: invalid shape "${el.shape}" (must be camelCase, e.g. "multiDocument" not "multi-document")`
          );
        }
        if (Array.isArray(el.children)) collectIds(el.children, loc);
      }
    }
    collectIds(data.elements, '');
  }

  if (errors.length > 0) {
    console.error(`[vync-validate] ${filePath}: ${errors.length} error(s)`);
    errors.forEach(function (e) {
      console.error('  - ' + e);
    });
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
