import { pathToFileURL } from 'node:url';

const [storeModuleUrl, authModuleUrl, home, deviceId, secret, workerIdx, iterationsRaw] = process.argv.slice(2);
const iterations = Number(iterationsRaw) || 20;

const [{ RelayDeviceCredentialStore }, { computeRelayDeviceAuthProof }] = await Promise.all([
  import(storeModuleUrl.startsWith('file:') ? storeModuleUrl : pathToFileURL(storeModuleUrl).href),
  import(authModuleUrl.startsWith('file:') ? authModuleUrl : pathToFileURL(authModuleUrl).href),
]);

const store = new RelayDeviceCredentialStore(home);
for (let i = 0; i < iterations; i += 1) {
  const challenge = `contender-${workerIdx}-${i}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const proofFields = {
    serverId: 'srv_contender',
    daemonPublicKeyB64: 'daemon_pub_contender',
    clientPublicKeyB64: `client_pub_${workerIdx}`,
    deviceId,
    challenge,
  };
  const proof = computeRelayDeviceAuthProof(secret, proofFields);
  store.verifyDeviceProof({ ...proofFields, proof });
}
process.stdout.write(JSON.stringify({ workerIdx, iterations }) + '\n');
