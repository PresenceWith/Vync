#!/usr/bin/env node
// generate-id.js — idCreator(5) compatible ID generator
// Usage: node generate-id.js [count]

const CHARS = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz';
const LENGTH = 5;

function generateId() {
  var id = '';
  for (var i = 0; i < LENGTH; i++) {
    id += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return id;
}

var count = parseInt(process.argv[2] || '1', 10);
for (var i = 0; i < count; i++) {
  console.log(generateId());
}
