# mistiCRAFT Instagram Reel

- `misticraft-reel.mp4`: 1080×1920, 30 fps, 24 s, H.264 + AAC, ready to upload
- `cover.jpg`: cover frame (The Collection grid)
- `caption.txt`: suggested caption and hashtags
- `products.json`: the 20 shop products used (name, detail, image), collected from the shop page export
- `assets/`: atelier video, product photos (`assets/products/`), logo
- `reel.html`: the animation; `render(t)` draws the frame at time t
- `render.js`: renders frames with Playwright

## Timeline (Figma-style motion: spring easing, push, mask, smart-animate)
| Time | Scene | Transition in |
|---|---|---|
| 0–2 s | Hook: "14 hours of hand embroidery" on the hoop close-up | — |
| 2–4 s | Artisan: "Stitched by hand" | push up |
| 4–6 s | Logo + "Udaipur · Since 2018" over the workshop | circular mask |
| 6–10 s | "The Collection": 18 cards spring in, grid scrolls | bottom sheet |
| 10–18 s | Swipe carousel of 6 products (name + detail, page dots) | smart-animate from grid card |
| 18–20.5 s | "40+ women artisans" + value chips | card expands to full screen |
| 20.5–24 s | End card: logo, tagline, CTA, @misticraft | push from right |

No prices are shown.

## Rebuild
```
V=assets/atelier.mp4
seg(){ mkdir -p vf/$1; ffmpeg -ss $2 -t $3 -i $V -vf "fps=30,crop=405:720:$4-202:0,scale=1080:1920:flags=lanczos,unsharp=5:5:0.6" -q:v 2 vf/$1/%04d.jpg; }
seg hoop 6 2 780; seg artisan 3 3 560; seg wide 0 3 640; seg wide2 8 2 640
node render.js vf frames
ffmpeg -framerate 30 -i frames/f%04d.jpg -i music.wav -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac -shortest misticraft-reel.mp4
```
