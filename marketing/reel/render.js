// Usage: node render.js <frames_in_dir> <out_dir> [t1,t2,...]
const {chromium}=require('playwright');const fs=require('fs');const path=require('path');
(async()=>{
  const [vdir,out,only]=process.argv.slice(2);fs.mkdirSync(out,{recursive:true});
  const b=await chromium.launch({args:['--allow-file-access-from-files']});
  const p=await b.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});
  await p.addInitScript(d=>{window.VDIR=d},'file://'+path.resolve(vdir));
  await p.goto('file://'+__dirname+'/reel.html');
  await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(800);
  const fps=30,dur=await p.evaluate(()=>DUR);
  const times=only?only.split(',').map(Number):[...Array(dur*fps).keys()].map(i=>i/fps);
  for(let i=0;i<times.length;i++){await p.evaluate(t=>render(t),times[i]);
    await p.screenshot({path:`${out}/f${String(i).padStart(4,'0')}.jpg`,type:'jpeg',quality:95});}
  await b.close();
})();
