import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = new URL('../', import.meta.url);
const output = process.env.WEATHER_BROWSER_EVIDENCE_DIR;
if (!output) throw new Error('Set WEATHER_BROWSER_EVIDENCE_DIR to the screenshot directory');
await mkdir(output, {recursive:true});
const server = await createServer({ configFile:fileURLToPath(new URL('vite.config.ts', root)), root:fileURLToPath(new URL('ui', root)),
 resolve:{alias:[{find:'@floegence/redevplugin-ui/plugin',replacement:fileURLToPath(new URL('test/fixtures/bridge.ts',root))}]},
 server:{host:'127.0.0.1',port:0},logLevel:'error' });
let browser;
const findings=[];
try {
 await server.listen();
 browser=await chromium.launch({headless:true});
 for (const sky of ['cloudy','sunny','night','rain','snow','fog','storm']) {
  for (const width of (sky==='cloudy' ? [390,430,768,1280] : [390,1280])) {
   for (const theme of (sky==='cloudy' ? ['light','dark'] : ['dark'])) {
    const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
    const errors=[];page.on('pageerror',err=>errors.push(err.message));
    await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/?fixture=full&auto=1&sky='+sky);
    await page.waitForFunction(()=>window.__weatherTest?.pending().length===0 && document.querySelector('.forecast-list li'));
    await page.evaluate(theme=>window.__weatherTest.context('en-US',theme),theme);
    await page.waitForFunction(()=>!document.querySelector('.weather-toolbar button:last-child')?.disabled);
    await page.locator('.current-temperature').click();
    const name='weather-'+sky+'-'+width+'-'+theme;
    await page.screenshot({path:resolve(output,name+'.png')});
    const geometry=await page.evaluate(()=>{
     const content=document.querySelector('.weather-content');
     const sidebar=document.querySelector('.city-sidebar');
     return {days:document.querySelectorAll('.forecast-list>li').length,hours:document.querySelectorAll('.hourly-list>li').length,metrics:document.querySelectorAll('.metric').length,scrollHeight:content.scrollHeight,width:content.clientWidth,overflow:document.documentElement.scrollWidth>innerWidth,background:getComputedStyle(document.querySelector('main')).backgroundImage,sidebarBackground:getComputedStyle(sidebar).backgroundImage};
    });
    // Capture the complete internally scrolled application at its native width.
    await page.setViewportSize({width,height:Math.min(3000,geometry.scrollHeight+1)});
    await page.screenshot({path:resolve(output,name+'-complete.png')});
    findings.push({name,...geometry,errors});
    await page.close();
   }
  }
 }
 await writeFile(resolve(output,'visual-evidence.json'),JSON.stringify({data:'synthetic, ten forecast days and 240 hourly samples; application-level evidence only',findings},null,2)+'\n');
 if(findings.some(item=>item.errors.length||item.overflow||item.days!==10||item.hours!==24||item.metrics!==8)) throw new Error('Visual evidence failed completeness checks');
 console.log('Captured '+findings.length+' weather/viewport/theme scenarios with complete data.');
} finally {await browser?.close();await server.close();}
