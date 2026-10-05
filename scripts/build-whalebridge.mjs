import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'vendor/whalebridge');
// The embedded component and the desktop always ship the same brand asset.
copyFileSync(join(root,'assets/whale-head.png'),join(source,'internal/whalebridge/assets/whale-head.png'));
const pin = JSON.parse(readFileSync(join(source, 'upstream.json'), 'utf8'));
const out = join(root, '.tmp/whalebridge-package');
mkdirSync(out, { recursive: true });
const asset = 'WhaleBridge-win32-x64.exe';
execFileSync(process.env.WHALEBRIDGE_GO || 'go', ['build', '-mod=readonly', '-trimpath', '-ldflags', `-s -w -X main.version=${pin.version}`, '-o', join(out, asset), '.'], {
 cwd:source, stdio:'inherit', env:{...process.env,GOOS:'windows',GOARCH:'amd64',CGO_ENABLED:'0'},
});
const binary = readFileSync(join(out, asset));
const manifest = {id:'whalebridge',name:'鲸桥',version:pin.version,description:'将 API 供应商和订阅账号接入鲸屿，统一管理模型、请求路由与用量。',upstream:pin.commit,license:readFileSync(join(source,'LICENSE'),'utf8'),platforms:{'win32-x64':{asset,size:binary.length,sha256:createHash('sha256').update(binary).digest('hex')}}};
writeFileSync(join(out,'WhaleBridge-component.json'),`${JSON.stringify(manifest,null,2)}\n`);
console.log(`鲸桥 ${pin.version}: ${binary.length} bytes`);
