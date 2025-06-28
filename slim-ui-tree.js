// slim-ui-tree.js
// Usage:  node slim-ui-tree.js in.json out.json
// Keeps only id, type (t), label (l), frame (f) & children (c).

const fs   = require('fs');
const path = require('path');

if (process.argv.length < 4) {
  console.error('Usage: node slim-ui-tree.js <input.json> <output.json>');
  process.exit(1);
}

const [ , , inFile, outFile ] = process.argv;

/**
 * Recursively strips an AX-style node down to essentials.
 *  – Renames keys to 1-letter shorthands.
 *  – Omits heavy / redundant fields.
 */
function slim(node) {
  if (node == null || typeof node !== 'object') return node;

  // Extract label from raw field (pattern: label: 'text')
  const labelMatch = node.raw?.match(/label: '([^']+)'/);
  const extractedLabel = labelMatch ? labelMatch[1] : undefined;

  const slimmed = {
    t  : node.type,
    l  : extractedLabel || node.label || undefined,
  };

  // recurse if children present
  if (Array.isArray(node.children) && node.children.length) {
    slimmed.c = node.children.map(slim);
  }

  // drop undefined keys to save bytes
  Object.keys(slimmed).forEach(k => slimmed[k] === undefined && delete slimmed[k]);
  return slimmed;
}

try {
  const raw = JSON.parse(fs.readFileSync(inFile, 'utf8'));
  const slimmed = slim(raw.rootElement || raw);
  fs.writeFileSync(outFile, JSON.stringify(slimmed));
  const inKB  = fs.statSync(inFile).size  / 1024;
  const outKB = fs.statSync(outFile).size / 1024;
  console.log(`✓ Wrote ${path.basename(outFile)} (${outKB.toFixed(1)} KB, ` +
              `${(100 * outKB / inKB).toFixed(1)} % of original)`);
} catch (e) {
  console.error('⚠️  ' + e.message);
  process.exit(1);
}
