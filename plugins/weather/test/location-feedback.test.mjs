import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

let server, browser, base;
before(async () => {
  server = await createServer({ configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    resolve: { alias: [{ find: '@floegence/redevplugin-ui/plugin', replacement: fileURLToPath(new URL('./fixtures/bridge.ts', import.meta.url)) }] },
    server: { host:'127.0.0.1', port:0 }, logLevel:'error',
  });
  await server.listen();
  base = 'http://127.0.0.1:' + server.httpServer.address().port;
  browser = await chromium.launch({ headless:true });
});
after(async () => { await browser?.close(); await server?.close(); });
const pending = (page) => page.evaluate(() => window.__weatherTest.pending());
test('cold weather restoration starts in the host theme without a guessed sky', async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.addInitScript(() => {
    window.__startupFrames = [];
    const record = () => {
      const app = document.querySelector('.weather-app');
      if (app) window.__startupFrames.push({ dark: document.documentElement.classList.contains('dark'), sky: app.classList.contains('sky-neutral'), background: getComputedStyle(app).backgroundImage });
      if (window.__startupFrames.length < 120) requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
  });
  await page.goto(base + '/?theme=dark&hold-state=1&fixture=full&sky=night');
  await page.locator('.loading-state').waitFor();
  await page.waitForFunction(() => window.__startupFrames.length >= 3);
  const frames = await page.evaluate(() => window.__startupFrames);
  assert.ok(frames.every(frame => frame.dark), 'every rendered app frame uses the supplied host theme');
  assert.ok(frames.every(frame => !frame.sky && frame.background === 'none'), 'startup does not invent a weather gradient');
  assert.equal(await page.locator('.weather-sky').count(), 0);
  await settle(page);
  await page.locator('.forecast-dashboard').waitFor();
  assert.equal(await page.locator('.weather-app.sky-clear-night').count(), 1);
  const dashboard = await page.locator('.forecast-dashboard').elementHandle();
  await settle(page, { fail: true });
  assert.equal(await dashboard.evaluate(el => el.isConnected), true, 'refresh failure retains restored content');
});
async function settle(page, options = {}) { await page.waitForFunction(() => window.__weatherTest.pending().length > 0); await page.evaluate((options) => window.__weatherTest.settle(options), options); }
async function ready(t, { initial=true, locale='en-US', width=1280, height=900, fixture='sparse', sky='cloudy' } = {}) {
  const page = await browser.newPage({ viewport:{width,height} });
  const errors=[]; page.on('pageerror', (error) => errors.push(error.message));
  t.after(async () => { await page.close(); assert.deepEqual(errors, [], 'no application errors'); });
  await page.goto(base + '/?initial=' + initial + '&locale=' + locale + '&fixture=' + fixture + '&sky=' + sky);
  if (initial) { await settle(page); await page.locator('.weather-toolbar button:last-child:not([disabled])').waitFor(); await page.waitForFunction(() => window.__weatherTest.pending().length === 0); }
  else await page.locator('#weather-query').waitFor();
  return page;
}
async function capture(page, options) {
  await page.waitForFunction(() => [...document.querySelectorAll('[role=dialog]')].every(el => el.getAttribute('data-floating-presence') === 'open' && Number(getComputedStyle(el).opacity) === 1));
  await page.screenshot({ ...options, animations:'disabled' });
}
async function chooser(page) { await page.getByRole('button',{name:'Choose location',exact:true}).click(); const dialog=page.getByRole('dialog'); await dialog.waitFor(); await page.waitForFunction(() => [...document.querySelectorAll('[role=dialog]')].every(el => el.getAttribute('data-floating-presence') === 'open' && Number(getComputedStyle(el).opacity) === 1)); return dialog; }
async function city(scope, id) { await scope.locator('[data-location-id="preset:' + id + '"]').first().click(); }
async function place(page,name) { await page.waitForFunction((name) => document.querySelector('[data-testid="place-name"]')?.textContent === name,name); }

