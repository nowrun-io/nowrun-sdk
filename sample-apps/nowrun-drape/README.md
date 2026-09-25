# Drape

**Outfits, co-edited by you and your AI.** Reference demo app for the nowrun human+AI app model: a gender-fluid fashion essentials store where the user (touch) and ChatGPT (tool calls) operate the same live app state.

Built to be shown, not just shipped: demo video quality, agent-first architecture.

## What it demonstrates

- **Shop** — ~30-SKU unisex capsule catalogue, ghost-mannequin product photography (Magnific-generated), colorways, product detail sheets.
- **Looks** — editorial lookbook grid of the current outfit; tap any piece to swap by hand.
- **Bag** — save looks, add to bag, checkout (order confirmation = the demo's "consequence" beat).
- **✦ Agent console** — simulates the ChatGPT → nowrun command channel. Same dispatcher (`applyCommand` in `engine.ts`) the real MCP channel will call; swapping the transport requires zero UI changes.

## Agent tool surface

`get_state · search_catalog · set_outfit · swap_item · clear_slot · set_palette (mood and/or {primary, secondary} hex) · set_color · clear_palette · save_look · add_look_to_bag · checkout`

Tintable garments accept any hex live (palette roles: primary → top/dress/outerwear, secondary → the rest). The catalogue metadata (slots, tags, tones, prices) is what the agent reasons over — the app describes itself.

## Stack

- **Expo + React Native + TypeScript** (SDK 54) — same codebase exports to web (preview/testing) and Android APK (nowrun deploy).
- Files: `App.tsx` (UI) · `engine.ts` (state + command dispatcher) · `catalog.ts` (SKUs) · `catalogImages.ts` (generated image map).

## Asset pipeline

Ghost-mannequin product shots generated on Magnific via MCP-over-HTTP (no harness needed):

```bash
python3 ../scripts/drape_batch.py            # full catalogue vs style anchor
python3 ../scripts/drape_assets.py gen-ref <sku> "<desc>" <style_ref_creation>
node gen-image-map.js                        # refresh catalogImages.ts
```

Style anchor creation: `xSJpRcQjfW` (ecru boxy tee). All generations style-reference it for one-brand-shoot coherence.

## Run / deploy

```bash
npx expo start --web                          # local dev
npx expo export --platform web --output-dir dist && npx vercel deploy --yes   # web preview
# APK (when ready): eas build -p android → nowrun app create / deploy
```

Web preview: https://nowrun-drape.vercel.app
