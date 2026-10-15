const test=require('node:test'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),path=require('node:path');
const scopes=process.env.DEPENDENCY_SCOPE?[process.env.DEPENDENCY_SCOPE]:['web'];
for(const scope of scopes){
 const requireScope=createRequire(path.resolve(__dirname,'../../',scope,'package.json'));
 test(`${scope}: bigint conversions preserve endian order, input bytes and full u64/u128/u256 values`,()=>{
  const lib=requireScope('bigint-buffer');
  for(const width of [1,8,16,32,128,129,256])for(const value of [0n,1n,255n,(1n<<BigInt(width*8))-1n]){
   const be=lib.toBufferBE(value,width),le=lib.toBufferLE(value,width);assert.equal(be.length,width);assert.equal(lib.toBigIntBE(be),value);assert.equal(lib.toBigIntLE(le),value);assert.deepEqual(le,Buffer.from(be).reverse());
   const before=Buffer.from(le);lib.toBigIntLE(le);assert.deepEqual(le,before);
  }
  assert.equal(lib.toBigIntLE(Buffer.alloc(10000,255)),(1n<<80000n)-1n);
  assert.equal(lib.toBigIntBE(Buffer.alloc(0)),0n);assert.deepEqual(lib.toBufferLE(0n,0),Buffer.alloc(0));
  for(const [number,width] of [[-1n,8],[256n,1],[1n,0],[1n,-1],[1n,Infinity]])assert.throws(()=>lib.toBufferBE(number,width),RangeError);
 });
 test(`${scope}: Solana token layouts preserve amounts without native bigint bindings`,()=>{
  const {u64,u128}=requireScope('@solana/buffer-layout-utils');
  for(const [layout,value] of [[u64(),(1n<<64n)-1n],[u128(),(1n<<128n)-1n]]){const buffer=Buffer.alloc(layout.span);layout.encode(value,buffer,0);assert.equal(layout.decode(buffer),value);assert.ok(buffer.every(v=>v===255));}
 });
 test(`${scope}: braces handles ordinary globs and rejects hostile patterns and ASTs`,()=>{
  const braces=requireScope('braces');assert.deepEqual(braces.expand('src/{app,lib}/*.{ts,tsx}'),['src/app/*.ts','src/app/*.tsx','src/lib/*.ts','src/lib/*.tsx']);assert.deepEqual(braces.expand('{1..3}'),['1','2','3']);
  const malicious='{'.repeat(4000)+'x'+ '}'.repeat(4000);
  for(const method of ['parse','compile','expand','stringify'])assert.throws(()=>braces[method](malicious),error=>error instanceof SyntaxError&&/nesting/.test(error.message));
  const root={type:'root',nodes:[]};root.nodes.push(root);for(const method of ['compile','expand','stringify'])assert.throws(()=>braces[method](root),/cyclic/);
 });
 test(`${scope}: TOML accepts Anchor config and rejects prototype pollution and deep recursion`,()=>{
  const toml=requireScope('toml');const config=toml.parse('[provider]\ncluster = "localnet"\nwallet = "test.json"');assert.equal(config.provider.cluster,'localnet');
  assert.throws(()=>toml.parse('[a.b]\ny = 1\n[a.b.y.__proto__.__proto__]\npolluted = "yes"'));assert.equal({}.polluted,undefined);
  assert.throws(()=>toml.parse('x = '+ '['.repeat(10000)+'0'+']'.repeat(10000)));
 });
 test(`${scope}: Metro-compatible image-size default reads PNG bytes using the patched parser`,()=>{
  const image=requireScope('image-size');assert.equal(image.__esModule,true);assert.equal(typeof image.default,'function');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZkAAAAASUVORK5CYII=','base64');assert.equal(image.default(png).width,1);assert.equal(image.default(png).height,1);
 });
}