for (const width of [390,430,768,1280]) for (const theme of ['light','dark']) {
 test(width+'px '+theme+' first city entry stays concise and keeps search reachable',async(t)=>{
  const page=await ready(t,{initial:false,width,height:520});
  await page.evaluate(theme=>window.__weatherTest.context('en-US',theme),theme);
  const card=page.locator('.onboarding');
  assert.equal(await card.locator('h1').textContent(),'Choose location');
  assert.equal(await card.locator(':scope > p, .picker-intro').count(),0);
  const bounds=await card.boundingBox();
  assert.ok(bounds.width<=520 && bounds.x>=0 && bounds.x+bounds.width<=width);
  assert.ok(bounds.y>=0 && bounds.y+bounds.height<=520);
  const input=card.locator('#weather-query');const before=await input.boundingBox();
  assert.ok(before.width>=180 && before.height>=44);
  const list=card.locator('.picker-scroll');
  assert.equal(await list.evaluate(el=>el.scrollHeight>el.clientHeight),true);
  await list.evaluate(el=>el.scrollTop=el.scrollHeight);
  assert.deepEqual(await input.boundingBox(),before);
  assert.equal(await page.locator('.weather-content').evaluate(el=>el.scrollHeight<=el.clientHeight),true);
  await list.evaluate(el=>el.scrollTop=0);
  const evidence=process.env.WEATHER_BROWSER_EVIDENCE_DIR;
  if(evidence) await capture(page,{path:evidence+'/weather-first-city-'+width+'-'+theme+'.png'});
  await city(card,'tokyo');await settle(page);await place(page,'Tokyo');
  assert.equal(await card.count(),0);
 });
}

for (const initial of [false,true]) test((initial?'dialog':'first city')+' search waits for input method composition to finish',async(t)=>{
 const page=await ready(t,{initial,locale:'zh-CN',width:390});
 if(initial) await page.locator('.weather-toolbar button').first().click();
 const input=page.locator('#weather-query');await input.fill('北京');
 await input.dispatchEvent('compositionstart',{data:'北京'});
 await input.press('Enter');
 assert.equal(await page.locator('.search-submit').getAttribute('aria-busy'),'false');
 await input.evaluate(el=>el.form.requestSubmit());
 assert.equal(await page.locator('.search-submit').getAttribute('aria-busy'),'false');
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal((await pending(page)).length,0);
 await input.dispatchEvent('compositionend',{data:'北京'});
 await input.press('Enter');await page.waitForFunction(()=>window.__weatherTest.pending().length===1);
 assert.deepEqual((await pending(page))[0].input,{query:'北京',language:'zh'});
 await settle(page);await page.getByRole('button',{name:/东京/}).first().waitFor();
});

async function settledDialogBounds(dialog) {
 return dialog.evaluate(async element => {
  await new Promise(resolve => requestAnimationFrame(resolve));
  // Floe may start another resize animation after the current one finishes.
  // Await the current animation batch, then verify actual geometry across frames.
  await Promise.allSettled(element.getAnimations().map(animation => animation.finished));
  let previous, stableFrames=0;
  const deadline=performance.now()+10000;
  while(performance.now()<deadline){
   await new Promise(resolve => requestAnimationFrame(resolve));
   const rect=element.getBoundingClientRect();
   const bounds={x:rect.x,y:rect.y,width:rect.width,height:rect.height};
   const visible=element.getAttribute('data-floating-presence')==='open'&&Number(getComputedStyle(element).opacity)===1;
   stableFrames=visible&&previous&&Object.keys(bounds).every(key=>Math.abs(bounds[key]-previous[key])<0.1)?stableFrames+1:0;
   if(stableFrames>=3)return bounds;
   previous=bounds;
  }
  throw new Error('Dialog layout did not settle within 10 seconds');
 });
}

