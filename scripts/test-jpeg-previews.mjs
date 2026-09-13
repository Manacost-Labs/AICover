import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {buildImageRequest} from '../server/chatgpt-images.js';
const {chromium}=await import(process.env.COVER_PLAYWRIGHT_MODULE||'playwright');
const dist=path.resolve(process.argv[2]||'dist');
const output=path.resolve(process.argv[3]||'/tmp/cover-jpeg-previews');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',serviceWorkers:'block'});
const origin='https://cover-fixture.invalid',errors=[],checks=[],requests=[];
let fixture={};
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.ttf':'font/ttf'};
context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin,'No external/provider request allowed');
  const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(url.pathname==='/api/chatgpt/session') return json({enabled:true,connected:true,imageVerified:false});
  if(url.pathname==='/api/runtime-capabilities') return json({gemini:false});
  if(url.pathname.startsWith('/api/gemini')) throw new Error('GPT flow must not call Gemini');
  if(url.pathname==='/api/chatgpt/images') {
    const body=req.postDataJSON();const decoded=buildImageRequest(body);
    assert.equal(decoded.path,'/images/edits');
    const optimizedOnly=body.references.every(ref=>ref.mimeType==='image/webp');
    if(!optimizedOnly) assert(body.references.some(ref=>ref.mimeType==='image/jpeg'&&ref.data.startsWith('/9j/')));
    for(const [i,file] of decoded.body.getAll('image[]').entries()) assert.equal(Buffer.from(await file.arrayBuffer()).toString('base64'),body.references[i].data);
    requests.push(body);return json({imageUrl:fixture.png});
  }
  if(url.pathname==='/api/history'&&req.method()==='POST') return json({error:'fixture storage disabled'},503);
  if(url.pathname.startsWith('/api/')) return json(url.pathname.endsWith('choice-notes')?{}:[]);
  const file=path.resolve(dist,'.'+(url.pathname==='/'?'/index.html':url.pathname));assert(file.startsWith(dist+path.sep));
  return route.fulfill({contentType:types[path.extname(file)]||'application/octet-stream',body:await readFile(file)});
});
try {
  const page=await context.newPage();page.setDefaultTimeout(10000);page.on('dialog',dialog=>dialog.accept());
  await page.goto(origin);
  fixture=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=240;canvas.height=640;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#dfe7dc';ctx.fillRect(0,0,240,640);
    ctx.fillStyle='#9b584f';ctx.fillRect(0,0,240,40);ctx.fillStyle='#46655d';ctx.fillRect(0,600,240,40);
    ctx.fillStyle='#c99665';ctx.beginPath();ctx.arc(120,105,38,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#677b96';ctx.fillRect(75,150,90,260);ctx.fillRect(77,400,32,175);ctx.fillRect(132,400,32,175);
    ctx.fillStyle='#303b34';ctx.font='20px sans-serif';ctx.fillText('HEAD',88,29);ctx.fillStyle='#fff';ctx.fillText('FEET',90,628);
    return {jpeg:canvas.toDataURL('image/jpeg',.85),png:canvas.toDataURL('image/png'),webp:canvas.toDataURL('image/webp')};
  });
  const upload=(format)=>({name:`portrait.${format==='jpeg'?'jpg':format}`,mimeType:`image/${format}`,buffer:Buffer.from(fixture[format].split(',')[1],'base64')});
  await page.locator('.studio-create input[type=file]').first().setInputFiles([upload('jpeg'),upload('webp')]);
  await page.getByRole('button',{name:'Открыть исходник 2',exact:true}).waitFor();
  await page.getByRole('radio',{name:'ChatGPT GPT Image 2',exact:true}).check();
  await page.getByRole('radio',{name:'Сцена',exact:true}).click();
  await page.getByRole('button',{name:'2 персонажа',exact:true}).click();
  // Switching from the default three-role plan removes its center role.
  // Explicitly fill the requested right role just as a user would.
  await page.getByRole('button',{name:'Право',exact:true}).click();
  await page.locator('.studio-create input[type=file]').first().setInputFiles(upload('webp'));
  await page.getByRole('button',{name:'Открыть слот Право',exact:true}).waitFor();
  await page.getByRole('button',{name:'Создать 1 вариант',exact:true}).click();
  await page.getByRole('button',{name:'Открыть вариант 1',exact:true}).waitFor();
  assert.equal(requests.length,1);assert.equal(requests[0].references.length,2);
  assert.equal(await page.getByText('Для генерации нужны изображения в формате base64.',{exact:true}).count(),0);
  checks.push('Real canvas JPEG/WEBP uploads pass scene normalization, browser validation and real backend multipart decoding without Gemini');
  await page.getByRole('button',{name:'Открыть слот Лево',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button',{name:'Открыть слот Лево',exact:true}).evaluate(el=>el===document.activeElement),true);
  const left=await page.getByRole('button',{name:'Открыть слот Лево',exact:true}).locator('img').getAttribute('src');
  await page.getByRole('button',{name:'Переместить Лево вправо',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Открыть слот Право',exact:true}).locator('img').getAttribute('src'),left);
  await page.getByRole('button',{name:'3 персонажа',exact:true}).click();
  const center=page.locator('.studio-create__scene-slot').filter({has:page.getByRole('button',{name:'Центр',exact:true})});
  await center.getByRole('button',{name:'Добавить',exact:true}).click();
  await page.locator('.studio-create input[type=file]').first().setInputFiles(upload('png'));
  await page.getByRole('button',{name:'Открыть слот Центр',exact:true}).waitFor();
  // The taller preview retains drag-and-drop and its keyboard move alternative.
  const drag=await page.evaluateHandle(()=>new DataTransfer());
  await page.getByRole('button',{name:'Открыть слот Лево',exact:true}).dispatchEvent('dragstart',{dataTransfer:drag});
  await center.dispatchEvent('drop',{dataTransfer:drag});
  await page.getByRole('button',{name:'Создать 1 вариант',exact:true}).click();
  await page.getByRole('button',{name:'Остановить ожидание',exact:true}).waitFor({state:'hidden'});
  assert.equal(requests.length,2);assert.equal(requests[1].references.length,3);
  async function layoutChecks(theme,width,mode) {
    await page.setViewportSize({width,height:1000});
    const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,images:[...document.querySelectorAll('.studio-create__sources .studio-create__media-button img')].map(img=>({fit:getComputedStyle(img).objectFit,height:img.getBoundingClientRect().height,loaded:img.complete&&img.naturalHeight>0})),overlaps:[...document.querySelectorAll('.studio-create__scene-slot')].flatMap(slot=>{
      const media=slot.querySelector('.studio-create__media-button')?.getBoundingClientRect();if(!media)return[];
      return [...slot.querySelectorAll('.studio-create__slot-heading button')].map(button=>{const r=button.getBoundingClientRect();return r.bottom>media.top+1;});
    })}));
    assert.equal(layout.overflow,false,`${theme}/${width}/${mode}: overflow`);
    assert(layout.images.every(img=>img.loaded&&img.fit==='contain'&&img.height>=180),`${theme}/${width}/${mode}: uncropped tall preview`);
    assert(layout.overlaps.every(value=>!value),`${theme}/${width}/${mode}: toolbar overlaps art`);
    if (mode === 'scene' && width >= 768) {
      const toolbarTops = await page.locator('.studio-create__slot-move').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().top));
      assert(Math.max(...toolbarTops) - Math.min(...toolbarTops) <= 1, `${theme}/${width}: scene toolbar alignment`);
    }
  }
  for(const theme of ['dark','light']) {
    await page.getByRole('button',{name:theme==='dark'?'Включить тёмную тему':'Включить светлую тему',exact:true}).click();
    for(const mode of ['scene','cover']) {
      if(mode==='cover') await page.getByRole('radio',{name:'Обложка',exact:true}).click();
      for(const width of [1920,1440,1024,768,390,320]) await layoutChecks(theme,width,mode);
      await page.setViewportSize({width:1440,height:1000});
      await page.locator('.studio-create__sources').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(output,`${theme}-${mode}-desktop.png`)});
      await page.setViewportSize({width:390,height:1000});
      await page.locator('.studio-create__sources').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(output,`${theme}-${mode}-mobile.png`)});
    }
    await page.getByRole('radio',{name:'Сцена',exact:true}).click();
  }
  checks.push('Both themes/6 widths: all uploaded art uses contain in >=180px frame; no overflow or control overlap; source lightbox Escape/focus, move buttons and drag/drop still work');
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('tab',{name:'Обложка',exact:true}).click();
  await page.getByRole('radio',{name:'ChatGPT GPT Image 2',exact:true}).check();
  await page.getByLabel('Загрузить свои игровые арты',{exact:true}).setInputFiles(upload('jpeg'));
  await page.getByRole('combobox',{name:/^Варианты/}).selectOption('1');
  await page.getByRole('button',{name:'Создать фон',exact:true}).click();
  await page.getByRole('button',{name:'Создать фон',exact:true}).waitFor();
  assert.equal(requests.length,3);assert.equal(requests[2].references[0].mimeType,'image/jpeg');
  checks.push('Thumbnail editor JPEG reaches the same backend edit contract');
  const oversizedJpeg=Buffer.concat([upload('jpeg').buffer,Buffer.alloc(10*1024*1024)]);
  assert(oversizedJpeg.length>10*1024*1024);
  await page.getByLabel('Загрузить свои игровые арты',{exact:true}).setInputFiles({name:'oversized-portrait.jpg',mimeType:'image/jpeg',buffer:oversizedJpeg});
  const optimizationStarted=Date.now();
  await page.getByRole('button',{name:'Создать фон',exact:true}).click();
  await page.getByRole('button',{name:'Создать фон',exact:true}).waitFor();
  const optimizationMs=Date.now()-optimizationStarted;
  assert(optimizationMs<8000,`Oversized JPEG preparation took ${optimizationMs}ms`);
  assert.equal(requests.length,4);
  assert(requests[3].references.some(reference=>reference.mimeType==='image/jpeg'));
  const optimized=requests[3].references.find(reference=>reference.mimeType==='image/webp');
  assert(optimized);
  assert(Buffer.from(optimized.data,'base64').length<10*1024*1024);
  assert.equal(await page.getByText('Каждое изображение должно быть не больше 10 МиБ.',{exact:true}).count(),0);
  checks.push(`A decodable JPEG over 10 MiB is re-encoded below the server limit in ${optimizationMs}ms and reaches the real multipart contract`);assert.deepEqual(errors,[]);
  await writeFile(path.join(output,'checks.json'),JSON.stringify({checks,metrics:{optimizationMs},errors,fixtureOnly:true,providerCalls:0},null,2));
  console.log(JSON.stringify({checks,metrics:{optimizationMs},output},null,2));
} finally {await browser.close();}
