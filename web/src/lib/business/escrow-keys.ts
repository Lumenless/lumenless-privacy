import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
function key() { const value=process.env.ESCROW_ENCRYPTION_KEY; if(!value || !/^[a-f0-9]{64}$/i.test(value)) throw new Error('Escrow encryption is not configured.'); return Buffer.from(value,'hex'); }
export function createEscrow(accountId: string) {
  const wallet=Keypair.generate();const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key(),iv);cipher.setAAD(Buffer.from(`lumenless:escrow:v1:${accountId}`));const data=Buffer.concat([cipher.update(bs58.encode(wallet.secretKey),'utf8'),cipher.final()]);
  return {address:wallet.publicKey.toBase58(),secret:'escrow:v1:'+Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url')};
}
export function openEscrow(accountId: string, secret: string, address: string) {
  try { if(!secret.startsWith('escrow:v1:'))throw Error();const raw=Buffer.from(secret.slice(10),'base64url');const decipher=createDecipheriv('aes-256-gcm',key(),raw.subarray(0,12));decipher.setAAD(Buffer.from(`lumenless:escrow:v1:${accountId}`));decipher.setAuthTag(raw.subarray(12,28));const wallet=Keypair.fromSecretKey(bs58.decode(Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString('utf8')));if(wallet.publicKey.toBase58()!==address)throw Error();return wallet; }
  catch { throw new Error('Could not unlock escrow wallet.'); }
}