test('cached switches paint immediately while only the latest queued city commits', async (t) => {
  const page=await ready(t,{fixture:'full'});
  await page.locator('[data-city-id="preset:tokyo"]').click();
  await page.waitForFunction(()=>window.__weatherTest.pending().length===1);
  assert.equal(await page.getByTestId('place-name').textContent(),'Tokyo');
  await page.locator('[data-city-id="preset:beijing"]').click();
  assert.equal(await page.getByTestId('place-name').textContent(),'Beijing');
  assert.equal((await pending(page)).length,1);
  await settle(page);
  await page.waitForFunction(()=>window.__weatherTest.pending()[0]?.input.id==='preset:beijing');
  assert.equal(await page.getByTestId('place-name').textContent(),'Beijing');
  await settle(page);
  assert.equal(await page.getByTestId('place-name').textContent(),'Beijing');
  assert.equal((await pending(page)).length,0);
});

test('failed city requests keep prior content, permit retry, and restore focus on Escape',async(t)=>{
  const page=await ready(t);const dialog=await chooser(page);await city(dialog,'singapore');await settle(page,{fail:true});
  await dialog.locator('.chooser-status.error').waitFor();assert.equal(await page.getByTestId('place-name').textContent(),'Beijing');
  await city(dialog,'singapore');await settle(page);await place(page,'Singapore');
  await chooser(page);await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  assert.equal(await page.getByRole('button',{name:'Choose location',exact:true}).evaluate(el=>document.activeElement===el),true);
});

test('native input retains its node, composition value and selection during context changes',async(t)=>{
  const page=await ready(t,{initial:false,locale:'zh-CN'});const input=page.locator('#weather-query');await input.fill('北京天气');
  await input.evaluate(el=>{window.__input=el;el.focus();el.setSelectionRange(1,3);el.dispatchEvent(new CompositionEvent('compositionstart',{data:'北京'}));});
  await page.evaluate(()=>window.__weatherTest.context('zh-TW','dark'));
  assert.equal(await input.evaluate(el=>el===window.__input && document.activeElement===el),true);
  assert.equal(await input.inputValue(),'北京天气');
  assert.deepEqual(await input.evaluate(el=>[el.selectionStart,el.selectionEnd]),[1,3]);
  await input.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{data:'北京天气'})));
  await input.press('Enter');await page.waitForFunction(()=>window.__weatherTest.pending().length===1);
  assert.deepEqual((await pending(page))[0].input,{query:'北京天气',language:'zh'});await settle(page);
  await page.getByRole('button',{name:/東京/}).first().waitFor();
});

test('cached refresh failure remains explicit and metric details use native Canvas',async(t)=>{
  const page=await ready(t);await page.getByRole('button',{name:'Refresh',exact:true}).click();await settle(page,{source:'saved'});
  await page.locator('.weather-alert').waitFor();assert.match(await page.locator('.weather-alert').textContent(),/saved weather/);
  await page.locator('[data-metric=humidity]').click();const dialog=page.getByRole('dialog');await dialog.waitFor();
  assert.equal(await page.getByTestId('detail-value').textContent(),'70%');
  await dialog.getByRole('button',{name:/Sun 6/}).click();assert.equal(await page.getByTestId('detail-value').textContent(),'60–60%');
  assert.equal(await dialog.locator('canvas').evaluate(el=>el.width>0 && el.getContext('2d')!==null),true);
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
});

test('selecting an active or pending sidebar city never duplicates a forecast',async(t)=>{
  const page=await ready(t);await page.locator('[data-city-id="preset:beijing"]').click();assert.equal((await pending(page)).length,0);
  await page.locator('[data-city-id="preset:tokyo"]').click();await page.locator('[data-city-id="preset:tokyo"]').click();
  await page.waitForFunction(()=>window.__weatherTest.pending().length===1);await settle(page);await place(page,'Tokyo');assert.equal((await pending(page)).length,0);
});

