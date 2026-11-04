const {chromium}=require('playwright');const fs=require('fs');
(async()=>{
  const out=process.argv[2];fs.mkdirSync(out,{recursive:true});
  const only=process.argv[3]; // optional comma list of times for previews
  const b=await chromium.launch();const p=await b.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});
  await p.goto('file://'+__dirname+'/reel.html');await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(500);
  const fps=30,times=only?only.split(',').map(Number):[...Array(15*fps).keys()].map(i=>i/fps);
  for(let i=0;i<times.length;i++){await p.evaluate(t=>render(t),times[i]);
    await p.screenshot({path:`${out}/f${String(i).padStart(4,'0')}.png`});}
  await b.close();
})();
