import { stored, seed, reload } from "./storage.mjs";
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const html=resolve(process.env.REDLINE_HTML || 'dist/index.html');
const out=process.env.REGRESSION_OUT || 'e2e/out/regressions';
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const cases={};
const name=p=>p.getByRole('textbox',{name:'姓名',exact:true});
const doc=p=>stored(p,"doc");
const open=async c=>{const p=await c.newPage();await p.goto(`file://${html}`);await p.locator('.app, [data-editor-status=blocked], [data-editor-status=unavailable]').waitFor();return p;};
cases.tabs=async c=>{
  const a=await open(c),b=await open(c);
  assert.equal(await name(b).count(),0,'second tab must not mount an editor');
  assert.match(await b.locator('body').innerText(),/已在另一个标签页打开/);
  await name(a).fill('甲页新姓名');assert.equal((await doc(a)).resume.basics.name,'甲页新姓名');
  await a.close();await b.getByRole('button',{name:'重新打开',exact:true}).click();await name(b).waitFor();
  assert.equal(await name(b).inputValue(),'甲页新姓名');
  await b.close();
  const [x,y]=await Promise.all([open(c),open(c)]);
  assert.equal(await name(x).count()+await name(y).count(),1,'simultaneous opens have exactly one writer');
};
cases.key=async c=>{
  await c.addInitScript(()=>{
    const fetch=window.fetch;window.keySignals=[];
    window.fetch=(url,options)=>{if(String(url).includes('api.deepseek.com'))window.keySignals.push(options.signal);return fetch(url,options);};
  });
  const p=await open(c),pending=[];
  await p.route('https://api.deepseek.com/**',route=>{
    if(route.request().method()==='OPTIONS')return route.fulfill({status:200,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'}});
    pending.push(route);
  });
  const finish=r=>r.fulfill({status:200,headers:{'access-control-allow-origin':'*','content-type':'application/json'},body:JSON.stringify({choices:[{message:{content:'ok'}}]})});
  await p.getByRole('button',{name:'填写 API Key',exact:true}).click();
  const input=p.getByRole('textbox',{name:'API Key',exact:true});await input.fill('sk-old-fake');
  for(let i=0;i<3;i++)await input.press('Enter');
  await p.waitForTimeout(150);assert.equal(pending.length,1,'Enter must not duplicate an in-flight key validation');
  await p.keyboard.press('Escape');await p.getByRole('dialog').waitFor({state:'detached'});
  assert.equal(await p.evaluate(()=>window.keySignals[0].aborted),true,'closing cancels the underlying request');
  await p.getByRole('button',{name:'填写 API Key',exact:true}).click();await input.fill('sk-new-fake');await p.getByRole('checkbox',{name:'记住 API Key',exact:true}).check();await input.press('Enter');
  await p.waitForTimeout(100);assert.equal(pending.length,2);await finish(pending[1]);
  await p.getByRole('dialog').waitFor({state:'detached'});await finish(pending[0]).catch(()=>{});
  assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('redline.connection.v1')).key),'sk-new-fake');
  assert.equal(await p.evaluate(()=>localStorage.getItem('redline.apiKey')),null,'successful storage removes the legacy key');
  await p.getByRole('button',{name:'已连接',exact:true}).click();await input.fill('sk-removed-fake');await input.press('Enter');
  await p.waitForTimeout(100);await p.getByRole('button',{name:'移除',exact:true}).click();
  await p.getByRole('dialog').waitFor({state:'detached'});await finish(pending[2]).catch(()=>{});
  assert.ok(!await p.evaluate(()=>JSON.parse(localStorage.getItem('redline.connection.v1') || '{}').key),'late verification cannot restore a removed key');
};
cases.saving=async c=>{
  await c.addInitScript(()=>{
    const put=IDBObjectStore.prototype.put;window.versionWrites=0;window.failVersions=false;
    IDBObjectStore.prototype.put=function(v,k){
      if(k==='versions'){window.versionWrites++;if(window.failVersions)throw new DOMException('test quota','QuotaExceededError');}
      if(k==='doc'&&window.failDoc)throw new DOMException('test quota','QuotaExceededError');
      return put.call(this,v,k);
    };
    const stringify=JSON.stringify;window.versionSerials=0;
    JSON.stringify=function(v,...a){if(Array.isArray(v)&&v[0]?.doc)window.versionSerials++;return stringify.call(this,v,...a);};
  });
  const p=await open(c),sample=await doc(p);
  const versions=Array.from({length:30},(_,i)=>({id:`v_${i}`,name:`saved ${i}`,at:i+1,doc:sample}));
  await p.getByRole('tab',{name:'版本',exact:true}).click();
  await p.locator('input[type=file][accept=".json"]').setInputFiles({name:'versions.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({doc:sample,threads:[],versions}))});
  await p.getByText('已从备份恢复',{exact:true}).waitFor();await p.getByRole('tab',{name:'内容',exact:true}).click();
  await p.evaluate(()=>{window.versionWrites=0;window.versionSerials=0;});
  await name(p).focus();for(let i=0;i<12;i++)await name(p).press('x');
  assert.equal(await p.evaluate(()=>window.versionWrites),0,'typing must not rewrite unchanged versions');
  assert.equal(await p.evaluate(()=>window.versionSerials),0,'typing must not stringify unchanged versions');
  const edited=await name(p).inputValue();assert.equal((await doc(p)).resume.basics.name,edited);await reload(p);await name(p).waitFor();assert.equal(await name(p).inputValue(),edited);
  await p.getByRole('tab',{name:'版本',exact:true}).click();await p.evaluate(()=>window.failVersions=true);
  await p.getByRole('button',{name:'删除 saved 0',exact:true}).click();await p.locator('.save-state.failed').waitFor();
  await p.getByRole('tab',{name:'内容',exact:true}).click();await name(p).fill('文档成功不能掩盖版本失败');
  assert.equal(await p.locator('.save-state.failed').count(),1);
  await p.evaluate(()=>window.failVersions=false);await p.getByRole('tab',{name:'版本',exact:true}).click();
  await p.getByRole('button',{name:'删除 saved 1',exact:true}).click();await p.locator('.save-state.failed').waitFor({state:'detached'});
  assert.equal((await stored(p,'versions')).length,28);
  await p.evaluate(()=>{window.failDoc=true;window.freeOnVersion=false;});
  await p.getByRole('tab',{name:'内容',exact:true}).click();await name(p).fill('释放空间后应补存');await p.locator('.save-state.failed').waitFor();
  await p.evaluate(()=>window.failDoc=false);await p.getByRole('tab',{name:'版本',exact:true}).click();
  await p.getByRole('button',{name:'删除 saved 2',exact:true}).click();await p.locator('.save-state.failed').waitFor({state:'detached'});
  assert.equal((await doc(p)).resume.basics.name,'释放空间后应补存','freeing version space retries unsaved document');
};
cases.photo=async c=>{
  await c.addInitScript(()=>{
    const decode=window.createImageBitmap;window.photos=[];
    window.createImageBitmap=async(...a)=>{const b=await decode(...a);await new Promise(resolve=>window.photos.push(resolve));return b;};
  });
  const p=await open(c);
  const image=async color=>Buffer.from(await p.evaluate(color=>{const c=document.createElement('canvas');c.width=30;c.height=42;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,30,42);return c.toDataURL().split(',')[1];},color),'base64');
  const upload=async(color,n)=>{await p.locator('input[type=file][accept="image/*"]').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:await image(color)});await p.waitForFunction(n=>window.photos.length===n,n);};
  const release=async i=>{await p.evaluate(i=>window.photos[i](),i);await p.waitForTimeout(80);};
  const savePhoto=()=>p.getByRole('dialog',{name:'调整证件照'}).getByRole('button',{name:'保存照片',exact:true}).click();
  // Deliberately deliver an external edit during the modal to exercise stale async completions.
  await upload('red',1);
  await p.getByRole('textbox',{name:'姓名',exact:true,includeHidden:true}).evaluate(input=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'解码期间的新姓名');
    input.dispatchEvent(new Event('input',{bubbles:true}));
  });
  assert.equal((await doc(p)).resume.basics.name,'解码期间的新姓名','external edit must commit before decoding completes');
  await release(0);await savePhoto();
  assert.equal((await doc(p)).resume.basics.name,'解码期间的新姓名','photo completion must preserve concurrent text edits');
  assert.ok((await doc(p)).resume.photo);
  await upload('green',2);await upload('blue',3);await release(2);await savePhoto();const newer=(await doc(p)).resume.photo;await release(1);
  assert.equal((await doc(p)).resume.photo,newer,'older photo cannot replace newer upload');
  await upload('red',4);await p.locator('.photo-row').getByRole('button',{name:'移除',exact:true,includeHidden:true}).evaluate(button=>button.click());await release(3);
  assert.equal((await doc(p)).resume.photo,undefined,'removed photo cannot return');
  await upload('red',5);await p.getByRole('tab',{name:'版本',exact:true,includeHidden:true}).evaluate(button=>button.click());
  await p.getByRole('button',{name:'新建空白简历',exact:true,includeHidden:true}).evaluate(button=>button.click());await release(4);
  assert.equal((await doc(p)).resume.photo,undefined,'old upload cannot modify a replacement document');
  assert.equal((await doc(p)).resume.basics.name,'');
};
cases.import=async c=>{
  await c.addInitScript(()=>{
    const read=File.prototype.text;window.reads=0;
    File.prototype.text=async function(){const text=await read.call(this);window.reads++;if(this.name==='old.txt')await new Promise(resolve=>window.releaseRead=resolve);return text;};
  });
  const p=await open(c);const show=()=>p.getByRole('button',{name:'导入',exact:true}).click();
  const close=async()=>{await p.keyboard.press('Escape');await p.getByRole('dialog').waitFor({state:'detached'});};
  await show();await p.locator('.dialog input[type=file]').setInputFiles({name:'old.txt',mimeType:'text/plain',buffer:Buffer.from('旧文件原文')});
  await p.waitForFunction(()=>window.reads===1);await close();await show();await p.locator('.import-text').fill('新的导入草稿');await close();
  await p.evaluate(()=>window.releaseRead());await p.waitForTimeout(80);await show();
  assert.equal(await p.locator('.import-text').inputValue(),'新的导入草稿','closed importer cannot overwrite a later draft');
  await p.locator('.dialog input[type=file]').setInputFiles({name:'normal.txt',mimeType:'text/plain',buffer:Buffer.from('正常文件原文')});
  await p.waitForFunction(()=>document.querySelector('.import-text')?.value==='正常文件原文');
  await p.locator('.dialog input[type=file]').setInputFiles({name:'old.txt',mimeType:'text/plain',buffer:Buffer.from('另一份旧原文')});
  await p.waitForFunction(()=>window.reads===3);
  await p.evaluate(()=>{
    [...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='关闭').click();
    setTimeout(()=>{[...document.querySelectorAll('.actions-top button')].find(b=>b.textContent.trim()==='导入').click();window.rapidOpened=true;},20);
  });
  await p.waitForFunction(()=>window.rapidOpened);
  await p.locator('.dialog input[type=file]').setInputFiles({name:'rapid.txt',mimeType:'text/plain',buffer:Buffer.from('快速重开后的原文')});
  await p.waitForFunction(()=>document.querySelector('.import-text')?.value==='快速重开后的原文',null,{timeout:3000});
  await p.evaluate(()=>window.releaseRead());await p.waitForTimeout(80);
  assert.equal(await p.locator('.import-text').inputValue(),'快速重开后的原文','reopening during exit must leave reading state usable');

};
cases.motion=async c=>{
  await c.addInitScript(()=>{
    window.shots=0;window.uploads=0;window.draws=0;
    const serialize=XMLSerializer.prototype.serializeToString;
    XMLSerializer.prototype.serializeToString=function(n){const s=serialize.call(this,n);if(s.includes('data-shot'))window.shots++;return s;};
    const tex=WebGL2RenderingContext.prototype.texImage2D;
    WebGL2RenderingContext.prototype.texImage2D=function(...a){if(a.at(-1) instanceof HTMLCanvasElement)window.uploads++;return tex.apply(this,a);};
    const draw=WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays=function(...a){window.draws++;return draw.apply(this,a);};
  });
  const p=await open(c);await p.waitForTimeout(1800);
  assert.equal(await p.evaluate(()=>window.shots),0,'reduced motion must not prepare unused screenshots');
  await name(p).fill('减弱动效编辑');await p.getByRole('button',{name:'放大',exact:true}).click();await p.waitForTimeout(1700);
  assert.equal(await p.evaluate(()=>window.shots),0);
  await p.emulateMedia({reducedMotion:'no-preference'});await p.waitForFunction(()=>window.shots===2);await p.waitForTimeout(150);
  await p.locator('.page-live li').first().click();await p.waitForTimeout(1500);
  assert.equal(await p.evaluate(()=>window.uploads),2,'normal mode still uploads both page textures');
  const draws=await p.evaluate(()=>window.draws);await p.waitForTimeout(200);assert.equal(await p.evaluate(()=>window.draws),draws);
  await p.emulateMedia({reducedMotion:'reduce'});await name(p).fill('再次减弱动效');await p.waitForTimeout(1800);
  assert.equal(await p.evaluate(()=>window.shots),2,'switching back cancels screenshot scheduling');
};
const selected=process.argv.slice(2);const report={html,htmlSha256:createHash('sha256').update(readFileSync(html)).digest('hex'),browser:browser.version(),cases:[]};
try{
 for(const [id,run]of Object.entries(cases)){
  if(selected.length&&!selected.includes(id))continue;
  const c=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2,reducedMotion:'reduce'});
  await c.route('https://**',r=>r.abort());
  const errors=[];c.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  try{await run(c);assert.deepEqual(errors,[]);report.cases.push({id,status:'passed'});console.log(`PASS ${id}`);}
  catch(e){report.cases.push({id,status:'failed',error:e.message});console.error(`FAIL ${id}: ${e.stack}`);process.exitCode=1;}
  finally{await c.close();}
 }
 assert.ok(report.cases.length,'choose at least one known case');
}finally{await browser.close();writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));}