for (const locale of ['en-US','zh-CN','zh-TW','ja-JP','ko-KR','de-DE','fr-FR','es-ES','pt-BR','ru-RU']) {
 test(locale+' renders localized dashboard and details',async(t)=>{
  const page=await ready(t,{locale});await page.locator('[data-metric=humidity]').click();const dialog=page.getByRole('dialog');await dialog.waitFor();
  assert.equal(await page.locator('main').getAttribute('lang'),locale);assert.doesNotMatch(await dialog.textContent(),/undefined|\{(?:city|count|chance|speed|temperature)\}/);
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 });
}
for(const width of [390,430,768,1280]) for(const theme of ['light','dark']) {
 test(width+'px '+theme+' keeps controls and panels within the viewport',async(t)=>{
  const page=await ready(t,{width,fixture:'full'});await page.evaluate(theme=>window.__weatherTest.context('en-US',theme),theme);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  const dialog=await chooser(page);const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width);
  const evidence=process.env.WEATHER_BROWSER_EVIDENCE_DIR;
  if(evidence){await page.waitForTimeout(250); await capture(page,{path:evidence+'/weather-dialog-'+width+'-'+theme+'.png'}); await page.keyboard.press('Escape'); await dialog.waitFor({state:'hidden'}); await page.waitForTimeout(200); await capture(page,{path:evidence+'/weather-'+width+'-'+theme+'.png'});}
 });
}

test('closing the picker during a slow request keeps feedback and exposes failure on the dashboard',async(t)=>{
 const page=await ready(t);const dialog=await chooser(page);await city(dialog,'singapore');await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 assert.match(await page.locator('.weather-progress').textContent(),/Singapore/);await settle(page,{fail:true});
 await page.locator('.weather-alert').waitFor();assert.equal(await page.getByTestId('place-name').textContent(),'Beijing');
});
test('day and temperature controls change the chosen data without remounting the canvas',async(t)=>{
 const page=await ready(t);await page.locator('.forecast-list button').nth(1).click();const dialog=page.getByRole('dialog');await dialog.waitFor();
 assert.equal(await dialog.locator('.detail-date').textContent(),'September 6, 2026');
 await dialog.locator('canvas').evaluate(el=>window.__chart=el);
 await dialog.getByRole('button',{name:'Feels like',exact:true}).click();assert.equal(await dialog.getByRole('button',{name:'Feels like',exact:true}).getAttribute('aria-pressed'),'true');
 await dialog.getByRole('button',{name:/Sat 5/}).click();
 assert.equal(await dialog.locator('canvas').evaluate(el=>el===window.__chart),true);assert.equal(await page.getByTestId('detail-value').textContent(),'23°');
});
test('optional missing metrics and forecasts without hourly data remain explicitly unavailable',async(t)=>{
 const page=await ready(t);await page.locator('[data-metric=visibility]').click();const dialog=page.getByRole('dialog');await dialog.waitFor();
 await dialog.getByRole('button',{name:/Sun 6/}).click();assert.equal(await page.getByTestId('detail-value').textContent(),'—');
 assert.match(await dialog.textContent(),/Hourly details are unavailable/);await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 await page.getByRole('button',{name:'Refresh',exact:true}).click();await settle(page,{hourly:false});await page.locator('[data-metric=uv]').waitFor({state:'hidden'});
 assert.equal(await page.locator('.metric').count(),5);
});
test('all eight metric details can reopen and dismissed dialogs release keyboard ownership',async(t)=>{
 const page=await ready(t);for(const metric of ['wind','sunset','rain','feels-like','humidity','uv','visibility','pressure']){
  await page.locator('[data-metric='+metric+']').click();const dialog=page.getByRole('dialog');await dialog.waitFor();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 }
 await chooser(page);await page.locator('#weather-query').fill('Berlin');await page.locator('#weather-query').press('Enter');await page.waitForFunction(()=>window.__weatherTest.pending().length===1);await settle(page);
});


