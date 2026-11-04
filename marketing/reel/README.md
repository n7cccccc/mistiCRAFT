# mistiCRAFT Instagram Reel

- `misticraft-reel.mp4`: 1080×1920, 30 fps, 20 s, H.264 + AAC, ready to upload
- `cover.jpg`: cover frame (Sunflower Camp Shirt)
- `caption.txt`: suggested caption and hashtags
- `assets/`: atelier video, product photos, logo (gold/cream, upscaled from the site's logo)
- `reel.html`: the animation; `render(t)` draws the frame at time t
- `render.js`: renders frames with Playwright

## Timeline
0–2 s hook "14 hours of hand embroidery" (hoop) · 2–4.5 s artisan · 4.5–6.5 s logo over the workshop ·
6.5–14 s three products with name + MRP · 14–16 s "40+ women artisans" · 16–20 s end card

## Rebuild
```
V=assets/atelier.mp4
seg(){ mkdir -p vf/$1; ffmpeg -ss $2 -t $3 -i $V -vf "fps=30,crop=405:720:$4-202:0,scale=1080:1920:flags=lanczos,unsharp=5:5:0.6" -q:v 2 vf/$1/%04d.jpg; }
seg hoop 6 2 780; seg artisan 3 3 560; seg wide 0 3 640; seg wide2 8 2 640
node render.js vf frames
ffmpeg -framerate 30 -i frames/f%04d.jpg -i music.wav -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac -shortest misticraft-reel.mp4
```
