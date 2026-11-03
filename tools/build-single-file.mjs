/**
 * build-single-file.mjs — bundle the ES modules into one standalone HTML file.
 *
 * The game is written as ordinary ES modules so the source stays readable, but
 * `file://` pages cannot load module scripts. This linker walks the import graph
 * from src/main.js, emits each module as a closure that receives its imports
 * from a registry and returns its exports, then inlines everything (plus the
 * stylesheet and the page shell) into yokai-ink.html — a single file you can
 * double-click.
 *
 * Run: node tools/build-single-file.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const ENTRY = path.join(root, 'src/main.js');
const OUT = path.join(root, 'yokai-ink.html');

const IMPORT_RE = /^[ \t]*import\s*\{([^}]*)\}\s*from\s*'([^']+)';?[ \t]*$/gm;
const EXPORT_LIST_RE = /^[ \t]*export\s*\{([^}]*)\};?[ \t]*$/gm;
const EXPORT_DECL_RE = /^([ \t]*)export\s+(const|let|var|function|class|async\s+function)\s+([A-Za-z_$][\w$]*)/gm;
const DECL_RE = /^[ \t]*(?:const|let|var|function|class|async function)\s+([A-Za-z_$][\w$]*)/gm;

function readModule(file) {
  const src = fs.readFileSync(file, 'utf8');
  const deps = [];
  const imports = [];   // { local, from }

  let code = src.replace(IMPORT_RE, (_m, names, spec) => {
    const depFile = path.resolve(path.dirname(file), spec);
    deps.push(depFile);
    for (const piece of names.split(',')) {
      const name = piece.trim().split(/\s+as\s+/).pop().trim();
      if (name) imports.push({ local: name, from: depFile });
    }
    return '';
  });

  // Reject any import form this linker does not understand, instead of
  // silently dropping code.
  const leftover = /^[ \t]*import\b.*$/m.exec(code);
  if (leftover) throw new Error(`${path.relative(root, file)}: unsupported import: ${leftover[0].trim()}`);

  const reexports = [];
  code = code.replace(EXPORT_LIST_RE, (_m, names) => {
    for (const piece of names.split(',')) {
      const parts = piece.trim().split(/\s+as\s+/);
      if (parts[0]) reexports.push({ exported: (parts[1] || parts[0]).trim(), local: parts[0].trim() });
    }
    return '';
  });

  const declared = [];
  code = code.replace(EXPORT_DECL_RE, (_m, indent, kind, name) => {
    declared.push(name);
    return `${indent}${kind.replace(/\s+function$/, '')} ${name}`;
  });

  const exports = [];
  for (const name of declared) exports.push({ exported: name, local: name });
  for (const r of reexports) exports.push(r);

  return { file, code, deps, imports, exports };
}

function link(entry) {
  const modules = new Map();
  const order = [];
  const visiting = new Set();

  (function visit(file) {
    if (modules.has(file)) return;
    if (visiting.has(file)) throw new Error(`circular import at ${path.relative(root, file)}`);
    visiting.add(file);
    const mod = readModule(file);
    modules.set(file, mod);
    for (const dep of mod.deps) visit(dep);
    visiting.delete(file);
    order.push(mod);
  })(entry);

  return order;
}

function emit(modules) {
  const key = (f) => JSON.stringify(path.relative(root, f).split(path.sep).join('/'));
  const chunks = [];

  for (const mod of modules) {
    const byFile = new Map();
    for (const imp of mod.imports) {
      if (!byFile.has(imp.from)) byFile.set(imp.from, new Set());
      byFile.get(imp.from).add(imp.local);
    }
    const head = [];
    for (const [from, names] of byFile) {
      head.push(`  const { ${[...names].join(', ')} } = __mod[${key(from)}];`);
    }
    const tail = mod.exports.length
      ? `  return { ${mod.exports.map((e) => (e.exported === e.local ? e.local : `${e.exported}: ${e.local}`)).join(', ')} };`
      : '  return {};';

    chunks.push([
      `// ---- ${path.relative(root, mod.file).split(path.sep).join('/')} ----`,
      `__mod[${key(mod.file)}] = (function () {`,
      ...head,
      mod.code.replace(/\s+$/, ''),
      tail,
      '})();',
      '',
    ].join('\n'));
  }

  return `(function () {\n'use strict';\nconst __mod = Object.create(null);\n\n${chunks.join('\n')}})();`;
}

/**
 * Rewrite the real page instead of keeping a second copy of it, so the hint
 * line, the aria label and the markup can never drift out of sync with
 * index.html. Two substitutions: the stylesheet link becomes an inline
 * <style>, and the module script becomes the inlined bundle.
 */
function page(bundle, css) {
  const shell = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const withCss = shell.replace(
    /[ \t]*<link rel="stylesheet" href="css\/style\.css">\n/,
    `<style>\n${css.trim()}\n</style>\n`,
  );
  const withJs = withCss.replace(
    /[ \t]*<script type="module" src="src\/main\.js"><\/script>/,
    `<script>\n// A boot failure would otherwise leave a blank sheet of paper with no clue why.\nwindow.addEventListener('error', function (e) {\n  document.title = 'Yokai Ink — error: ' + (e.message || 'unknown');\n});\n${bundle}\n</script>`,
  );
  if (withJs === withCss || withCss === shell) {
    throw new Error('index.html no longer matches the bundler expectations');
  }
  return withJs;
}
const modules = link(ENTRY);
const bundle = emit(modules);
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
const html = page(bundle, css);
fs.writeFileSync(OUT, html, 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log(`linked ${modules.length} modules -> ${path.relative(root, OUT)} (${kb} KB)`);
console.log(modules.map((m) => `  ${path.relative(root, m.file).split(path.sep).join('/')}  (${m.exports.length} exports)`).join('\n'));
void pathToFileURL;