test('complete forecast preserves all days, hours and metric illustrations', async(t) => {
 const page = await ready(t, { fixture:'full', width:390 });
 assert.equal(await page.locator('.forecast-list > li').count(),10);
 assert.equal(await page.locator('.hourly-list > li').count(),24);
 assert.equal(await page.locator('.metric').count(),8);
 assert.equal(await page.locator('.metric-illustration').count(),8);
 assert.equal(await page.locator('.hourly-list button').first().locator('strong').textContent(),'22°');
 assert.match(await page.locator('[data-metric=pressure]').textContent(),/1021 hPa/);
 assert.equal(await page.locator('.weather-icon .icon-cloud').count() >= 34,true);
 await page.locator('.hourly-list').evaluate(el => el.scrollLeft = el.scrollWidth);
 await page.locator('.hourly-list button').last().click();
 await page.getByRole('dialog').waitFor();
 assert.equal(await page.locator('.detail-date').textContent(),'September 6, 2026');
});
for (const [sky, kind] of [['sunny','clear-day'],['night','clear-night'],['cloudy','cloudy'],['rain','rain'],['snow','snow'],['fog','fog'],['storm','storm']]) {
 test('weather backdrop reflects '+sky+' independently of shell theme', async(t) => {
  const page=await ready(t,{fixture:'full',sky,width:390});
  const backdrop=page.locator('.weather-app');
  assert.match(await backdrop.getAttribute('class'),new RegExp('sky-'+kind));
  assert.equal(await page.locator('.weather-sky').getAttribute('aria-hidden'),'true');
  assert.equal(await page.locator('.weather-sky').evaluate(el => getComputedStyle(el).pointerEvents),'none');
  assert.match(await backdrop.evaluate(el => getComputedStyle(el).backgroundImage),/gradient/);
  await page.evaluate(()=>window.__weatherTest.context('en-US','dark'));
  assert.match(await backdrop.getAttribute('class'),new RegExp('sky-'+kind));
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.weather-sky .cloud').first().evaluate(el=>getComputedStyle(el).animationName),'none');
 });
}


test('sidebar belongs to the weather palette and separates selection from keyboard focus',async(t)=>{
 const page=await ready(t,{width:1280,fixture:'full',sky:'rain'});
 const readPalette=()=>page.locator('.city-sidebar').evaluate(el=>{
  const sidebar=getComputedStyle(el),card=getComputedStyle(el.querySelector('[aria-pressed=true]'));
  return {background:sidebar.backgroundImage,color:sidebar.color,weatherText:getComputedStyle(document.querySelector('main')).color,selectionOutline:card.outlineStyle,selectionBorder:card.borderTopColor};
 });
 const light=await readPalette();
 assert.equal(light.color,light.weatherText,'the sidebar shares the forecast text palette');
 assert.match(light.background,/gradient/,'the sidebar carries a toned weather background');
 assert.equal(light.selectionOutline,'none','selection must not borrow the host green focus ring');
 await page.evaluate(()=>window.__weatherTest.context('en-US','dark'));
 assert.deepEqual(await readPalette(),light,'shell theme must not introduce an unrelated sidebar palette');
 await page.keyboard.press('Tab');
 await page.locator('.city-card[aria-pressed=true]').focus();
 const focus=await page.locator('.city-card[aria-pressed=true]').evaluate(el=>({visible:el.matches(':focus-visible'),style:getComputedStyle(el).outlineStyle,width:parseFloat(getComputedStyle(el).outlineWidth)}));
 assert.ok(focus.visible&&focus.style==='solid'&&focus.width>=2,'keyboard focus remains independently visible');
 const search=await page.locator('.sidebar-search').boundingBox();assert.ok(search.height>=44);
});

