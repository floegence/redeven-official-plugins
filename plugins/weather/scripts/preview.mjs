import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const server = await createServer({
  configFile: fileURLToPath(new URL('vite.config.ts',root)),
  resolve: { alias: [{ find:'@floegence/redevplugin-ui/plugin',replacement:fileURLToPath(new URL('test/fixtures/bridge.ts',root)) }] },
  server:{host:'127.0.0.1',port:4178,strictPort:true},
});
await server.listen();
console.log('Weather native application preview: http://127.0.0.1:4178/?fixture=full&auto=1');
console.log('Synthetic responses only. Use the released ReDevPlugin dev command for platform integration.');
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,async()=>{await server.close();process.exit(0);});
