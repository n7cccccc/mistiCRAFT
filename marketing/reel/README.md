# mistiCRAFT Instagram Reel

- `misticraft-reel.mp4` — 1080×1920, 30 fps, 15 s, H.264 + AAC (ready to upload)
- `cover.jpg` — cover frame
- `caption.txt` — suggested caption + hashtags
- `reel.html` — the animation source (`render(t)` draws frame at time t)
- `render.js` — renders frames with Playwright: `node render.js <out_dir>`

Rebuild: render frames, then
`ffmpeg -framerate 30 -i <out_dir>/f%04d.png -i audio.wav -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac -shortest misticraft-reel.mp4`