test('picker gives recent cities separate selection and removal targets',async(t)=>{
 const page=await ready(t,{width:390,fixture:'full'});const dialog=await chooser(page);
 assert.equal(await dialog.locator('.recent-locations .location-choice').count(),3);
 assert.equal(await dialog.locator('.remove-location:visible').count(),3);
 const rows=await dialog.locator('.recent-locations .location-choice').evaluateAll(items=>items.map(el=>({x:el.getBoundingClientRect().x,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})));
 assert.ok(rows.every(row=>row.width>210&&row.height>=60));assert.equal(new Set(rows.map(row=>row.x)).size,1);
 assert.equal(await dialog.locator('[data-location-id="preset:beijing"]').count(),1);
 assert.equal(await dialog.locator('[data-location-id="preset:beijing"]').getAttribute('aria-current'),'true');
 const remove=dialog.getByRole('button',{name:'Remove Tokyo',exact:true});const rect=await remove.boundingBox();assert.ok(rect.width>=44&&rect.height>=44);
 const evidence=process.env.WEATHER_BROWSER_EVIDENCE_DIR;if(evidence) await capture(page,{path:evidence+'/weather-picker-manage.png'});
 await remove.click();await settle(page);await remove.waitFor({state:'hidden'});
 assert.equal(await dialog.locator('.remove-location:visible').count(),2);
});

test('selecting the current city dismisses the picker without another request',async(t)=>{
 const page=await ready(t,{width:390});const dialog=await chooser(page);
 await city(dialog,'beijing');await dialog.waitFor({state:'hidden'});
 assert.deepEqual(await pending(page),[]);
});

test('picker search results and empty state replace unrelated choices',async(t)=>{
 const page=await ready(t,{width:390,fixture:'full'});const dialog=await chooser(page);const input=dialog.locator('#weather-query');
 await input.fill('Unknown town');await input.press('Enter');
 const evidence=process.env.WEATHER_BROWSER_EVIDENCE_DIR;if(evidence){await page.waitForFunction(()=>window.__weatherTest.pending().length===1);await capture(page,{path:evidence+'/weather-picker-search-loading.png'});}
 await settle(page,{empty:true});
 await dialog.locator('.location-empty').waitFor();assert.match(await dialog.textContent(),/No matching places found/);
 assert.equal(await dialog.locator('.location-choice').count(),0);
 if(evidence) await capture(page,{path:evidence+'/weather-picker-search-empty.png'});
 await dialog.getByRole('button',{name:'Clear search',exact:true}).click();
 assert.equal(await input.inputValue(),'');assert.equal(await input.evaluate(el=>document.activeElement===el),true);
 await input.fill('Tokyo');await input.press('Enter');await settle(page);
 await dialog.locator('.search-results').waitFor();if(evidence) await capture(page,{path:evidence+'/weather-picker-search-result.png'});assert.equal(await dialog.locator('.location-choice').count(),1);
 await city(dialog,'tokyo');await settle(page);await place(page,'Tokyo');await dialog.waitFor({state:'hidden'});
});

for (const slowMotion of [false, true]) test('failed forecast from a search result stays visible and supports retry'+(slowMotion?' during slow layout motion':''),async(t)=>{
 const page=await ready(t,{width:390,fixture:'full'});const dialog=await chooser(page);
 const animationControl=slowMotion?await page.context().newCDPSession(page):undefined;
 if(animationControl){
  await animationControl.send('Animation.enable');
  await animationControl.send('Animation.setPlaybackRate',{playbackRate:0.1});
 }
 const input=dialog.locator('#weather-query');await input.fill('Singapore');await input.press('Enter');await settle(page);
 await dialog.locator('.search-results').waitFor();await city(dialog,'singapore');await settle(page,{fail:true});
 const error=dialog.locator('.chooser-status.error');await error.waitFor();
 assert.match(await error.textContent(),/Live weather is unavailable/);
 assert.equal(await page.getByTestId('place-name').textContent(),'Beijing');
 assert.equal(await dialog.locator('.search-results .location-choice').count(),1);
 if(animationControl){
  await page.waitForFunction(()=>document.querySelector('[role=dialog]').getAnimations().some(animation=>animation.effect.getKeyframes().some(frame=>'height' in frame)));
  assert.ok((await dialog.boundingBox()).height>480,'the regression must observe an unfinished height animation');
  await animationControl.send('Animation.setPlaybackRate',{playbackRate:1});
 }
 assert.ok((await settledDialogBounds(dialog)).height<=480,'a single result does not leave a full-height empty dialog');
 if(animationControl)await animationControl.detach();
 const evidence=process.env.WEATHER_BROWSER_EVIDENCE_DIR;if(evidence) await capture(page,{path:evidence+'/weather-picker-forecast-error.png'});
 await city(dialog,'singapore');await settle(page);await place(page,'Singapore');await dialog.waitFor({state:'hidden'});
});

