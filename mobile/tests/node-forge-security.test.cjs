const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),forge=require('node-forge');
test('RSA verification accepts valid signatures and rejects nested DigestAlgorithm garbage',()=>{
 const pair=crypto.generateKeyPairSync('rsa',{modulusLength:1024,publicExponent:65537});
 const key=forge.pki.publicKeyFromPem(pair.publicKey.export({type:'spki',format:'pem'}));
 const data=Buffer.from('Lumenless dependency regression test');const digest=crypto.createHash('sha256').update(data).digest();
 const signature=crypto.sign('sha256',data,pair.privateKey);assert.equal(key.verify(digest.toString('binary'),signature.toString('binary')),true);
 const a=forge.asn1,U=a.Class.UNIVERSAL,T=a.Type;
 for(const optionalNull of [true,false]){
  const algorithm=[a.create(U,T.OID,false,a.oidToDer(forge.pki.oids.sha256).getBytes())];if(optionalNull)algorithm.push(a.create(U,T.NULL,false,''));
  algorithm.push(a.create(U,T.OCTETSTRING,false,'garbage'));
  const info=a.create(U,T.SEQUENCE,true,[a.create(U,T.SEQUENCE,true,algorithm),a.create(U,T.OCTETSTRING,false,digest.toString('binary'))]);
  const malformed=crypto.privateEncrypt({key:pair.privateKey,padding:crypto.constants.RSA_PKCS1_PADDING},Buffer.from(a.toDer(info).getBytes(),'binary'));
  assert.throws(()=>key.verify(digest.toString('binary'),malformed.toString('binary')),/DigestInfo/);
 }
 const wrong=Buffer.from(digest);wrong[0]^=1;assert.equal(key.verify(wrong.toString('binary'),signature.toString('binary')),false);
});
