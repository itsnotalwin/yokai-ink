import fs from 'node:fs';

const file = process.argv[2] || 'src/render/render.js';
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
let depth = 0;
let inBlockComment = false;
for (let i = 0; i < lines.length; i++) {
  let code = lines[i];
  code = code.replace(/\/\/.*$/, '');
  code = code.replace(/\/\*.*?\*\//g, '');
  if (inBlockComment) { if (code.includes('*/')) { inBlockComment = false; code = code.slice(code.indexOf('*/') + 2); } else continue; }
  if (code.includes('/*')) { inBlockComment = true; code = code.slice(0, code.indexOf('/*')); }
  // strip strings/templates crudely
  code = code.replace(/`(?:[^`\\]|\\.)*`/g, '``');
  code = code.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  code = code.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  for (const ch of code) {
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) console.log(`depth 0 closes at line ${i + 1}: ${lines[i].trim().slice(0, 70)}`);
      if (depth < 0) console.log(`NEGATIVE at line ${i + 1}: ${lines[i].trim().slice(0, 70)}`);
    }
  }
}
console.log('final depth', depth);