test('picker keeps search reachable in a short viewport and avoids background scrolling',async(t)=>{
 const page=await ready(t,{width:390,height:520,fixture:'full'});const dialog=await chooser(page);
 const bounds=await dialog.boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=520);
 const input=dialog.locator('#weather-query');const before=await input.boundingBox();
 const background=await page.locator('.weather-content').evaluate(el=>el.scrollTop);
 await dialog.locator('.picker-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);
 const after=await input.boundingBox();assert.ok(Math.abs(before.y-after.y)<1);
 assert.equal(await page.locator('.weather-content').evaluate(el=>el.scrollTop),background);
 const evidence=process.env.WEATHER_BROWSER_EVIDENCE_DIR;if(evidence) await capture(page,{path:evidence+'/weather-picker-short-viewport.png'});
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
});

test('clearing an in-flight search cannot restore stale results',async(t)=>{
 const page=await ready(t,{width:390});const dialog=await chooser(page);const input=dialog.locator('#weather-query');
 await input.fill('Tokyo');await input.press('Enter');await page.waitForFunction(()=>window.__weatherTest.pending().length===1);
 await dialog.getByRole('button',{name:'Clear search',exact:true}).click();await settle(page);
 assert.equal(await input.inputValue(),'');assert.equal(await dialog.locator('.search-results').count(),0);
 assert.equal(await dialog.locator('.recent-locations .location-choice').count(),3);
});

for(const locale of ['en-US','zh-CN','zh-TW','ja-JP','ko-KR','de-DE','fr-FR','es-ES','pt-BR','ru-RU']) {
 test(locale+' picker keeps native fields, readable targets and localized states on mobile',async(t)=>{
  const page=await ready(t,{width:390,locale,fixture:'full'});
  await page.locator('.weather-toolbar button').first().click();const dialog=page.getByRole('dialog');await dialog.waitFor();
  assert.doesNotMatch(await dialog.textContent(),/undefined|\{(?:city|count)\}/);
  const input=dialog.locator('#weather-query');assert.ok((await input.boundingBox()).width>=180);
  const checks=await dialog.locator('.location-choice').evaluateAll(items=>items.map(el=>({width:el.clientWidth,overflow:el.scrollWidth>el.clientWidth,height:el.clientHeight})));
  assert.ok(checks.every(item=>!item.overflow&&item.height>=60));
  await dialog.locator('.remove-location').first().waitFor();
  const evidence=process.env.WEATHER_BROWSER_EVIDENCE_DIR;
  if(evidence&&locale==='zh-CN'){
   await page.waitForTimeout(100);await capture(page,{path:evidence+'/weather-picker-zh-CN-light.png'});
   await page.evaluate(()=>window.__weatherTest.context('zh-CN','dark'));await page.waitForTimeout(100);await capture(page,{path:evidence+'/weather-picker-zh-CN-dark.png'});
  }
 });
}


