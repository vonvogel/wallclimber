# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server at http://localhost:8080 (with Phaser telemetry)
npm run dev-nolog    # Start dev server without telemetry
npm run build        # Production build to dist/ (with telemetry)
npm run build-nolog  # Production build without telemetry
```

There are no tests in this project.

## Architecture

**Stack:** Phaser 3 game engine + TypeScript + Vite bundler.

**Scene flow:** `Boot` → `Preloader` → `MainMenu` → `Game` → `GameOver` (click returns to `MainMenu`)

**Scene responsibilities:**
- `Boot` — loads minimal assets (background image) needed before the progress bar can show
- `Preloader` — shows loading bar, loads remaining assets (`logo.png`, `greenwall.png`)
- `MainMenu` — click anywhere to start
- `Game` — all gameplay logic (see below)
- `GameOver` — shown when monkey falls off bottom; click to restart

**Entry points:**
- `src/main.ts` — DOM bootstrap, calls `StartGame('game-container')`
- `src/game/main.ts` — Phaser `Game` config (1024×768, scene list)
- `index.html` — mounts `#game-container` div

**Game scene (`src/game/scenes/Game.ts`):**

The core game is a wall-climbing monkey with pendulum physics. Key constants at the top of the file control world size (`WORLD_W=1024`, `WORLD_H=2400`) and physics tuning.

- **States:** `'hanging'` (pendulum swing) or `'flying'` (ballistic arc)
- **Controls:** Hold SPACE to spin the free arm, release to launch. The arm spin angle determines launch direction at fixed speed (700 px/s) plus pendulum tangential velocity.
- **Pegs:** Generated as a 5×30 grid with stagger and random jitter; sorted bottom-to-top. Player grabs whichever peg a hand tip enters within `GRAB_R=24` radius during flight.
- **Legs:** Simulated as double-pendulums reacting to body acceleration (ragdoll).
- **Rendering:** Pure Phaser `Graphics` API — no sprites for the monkey character; pegs and monkey are drawn each frame via `draw()`.
- **Camera:** Follows monkey with `centerOn(bx, by)`; world bounds set to `WORLD_W × WORLD_H`.
- **Lose condition:** `by > WORLD_H + 200` triggers `GameOver` scene.

**Assets** (`public/assets/`): `bg.png`, `logo.png`, `greenwall.png` — served statically, loaded via Phaser's loader with `setPath('assets')`.

**Build config:** Production build (`vite/config.prod.mjs`) splits Phaser into its own chunk and minifies with Terser (2 passes).
