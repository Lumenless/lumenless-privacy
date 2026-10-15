'use strict';
// Walk only child nodes: upstream AST parent/prev pointers intentionally form cycles.
module.exports = input => {
  if (!input || typeof input !== 'object') throw new TypeError('Expected a brace AST');
  const pending = [[input, 0]], seen = new Set();
  let count = 0;
  while (pending.length) {
    const [node, depth] = pending.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) throw new SyntaxError('Invalid or cyclic brace AST');
    if (depth > 128 || ++count > 100000) throw new SyntaxError('Brace AST exceeds safe nesting or size limit');
    seen.add(node);
    if (node.nodes) {
      if (!Array.isArray(node.nodes) || node.nodes.length > 100000) throw new SyntaxError('Invalid brace AST children');
      for (const child of node.nodes) pending.push([child, depth + 1]);
    }
  }
};