test('saved city selection paints its cache before the network responds', async (t) => {
 const page=await ready(t,{fixture:'full'});
 await page.locator('[data-city-id="preset:tokyo"]').click();
 await page.waitForFunction(()=>window.__weatherTest.pending().length===1);
 assert.equal(await page.getByTestId('place-name').textContent(),'Tokyo');
 assert.equal(await page.locator('.forecast-list > li').count(),10);
 assert.equal(await page.locator('.weather-app.sky-rain').count(),1);
 await settle(page,{fail:true});
 assert.equal(await page.getByTestId('place-name').textContent(),'Tokyo');
 assert.equal(await page.locator('.forecast-list > li').count(),10);
 await page.locator('.weather-alert').waitFor();
});

test('sidebar removal is discoverable and does not select the removed city', async (t) => {
 const page=await ready(t,{fixture:'full'});
 const remove=page.locator('[data-remove-city="preset:tokyo"]');
 assert.equal(await remove.count(),1);
 await remove.click();
 await page.waitForFunction(()=>window.__weatherTest.pending()[0]?.method==='weather.locations.remove');
 assert.equal(await page.getByTestId('place-name').textContent(),'Beijing');
 await settle(page);
 assert.equal(await page.locator('[data-city-id="preset:tokyo"]').count(),0);
 assert.equal(await page.getByTestId('place-name').textContent(),'Beijing');
});


test('removing the selected city shows the next cached city and removing the last returns to the picker', async (t) => {
 const page=await ready(t,{fixture:'full'});
 await page.locator('[data-remove-city="preset:beijing"]').click(); await settle(page);
 await place(page,'Tokyo');
 await settle(page);
 assert.equal(await page.locator('[data-city-id="preset:beijing"]').count(),0);
 await page.locator('[data-remove-city="preset:singapore"]').click(); await settle(page);
 await page.locator('[data-remove-city="preset:tokyo"]').click(); await settle(page);
 await page.locator('.onboarding').waitFor();
 assert.equal(await page.locator('.forecast-dashboard').count(),0);
 assert.equal((await pending(page)).length,0);
});

test('failed removal retains the city and reports the failure where the user acted', async (t) => {
 const page=await ready(t);
 await page.locator('[data-remove-city="preset:tokyo"]').click(); await settle(page,{fail:true});
 assert.equal(await page.locator('[data-city-id="preset:tokyo"]').count(),1);
 assert.equal(await page.getByTestId('place-name').textContent(),'Beijing');
 await page.locator('.weather-alert').waitFor();
});


test('switching back reuses full live hourly data before a queued refresh completes', async (t) => {
 const page=await ready(t,{fixture:'full'});
 await page.locator('[data-city-id="preset:tokyo"]').click(); await settle(page);
 await page.getByRole('button',{name:'Refresh',exact:true}).waitFor();
 await page.locator('[data-city-id="preset:beijing"]').click();
 await page.waitForFunction(()=>window.__weatherTest.pending().length===1);
 await page.locator('[data-city-id="preset:tokyo"]').click();
 assert.equal(await page.getByTestId('place-name').textContent(),'Tokyo');
 assert.equal(await page.locator('.hourly-list > li').count(),24);
 assert.equal(await page.locator('.metric').count(),8);
 await settle(page); await settle(page);
 assert.equal(await page.getByTestId('place-name').textContent(),'Tokyo');
});

test('a saved city can take over while the startup refresh is still pending', async (t) => {
 const page=await browser.newPage({viewport:{width:1280,height:900}}); t.after(()=>page.close());
 await page.goto(base+'/?fixture=full');
 await page.waitForFunction(()=>window.__weatherTest.pending().length===1);
 await page.locator('[data-city-id="preset:tokyo"]').click();
 assert.equal(await page.getByTestId('place-name').textContent(),'Tokyo');
 await settle(page);
 await page.waitForFunction(()=>window.__weatherTest.pending()[0]?.input.id==='preset:tokyo');
 assert.equal(await page.getByTestId('place-name').textContent(),'Tokyo');
 await settle(page);
 assert.equal((await pending(page)).length,0);
});
