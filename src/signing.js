// src/signing.js
import nacl from 'tweetnacl';

// Carga de llaves desde .env (base64) o genera y muestra por consola
export function getCheckinKeys() {
  const sk_b64 = process.env.CHECKIN_SECRET_KEY || '';
  const pk_b64 = process.env.CHECKIN_PUBLIC_KEY || '';
  if (sk_b64 && pk_b64) {
    return {
      secretKey: Buffer.from(sk_b64, 'base64'),
      publicKey: Buffer.from(pk_b64, 'base64'),
    };
  }
  const kp = nacl.sign.keyPair();
  console.log('========== CLAVES PARA CHECK-IN ==========');
  console.log('Agrega a tu .env estas variables (una vez):');
  console.log('CHECKIN_PUBLIC_KEY=' + Buffer.from(kp.publicKey).toString('base64'));
  console.log('CHECKIN_SECRET_KEY=' + Buffer.from(kp.secretKey).toString('base64'));
  console.log('==========================================');
  return { secretKey: kp.secretKey, publicKey: kp.publicKey };
}

// Firma un objeto JSON y entrega payload y firma en base64
export function signPayload(obj) {
  const { secretKey, publicKey } = getCheckinKeys();
  const payloadBuf = Buffer.from(JSON.stringify(obj));
  const sig = nacl.sign.detached(payloadBuf, secretKey);
  return {
    token: `V1.${payloadBuf.toString('base64')}.${Buffer.from(sig).toString('base64')}`,
    publicKeyB64: Buffer.from(publicKey).toString('base64'),
  };
}
