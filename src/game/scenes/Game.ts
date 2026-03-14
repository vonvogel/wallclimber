import { Scene } from 'phaser';

const WORLD_W   = 1024;
const WORLD_H   = 2400;
const GRAB_R    = 24;
const GRAVITY   = 900;
const DAMPING   = 0.992;
const LEG_DAMP  = 0.95;
const SPIN_SPD  = Math.PI * 2;
const BODY_H    = 32;
const BODY_W    = 30;
const ARM_U     = 20;
const ARM_L     = 18;
const LEG_U     = 18;
const LEG_L     = 14;
const HEAD_LEN  = 16;   // neck to head-centre distance
const HEAD_K    = 150;  // spring stiffness (rad/s²) — must exceed GRAVITY/HEAD_LEN ≈ 56
const HEAD_DAMP = 0.97; // angular damping per step

// ── Grip slip mechanic ────────────────────────────────────────────────────────
const GRIP_DURATION = 5;     // seconds until auto-release
const GRIP_SLIDE    = 28;    // px the body drifts down (≈ head diameter)

// ── Sky Lounge platform ───────────────────────────────────────────────────────
const PLAT_Y    = 200;  // platform top surface Y (~2 monkey-heights from ceiling)
const PLAT_X1   = 30;   // left fifth of the 1024-wide wall
const PLAT_X2   = 235;
const PLAT_H    = 22;

type GameState = 'hanging' | 'flying';
type GrabLimb  = 'leftHand' | 'rightHand';

interface Peg { x: number; y: number; dir: number; }

interface Parakeet {
    x: number; y: number;
    vx: number; vy: number;
    wingPhase: number;
    hitCooldown: number;  // ms — skip collision while > 0
}

// [upperAngle, upperVel, lowerAngle, lowerVel]
type LegState = [number, number, number, number];

export class Game extends Scene
{
    private pegs:      Peg[]    = [];
    private gfx!:      Phaser.GameObjects.Graphics;
    private hudText!:  Phaser.GameObjects.Text;
    private hudLeft!:  Phaser.GameObjects.Text;
    private bestPct:   number = 0;

    private state:     GameState = 'hanging';
    private grabPeg!:  Peg;
    private grabLimb:  GrabLimb  = 'rightHand';
    private lastPeg:   Peg | null = null;

    // pendulum
    private pendAngle: number = 0;
    private pendVel:   number = 0;
    private pendLen:   number = 55;

    // body world pos
    private bx: number = 0;
    private by: number = 0;

    // flight
    private vx: number = 0;
    private vy: number = 0;

    // arm angles: right spins CW, left spins CCW
    private spinAngle:  number = Math.PI / 2;   // right arm (or free arm when hanging)
    private leftAngle:  number = Math.PI / 2;   // left arm

    // ragdoll legs: [upperAngle, upperVel, lowerAngle, lowerVel]
    private legL: LegState = [0, 0, 0, 0];
    private legR: LegState = [0, 0, 0, 0];

    // spring-pendulum head (angle from vertical-up, 0 = centred)
    private headAngle: number = 0;
    private headVel:   number = 0;

    private gripDamp:       number  = 0.992;
    private gripSlideTimer: number  = 0;   // seconds on current peg
    private gripSlide:      number  = 0;   // current downward slip offset (px)
    private hasJumped:      boolean = false; // slip mechanic inactive on first grip
    private startTime:      number  = 0;

    private parakeets:      Parakeet[] = [];
    private parakeetTimer:  number     = 0;   // ms since last spawn
    private parakeetNext:   number     = 5000; // ms until next spawn

    private celebrating:  boolean = false;
    private celebrateTimer: number = 0;
    private celebrateElapsed: number = 0;

    private spaceKey!:   Phaser.Input.Keyboard.Key;
    private sKey!:       Phaser.Input.Keyboard.Key;
    private wasSpace:    boolean = false;
    private hudSound!:   Phaser.GameObjects.Text;

    constructor () { super('Game'); }

    shutdown () { this.scale.off('resize', this.onResize, this); }

    // ─── lifecycle ────────────────────────────────────────────────────────────

    create ()
    {
        this.pegs      = [];
        this.state     = 'hanging';
        this.grabLimb  = 'rightHand';
        this.lastPeg   = null;
        this.pendAngle = 0;
        this.pendVel   = 0;
        this.pendLen   = 55;
        this.bx        = 0;
        this.by        = 0;
        this.vx        = 0;
        this.vy        = 0;
        this.spinAngle = Math.PI / 2;
        this.leftAngle = Math.PI / 2;
        this.wasSpace  = false;
        this.legL      = [0, 0, 0, 0];
        this.legR      = [0, 0, 0, 0];
        this.bestPct   = 0;
        this.gripDamp        = DAMPING;
        this.gripSlideTimer  = 0;
        this.gripSlide       = 0;
        this.hasJumped       = false;
        this.headAngle       = 0;
        this.headVel         = 0;
        this.startTime       = Date.now();
        this.celebrating     = false;
        this.celebrateTimer  = 0;
        this.celebrateElapsed = 0;
        this.parakeets       = [];
        this.parakeetTimer   = 0;
        this.parakeetNext    = 2000 + Math.random() * 3000; // first one soon

        if (!this.textures.exists('confettiRect')) {
            const cg = this.make.graphics({ x: 0, y: 0, add: false });
            cg.fillStyle(0xffffff);
            cg.fillRect(0, 0, 8, 4);
            cg.generateTexture('confettiRect', 8, 4);
            cg.destroy();
        }

        this.generatePegs();

        const wall = this.add.image(WORLD_W / 2, WORLD_H / 2, 'greenwall');
        wall.setDisplaySize(WORLD_W, WORLD_H);

        this.gfx = this.add.graphics();
        this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
        this.cameras.main.setZoom(this.scale.width / WORLD_W);

        this.hudLeft = this.add.text(WORLD_W / 2, 0, 'HOLD SPACE to spin arm  •  RELEASE to jump', {
            fontFamily: 'Arial', fontSize: 16, color: '#ffffff',
            stroke: '#000000', strokeThickness: 4
        }).setScrollFactor(0).setDepth(10).setOrigin(0.5, 1);

        this.hudText = this.add.text(WORLD_W - 12, 12, '', {
            fontFamily: 'Arial Black', fontSize: 22, color: '#ffff00',
            stroke: '#000000', strokeThickness: 5,
            align: 'right'
        }).setScrollFactor(0).setDepth(10).setOrigin(1, 0);

        // Sky Lounge sign (world-space, scrolls with camera)
        this.add.text((PLAT_X1 + PLAT_X2) / 2, PLAT_Y - 76, 'SKY\nLOUNGE', {
            fontFamily: 'Arial Black', fontSize: 20, color: '#ffffff',
            stroke: '#000000', strokeThickness: 5,
            align: 'center', lineSpacing: -4,
        }).setOrigin(0.5, 1).setDepth(5);

        const startPegs = this.pegs.filter(p => p.y >= WORLD_H - 300 && p.y <= WORLD_H - 200);
        this.grabPeg = startPegs.length > 0
            ? startPegs[Math.floor(Math.random() * startPegs.length)]
            : this.pegs[0];
        this.updateBody();

        this.cameras.main.centerOn(this.bx, this.by);
        this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
        this.sKey     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S);

        this.repositionHUD();
        this.scale.on('resize', this.onResize, this);

        // apply mute preference from main menu
        const muted = this.registry.get('muted') ?? false;
        this.sound.mute = muted;

        this.hudSound = this.add.text(12, 12, '', {
            fontFamily: 'Arial Black', fontSize: 16, color: '#ffffff',
            stroke: '#000000', strokeThickness: 4,
        }).setScrollFactor(0).setDepth(10).setOrigin(0, 0);
        this.updateSoundHud();
    }

    update (_time: number, delta: number)
    {
        const dt    = Math.min(delta / 1000, 0.05);
        const space = this.spaceKey.isDown;

        if (Phaser.Input.Keyboard.JustDown(this.sKey)) {
            this.sound.mute = !this.sound.mute;
            this.registry.set('muted', this.sound.mute);
            this.updateSoundHud();
        }

        if (this.hasJumped) this.updateParakeets(delta);

        if (this.celebrating) {
            this.celebrateTimer += delta;
            if (this.celebrateTimer > 3200) {
                this.scene.start('GameOver', { type: 'skylounge', time: this.celebrateElapsed });
            }
            this.cameras.main.centerOn(this.bx, this.by);
            this.draw();
            return;
        }

        if (this.state === 'hanging') {
            this.tickHanging(dt, space);
        } else {
            this.tickFlying(dt);
        }

        this.wasSpace = space;
        this.cameras.main.centerOn(this.bx, this.by);
        this.draw();

        const pct = Math.max(0, Math.round((1 - this.by / WORLD_H) * 100));
        if (pct > this.bestPct) this.bestPct = pct;
        this.hudText.setText(`Height: ${pct}%\nBest: ${this.bestPct}%`);
    }

    // ─── physics ──────────────────────────────────────────────────────────────

    private tickHanging (dt: number, space: boolean)
    {
        // ── grip slip: slowly slide down, then auto-release (not on first grip) ──
        if (this.hasJumped) {
            this.gripSlideTimer += dt;
            const t = Math.min(1, this.gripSlideTimer / GRIP_DURATION);
            this.gripSlide = t * GRIP_SLIDE;
            if (this.gripSlideTimer >= GRIP_DURATION) {
                const tangLen  = this.pendVel * this.pendLen;
                this.vx        =  Math.cos(this.pendAngle) * tangLen;
                this.vy        = -Math.sin(this.pendAngle) * tangLen;
                this.lastPeg   = this.grabPeg;
                this.spinAngle = Math.PI / 2;
                this.leftAngle = Math.PI / 2;
                this.state     = 'flying';
                return;
            }
        }

        const θ = this.pendAngle, ω = this.pendVel, L = this.pendLen;
        const pendAcc = -(GRAVITY / L) * Math.sin(θ);
        this.pendVel += pendAcc * dt;
        this.pendVel *= this.gripDamp;
        this.gripDamp += (DAMPING - this.gripDamp) * 0.05;   // ease back to normal
        this.pendAngle += this.pendVel * dt;
        this.updateBody();

        // body acceleration in screen coords (y downward)
        const bodyAx = L * (pendAcc * Math.cos(θ) - ω * ω * Math.sin(θ));
        const bodyAy = L * (-pendAcc * Math.sin(θ) - ω * ω * Math.cos(θ));
        this.stepLeg(this.legL, dt, bodyAx, bodyAy);
        this.stepLeg(this.legR, dt, bodyAx, bodyAy);
        this.stepHead(dt, bodyAx, bodyAy);

        if (space) {
            // right arm free (CCW) when left grabs; left arm free (CW) when right grabs
            const dir = this.grabLimb === 'leftHand' ? 1 : -1;
            this.spinAngle += dir * SPIN_SPD * dt;
        }

        if (this.wasSpace && !space) {
            this.launch();
        }
    }

    private tickFlying (dt: number)
    {
        this.vy += GRAVITY * dt;
        this.bx += this.vx * dt;
        this.by += this.vy * dt;

        if (this.bx < 20)            { this.bx = 20;            this.vx =  Math.abs(this.vx) * 0.4; }
        if (this.bx > WORLD_W - 20)  { this.bx = WORLD_W - 20; this.vx = -Math.abs(this.vx) * 0.4; }
        if (this.by > WORLD_H + 200) { this.safePlay('ohno'); this.scene.start('GameOver', { score: this.bestPct }); return; }

        // Platform collision
        const feetY = this.by + BODY_H / 2;
        if (this.bx >= PLAT_X1 && this.bx <= PLAT_X2) {
            if (this.vy > 0 && feetY >= PLAT_Y && feetY <= PLAT_Y + PLAT_H + 20) {
                // Landing from above → Sky Lounge!
                const elapsed = Math.round((Date.now() - this.startTime) / 100) / 10;
                this.triggerCelebration(elapsed);
                return;
            }
            if (this.vy < 0 && feetY > PLAT_Y && this.by < PLAT_Y + PLAT_H + BODY_H / 2 + 5) {
                // Hit underside going up — bounce back down
                this.by = PLAT_Y + PLAT_H + BODY_H / 2 + 1;
                this.vy = Math.abs(this.vy) * 0.2;
            }
        }

        if (this.vy < 0) {
            // Moving upward: stretch both arms symmetrically around the flight direction
            const flightAngle = Math.atan2(this.vy, this.vx);
            const spread = 22.4 * Math.PI / 180;   // half the 45° spread
            this.spinAngle = flightAngle + spread;  // right arm
            this.leftAngle = flightAngle - spread;  // left arm
        } else {
            // Falling: both arms spin wildly to catch a peg
            this.spinAngle += SPIN_SPD * dt;   // right arm clockwise
            this.leftAngle -= SPIN_SPD * dt;   // left arm counter-clockwise
        }

        // body in free fall → effective gravity in body frame = 0 → limbs gently drift
        this.stepLeg(this.legL, dt, 0, GRAVITY);
        this.stepLeg(this.legR, dt, 0, GRAVITY);
        this.stepHead(dt, 0, GRAVITY);

        this.checkGrab();
    }

    /** Double-pendulum step for one leg, given body acceleration (ax, ay screen-space). */
    private stepLeg (leg: LegState, dt: number, bodyAx: number, bodyAy: number)
    {
        // effective gravity in non-inertial frame of the hip
        const gex = -bodyAx;
        const gey = GRAVITY - bodyAy;

        // upper segment
        const φu = leg[0], ωu = leg[1];
        const αu = -(gey * Math.sin(φu) - gex * Math.cos(φu)) / LEG_U;
        leg[1]   = (ωu + αu * dt) * LEG_DAMP;
        leg[0]   = φu + leg[1] * dt;

        // knee acceleration (drives the lower segment)
        const kAx = bodyAx + LEG_U * (αu * Math.cos(φu) - ωu * ωu * Math.sin(φu));
        const kAy = bodyAy + LEG_U * (-αu * Math.sin(φu) - ωu * ωu * Math.cos(φu));

        // lower segment
        const φl = leg[2], ωl = leg[3];
        const αl = -(( GRAVITY - kAy) * Math.sin(φl) - (-kAx) * Math.cos(φl)) / LEG_L;
        leg[3]   = (ωl + αl * dt) * LEG_DAMP;
        leg[2]   = φl + leg[3] * dt;
    }

    /**
     * Spring-pendulum head above the neck.
     * headAngle = 0 → head centred directly above neck.
     * Torque = body-frame effective-gravity component + spring restoring force.
     */
    private stepHead (dt: number, bodyAx: number, bodyAy: number)
    {
        const θ  = this.headAngle;
        // In the neck's non-inertial frame the effective downward gravity is (GRAVITY - bodyAy)
        // and there is a lateral pseudo-force (-bodyAx).
        // For an inverted pendulum the destabilising torque is:
        //   (GRAVITY - bodyAy) * sin(θ) - (-bodyAx) * cos(θ)  (divided by HEAD_LEN)
        // The spring opposes the angle: -HEAD_K * θ
        const α = ((GRAVITY - bodyAy) * Math.sin(θ) + bodyAx * Math.cos(θ)) / HEAD_LEN
                  - HEAD_K * θ;
        this.headVel    = (this.headVel + α * dt) * HEAD_DAMP;
        this.headAngle += this.headVel * dt;
    }

    private onResize (gameSize: Phaser.Structs.Size)
    {
        const zoom = gameSize.width / WORLD_W;
        this.cameras.main.setZoom(zoom);
        this.repositionHUD();
    }

    private repositionHUD ()
    {
        const zoom = this.cameras.main.zoom;
        // bottom HUD: place 14px from the bottom of the actual viewport
        this.hudLeft.setPosition(WORLD_W / 2, (this.scale.height - 14) / zoom);
    }

    private updateSoundHud ()
    {
        this.hudSound.setText(this.sound.mute ? '[S] Sound: OFF' : '[S] Sound: ON');
        this.hudSound.setColor(this.sound.mute ? '#ff6666' : '#aaffaa');
    }

    private safePlay (key: string)
    {
        if (this.sound.mute) return;
        if (this.cache.audio.exists(key)) this.sound.play(key);
    }

    private rndPlay (a: string, b: string)
    {
        this.safePlay(Math.random() < 0.5 ? a : b);
    }

    private launch ()
    {
        const tangLen = this.pendVel * this.pendLen;
        const tvx     =  Math.cos(this.pendAngle) * tangLen;
        const tvy     = -Math.sin(this.pendAngle) * tangLen;

        const speed = 700;
        this.vx = Math.cos(this.spinAngle) * speed + tvx;
        this.vy = Math.sin(this.spinAngle) * speed + tvy;
        this.lastPeg   = this.grabPeg;
        this.hasJumped = true;
        // seed both arm angles from current spin position
        this.leftAngle = this.spinAngle;
        this.state     = 'flying';
        this.rndPlay('gnome1', 'gnome2');
    }

    private checkGrab ()
    {
        const tips:  {x: number; y: number}[] = this.flyingHandTips();
        const names: GrabLimb[] = ['leftHand', 'rightHand'];

        for (let i = 0; i < 2; i++) {
            const t = tips[i];
            for (const peg of this.pegs) {
                if (peg === this.lastPeg) continue;
                const dx = t.x - peg.x;
                const dy = t.y - peg.y;
                if (dx * dx + dy * dy < GRAB_R * GRAB_R) {
                    this.attach(peg, names[i]);
                    return;
                }
            }
        }
    }

    private attach (peg: Peg, limb: GrabLimb)
    {
        this.grabPeg  = peg;
        this.grabLimb = limb;

        const dx = this.bx - peg.x;
        const dy = this.by - peg.y;
        this.pendLen   = Math.max(20, Math.sqrt(dx * dx + dy * dy));
        this.pendAngle = Math.atan2(dx, dy);

        const tvx    =  Math.cos(this.pendAngle);
        const tvy    = -Math.sin(this.pendAngle);
        this.pendVel = (this.vx * tvx + this.vy * tvy) / this.pendLen;

        this.gripDamp       = 0.82;           // strong initial damping on grab
        this.gripSlideTimer = 0;
        this.gripSlide      = 0;
        this.spinAngle      = Math.PI / 2;   // free hand hangs straight down
        this.leftAngle      = Math.PI / 2;
        this.state          = 'hanging';
        this.rndPlay('oof1', 'oof2');
    }

    // ─── helpers ──────────────────────────────────────────────────────────────

    private updateBody ()
    {
        this.bx = this.grabPeg.x + Math.sin(this.pendAngle) * this.pendLen;
        this.by = this.grabPeg.y + this.gripSlide + Math.cos(this.pendAngle) * this.pendLen;
    }

    private flyingHandTips (): {x: number; y: number}[]
    {
        const { bx, by, spinAngle, leftAngle } = this;
        const sY = by - BODY_H / 2 + 8;
        const aL = ARM_U + ARM_L;
        return [
            { x: bx - 13 + Math.cos(leftAngle)  * aL, y: sY + Math.sin(leftAngle)  * aL }, // leftHand
            { x: bx + 13 + Math.cos(spinAngle)  * aL, y: sY + Math.sin(spinAngle)  * aL }, // rightHand
        ];
    }

    private triggerCelebration (elapsed: number)
    {
        this.celebrating      = true;
        this.celebrateTimer   = 0;
        this.celebrateElapsed = elapsed;
        this.rndPlay('woohoo1', 'woohoo2');

        // land the kabouter on the platform
        this.vy = 0; this.vx = 0;
        this.by = PLAT_Y - BODY_H / 2;

        const cx = (PLAT_X1 + PLAT_X2) / 2;
        const colors = [0xff3333, 0x33cc44, 0x3377ff, 0xffcc00, 0xff55ff, 0x00ccdd, 0xff8800, 0xffffff];

        for (const color of colors) {
            const emitter = this.add.particles(cx, PLAT_Y - 10, 'confettiRect', {
                x:          { min: -WORLD_W * 0.4, max: WORLD_W * 0.4 },
                speedX:     { min: -220, max: 220 },
                speedY:     { min: -700, max: -200 },
                gravityY:   500,
                rotate:     { min: 0, max: 360 },
                lifespan:   3500,
                scale:      { min: 0.7, max: 2.0 },
                tint:       color,
            });
            emitter.explode(25, cx, PLAT_Y - 10);
        }
    }

    // ─── parakeets ────────────────────────────────────────────────────────────

    private updateParakeets (deltaMs: number)
    {
        // move existing parakeets
        const dt = deltaMs / 1000;
        for (let i = this.parakeets.length - 1; i >= 0; i--) {
            const p = this.parakeets[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.wingPhase    += dt * 9;
            p.hitCooldown   = Math.max(0, p.hitCooldown - deltaMs);
            if (p.x < -120 || p.x > WORLD_W + 120) this.parakeets.splice(i, 1);
        }
        this.checkParakeetCollisions();

        // spawn timer — interval gradient: 20 s at bottom, 5 s at top
        this.parakeetTimer += deltaMs;
        if (this.parakeetTimer >= this.parakeetNext) {
            this.parakeetTimer = 0;
            const heightFrac   = Math.max(0, Math.min(1, 1 - this.by / WORLD_H));
            const baseInterval = 10000 - heightFrac * 7000;   // 10 000→3 000 ms
            // next interval with ±30 % jitter
            this.parakeetNext = baseInterval * (0.7 + Math.random() * 0.6);
            this.spawnParakeet();
        }
    }

    /** Squared distance from point (px,py) to segment (ax,ay)→(bx2,by2). */
    private segDistSq (px: number, py: number, ax: number, ay: number, bx2: number, by2: number): number
    {
        const ddx = bx2 - ax, ddy = by2 - ay;
        const lenSq = ddx * ddx + ddy * ddy;
        if (lenSq === 0) { const ex = px-ax, ey = py-ay; return ex*ex + ey*ey; }
        const t  = Math.max(0, Math.min(1, ((px-ax)*ddx + (py-ay)*ddy) / lenSq));
        const cx = px - (ax + t*ddx), cy = py - (ay + t*ddy);
        return cx*cx + cy*cy;
    }

    private parakeetHitsKabouter (px: number, py: number): boolean
    {
        const { bx, by } = this;
        const sY   = by - BODY_H / 2 + 6;   // shoulder Y
        const hY   = by + BODY_H / 2 - 4;   // hip Y

        // torso
        const tx = px-bx, ty = py-by;
        if (tx*tx + ty*ty < 18*18) return true;

        // head
        const neckX = bx, neckY = by - BODY_H / 2;
        const hx = neckX + HEAD_LEN * Math.sin(this.headAngle);
        const hy = neckY - HEAD_LEN * Math.cos(this.headAngle);
        const hddx = px-hx, hddy = py-hy;
        if (hddx*hddx + hddy*hddy < 15*15) return true;

        // hat (cone above head)
        const hatCY = hy - 16;
        const hatDX = px-hx, hatDY = py-hatCY;
        if (hatDX*hatDX + hatDY*hatDY < 15*15) return true;

        // arms
        if (this.state === 'hanging') {
            const grabSX = bx + (this.grabLimb === 'rightHand' ?  11 : -11);
            if (this.segDistSq(px, py, grabSX, sY, this.grabPeg.x, this.grabPeg.y + this.gripSlide) < 10*10) return true;
            const freeSX = bx + (this.grabLimb === 'rightHand' ? -11 :  11);
            const fHX    = freeSX + Math.cos(this.spinAngle) * (ARM_U + ARM_L);
            const fHY    = sY     + Math.sin(this.spinAngle) * (ARM_U + ARM_L);
            if (this.segDistSq(px, py, freeSX, sY, fHX, fHY) < 10*10) return true;
        } else {
            const lHX = bx - 11 + Math.cos(this.leftAngle)  * (ARM_U + ARM_L);
            const lHY = sY      + Math.sin(this.leftAngle)  * (ARM_U + ARM_L);
            const rHX = bx + 11 + Math.cos(this.spinAngle)  * (ARM_U + ARM_L);
            const rHY = sY      + Math.sin(this.spinAngle)  * (ARM_U + ARM_L);
            if (this.segDistSq(px, py, bx-11, sY, lHX, lHY) < 10*10) return true;
            if (this.segDistSq(px, py, bx+11, sY, rHX, rHY) < 10*10) return true;
        }

        // legs
        const legs: [number, LegState][] = [[-1, this.legL], [1, this.legR]];
        for (const [side, leg] of legs) {
            const hipX = bx + side * 9;
            const kx   = hipX + LEG_U * Math.sin(leg[0]);
            const ky   = hY   + LEG_U * Math.cos(leg[0]);
            const fx   = kx   + LEG_L * Math.sin(leg[2]);
            const fy   = ky   + LEG_L * Math.cos(leg[2]);
            if (this.segDistSq(px, py, hipX, hY, kx, ky) < 9*9) return true;
            if (this.segDistSq(px, py, kx, ky, fx, fy)   < 9*9) return true;
        }

        return false;
    }

    private checkParakeetCollisions ()
    {
        if (this.celebrating) return;

        for (const p of this.parakeets) {
            if (p.hitCooldown > 0) continue;
            if (!this.parakeetHitsKabouter(p.x, p.y)) continue;

            // ── parakeet bounces: reverse horizontal, keep vertical ──
            p.vx *= -1;
            p.hitCooldown = 600;   // ms
            this.safePlay('parakeethit');

            if (this.state === 'hanging') {
                // knocked off peg — inherit pendulum tangential velocity + bird impact
                const tangLen  = this.pendVel * this.pendLen;
                const tvx      =  Math.cos(this.pendAngle) * tangLen;
                const tvy      = -Math.sin(this.pendAngle) * tangLen;
                this.vx        = p.vx * 0.65 + tvx;   // note: vx already reversed above
                this.vy        = p.vy * 0.65 + tvy;
                this.lastPeg   = this.grabPeg;
                this.spinAngle = Math.PI / 2;
                this.leftAngle = Math.PI / 2;
                this.wasSpace  = false;   // discard held-space so it can't trigger a launch
                this.state     = 'flying';
            } else {
                // mid-air — deflect trajectory
                this.vx += p.vx * 0.55;   // vx already reversed
                this.vy += p.vy * 0.55;
            }
        }
    }

    private spawnParakeet ()
    {
        const fromLeft = Math.random() < 0.5;
        const spawnX   = fromLeft ? -40 : WORLD_W + 40;

        // spawn at a random Y along the wall, aim straight at the kabouter body
        const spawnY = this.by + (Math.random() - 0.5) * 400;
        const dx     = Math.abs(this.bx - spawnX);
        const dy     = this.by - spawnY;
        const angle  = Math.atan2(dy, dx);   // direct line to kabouter, no clamp

        const speed = 200 + Math.random() * 100;
        this.parakeets.push({
            x:           spawnX,
            y:           spawnY,
            vx:          Math.cos(angle) * speed * (fromLeft ? 1 : -1),
            vy:          Math.sin(angle) * speed,
            wingPhase:   Math.random() * Math.PI * 2,
            hitCooldown: 0,
        });
        this.rndPlay('parakeet1', 'parakeet2');
    }

    private drawParakeets ()
    {
        const g      = this.gfx;
        const camY   = this.cameras.main.scrollY;
        const camH   = this.cameras.main.height;

        for (const p of this.parakeets) {
            if (p.y < camY - 60 || p.y > camY + camH + 60) continue;

            const right = p.vx > 0;
            const dir   = right ? 1 : -1;
            const flapA = Math.sin(p.wingPhase);       // -1..1
            const flapB = Math.sin(p.wingPhase + 1.2); // offset second wing

            // ── tail ──
            g.fillStyle(0x2299aa);
            g.lineStyle(1, 0x115566);
            const tx = p.x - dir * 10;
            g.fillTriangle(tx, p.y - 3, tx - dir * 10, p.y - 6, tx - dir * 10, p.y + 4);
            g.strokeTriangle(tx, p.y - 3, tx - dir * 10, p.y - 6, tx - dir * 10, p.y + 4);

            // ── upper wing (behind body) ──
            const wTipX = p.x - dir * 6 + (right ? -1 : 1) * 3;
            const wTipY = p.y - 12 + flapA * 10;
            g.fillStyle(0x33bb55);
            g.lineStyle(1, 0x227733);
            g.fillTriangle(p.x - dir * 4, p.y + 2, p.x + dir * 6, p.y - 1, wTipX, wTipY);
            g.strokeTriangle(p.x - dir * 4, p.y + 2, p.x + dir * 6, p.y - 1, wTipX, wTipY);

            // ── body ──
            g.fillStyle(0x44cc55);
            g.lineStyle(1.5, 0x227733);
            g.fillEllipse(p.x, p.y, 22, 11);
            g.strokeEllipse(p.x, p.y, 22, 11);

            // ── lower wing tip (in front) ──
            const w2X = p.x + (right ? -2 : 2);
            const w2Y = p.y - 8 + flapB * 7;
            g.fillStyle(0x55ee77);
            g.lineStyle(1, 0x33aa55);
            g.fillTriangle(p.x - dir * 2, p.y + 1, p.x + dir * 5, p.y - 1, w2X, w2Y);

            // ── head ──
            const hx = p.x + dir * 10;
            g.fillStyle(0x44cc55);
            g.lineStyle(1.5, 0x227733);
            g.fillCircle(hx, p.y - 2, 6);
            g.strokeCircle(hx, p.y - 2, 6);

            // ── eye ──
            g.fillStyle(0x111111);
            g.fillCircle(hx + dir * 2, p.y - 3, 1.5);

            // ── beak ──
            g.fillStyle(0xffbb22);
            g.lineStyle(1, 0xcc8800);
            const bx2 = hx + dir * 6;
            g.fillTriangle(hx + dir * 5, p.y - 3, bx2 + dir * 4, p.y - 1, bx2 + dir * 4, p.y + 2);

            // ── cheek patch ──
            g.fillStyle(0xffaaaa, 0.7);
            g.fillCircle(hx - dir * 1, p.y, 2.5);
        }
    }

    // ─── peg generation ───────────────────────────────────────────────────────

    private generatePegs ()
    {
        const cols     = 5;
        const rows     = 30;
        const marginX  = 90;
        const topY     = 80;
        const botY     = WORLD_H - 80;
        const spacingX = (WORLD_W - marginX * 2) / (cols - 1);
        const spacingY = (botY - topY) / (rows - 1);

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (r > 0 && Math.random() < 0.12) continue;
                const stagger = (r % 2 === 1) ? spacingX / 2 : 0;
                const x = marginX + c * spacingX + stagger + (Math.random() - 0.5) * 55;
                const y = topY + r * spacingY + (Math.random() - 0.5) * 28;
                const px = Math.max(30, Math.min(WORLD_W - 30, x));
                const py = Math.max(30, Math.min(WORLD_H - 30, y));
                // clear pegs near the top only within the lounge + 2 lounge-widths to the right
                const platW = PLAT_X2 - PLAT_X1;
                if (py < PLAT_Y + PLAT_H + 30 && px <= PLAT_X2 + 2 * platW) continue;
                const side = Math.random() < 0.5 ? 0 : Math.PI;
                const dir  = side + (Math.random() - 0.5) * 0.7; // ±~20° tilt from horizontal
                this.pegs.push({ x: px, y: py, dir });
            }
        }
        this.pegs.sort((a, b) => b.y - a.y);
    }

    // ─── drawing ──────────────────────────────────────────────────────────────

    private draw ()
    {
        this.gfx.clear();
        this.drawBar();
        this.drawLeaves();
        this.drawParakeets();
        this.drawKabouter();
    }

    private drawBar ()
    {
        const g    = this.gfx;
        const camY = this.cameras.main.scrollY;
        const camH = this.cameras.main.height;
        if (PLAT_Y + PLAT_H < camY - 100 || PLAT_Y - 130 > camY + camH) return;

        const platW = PLAT_X2 - PLAT_X1;
        const cx    = (PLAT_X1 + PLAT_X2) / 2;

        // ── platform floor — solid white, thick black outline ───────────────
        g.fillStyle(0xffffff);
        g.lineStyle(3, 0x000000);
        g.fillRect(PLAT_X1, PLAT_Y, platW, PLAT_H);
        g.strokeRect(PLAT_X1, PLAT_Y, platW, PLAT_H);
        // floor planks (thin lines)
        g.lineStyle(1, 0xaaaaaa);
        for (let lx = PLAT_X1 + 28; lx < PLAT_X2 - 4; lx += 28) {
            g.beginPath(); g.moveTo(lx, PLAT_Y + 2); g.lineTo(lx, PLAT_Y + PLAT_H - 2); g.strokePath();
        }

        // ── back wall ────────────────────────────────────────────────────────
        const wallY = PLAT_Y - 62;
        g.fillStyle(0xfafafa);
        g.lineStyle(3, 0x000000);
        g.fillRect(PLAT_X1, wallY, platW, 62);
        g.strokeRect(PLAT_X1, wallY, platW, 62);
        // wall panel lines (cartoon wallpaper effect)
        g.lineStyle(1, 0xcccccc);
        g.beginPath(); g.moveTo(PLAT_X1, wallY + 20); g.lineTo(PLAT_X2, wallY + 20); g.strokePath();
        g.beginPath(); g.moveTo(PLAT_X1, wallY + 40); g.lineTo(PLAT_X2, wallY + 40); g.strokePath();

        // ── bar counter surface ───────────────────────────────────────────────
        g.fillStyle(0xe8e8e8);
        g.lineStyle(2.5, 0x000000);
        g.fillRect(PLAT_X1, PLAT_Y - 13, platW, 13);
        g.strokeRect(PLAT_X1, PLAT_Y - 13, platW, 13);
        // counter edge shine
        g.lineStyle(1.5, 0xffffff);
        g.beginPath(); g.moveTo(PLAT_X1 + 1, PLAT_Y - 12); g.lineTo(PLAT_X2 - 1, PLAT_Y - 12); g.strokePath();

        // ── bottles on back shelf ─────────────────────────────────────────────
        const bottleBaseY  = PLAT_Y - 13;
        const numBottles   = 5;
        const bottleSpread = platW - 30;
        for (let i = 0; i < numBottles; i++) {
            const bx  = PLAT_X1 + 15 + (i / (numBottles - 1)) * bottleSpread;
            const alt = i % 2;   // alternate tall/squat
            const bH  = alt ? 22 : 28;
            // bottle body
            g.fillStyle(alt ? 0xdddddd : 0xffffff);
            g.lineStyle(2, 0x000000);
            g.fillRoundedRect(bx - 4, bottleBaseY - bH, 8, bH, 2);
            g.strokeRoundedRect(bx - 4, bottleBaseY - bH, 8, bH, 2);
            // bottle neck
            g.fillRect(bx - 2, bottleBaseY - bH - 9, 4, 10);
            g.strokeRect(bx - 2, bottleBaseY - bH - 9, 4, 10);
            // label (cartoon rectangle)
            g.fillStyle(0x000000, 0.12);
            g.fillRect(bx - 3, bottleBaseY - bH + 4, 6, 8);
            g.lineStyle(1, 0x000000);
            g.strokeRect(bx - 3, bottleBaseY - bH + 4, 6, 8);
        }

        // ── two cocktail glasses on the counter ───────────────────────────────
        this.drawCocktailGlass(g, cx - 30, PLAT_Y - 13);
        this.drawCocktailGlass(g, cx + 30, PLAT_Y - 13);
    }

    private drawCocktailGlass (g: Phaser.GameObjects.Graphics, cx: number, baseY: number)
    {
        const bW = 11;   // half-width of rim
        const bH = 14;   // bowl height
        const sH = 11;   // stem height
        const fW =  8;   // half-width of base

        const rimY  = baseY - sH - bH;
        const apexY = baseY - sH;

        // liquid fill — light gray (B&W)
        g.fillStyle(0xcccccc);
        g.fillTriangle(cx, apexY, cx - bW, rimY, cx + bW, rimY);

        // glass outline — thick black cartoon lines
        g.lineStyle(2.5, 0x000000);
        g.beginPath();
        g.moveTo(cx - bW, rimY);
        g.lineTo(cx,      apexY);
        g.lineTo(cx + bW, rimY);
        g.strokePath();
        g.beginPath(); g.moveTo(cx - bW, rimY);  g.lineTo(cx + bW, rimY);  g.strokePath();
        g.beginPath(); g.moveTo(cx,      apexY); g.lineTo(cx,      baseY); g.strokePath();
        g.beginPath(); g.moveTo(cx - fW, baseY); g.lineTo(cx + fW, baseY); g.strokePath();

        // shine line inside bowl (cartoon highlight)
        g.lineStyle(1.5, 0xffffff);
        g.beginPath(); g.moveTo(cx - bW + 3, rimY + 3); g.lineTo(cx - 3, apexY + 5); g.strokePath();

        // garnish — black cherry on a stick
        g.lineStyle(1.5, 0x000000);
        g.beginPath(); g.moveTo(cx + bW - 2, rimY); g.lineTo(cx + bW - 5, rimY - 7); g.strokePath();
        g.fillStyle(0x111111);
        g.fillCircle(cx + bW - 5, rimY - 10, 4);
        g.lineStyle(1, 0x000000);
        g.strokeCircle(cx + bW - 5, rimY - 10, 4);
    }

    private drawLeaves ()
    {
        const g    = this.gfx;
        const camY = this.cameras.main.scrollY;
        const camH = this.cameras.main.height;
        for (const p of this.pegs) {
            if (p.y < camY - 80 || p.y > camY + camH + 80) continue;
            const isGrab  = this.state === 'hanging' && p === this.grabPeg;
            const slideY  = isGrab ? this.gripSlide : 0;
            const t       = isGrab ? Math.min(1, this.gripSlideTimer / GRIP_DURATION) : 0;
            this.drawLeaf(g, p.x, p.y, p.dir, slideY, t);
        }
    }

    /** Draw one shamrock. `slideY` pulls the head down; `t` 0→1 shows wilting/tearing. */
    private drawLeaf (
        g: Phaser.GameObjects.Graphics,
        px: number, py: number,
        dir: number,
        slideY: number, t: number
    ) {
        const STEM_LEN  = 26;   // stem from wall to shamrock centre
        const LOBE_R    = 8.5;  // radius of each heart lobe
        const LOBE_DIST = 6.5;  // distance from centre to each lobe centre

        // Wall-attachment nub
        const nubX = px - Math.cos(dir) * STEM_LEN;
        const nubY = py - Math.sin(dir) * STEM_LEN;

        // Shamrock centre (grab point, pulled down by slide)
        const cx = px;
        const cy = py + slideY;

        // Stem direction unit vector (nub → centre)
        const sdx = cx - nubX;
        const sdy = cy - nubY;
        const sLen = Math.sqrt(sdx * sdx + sdy * sdy) || 1;
        const snx  = sdx / sLen;
        const sny  = sdy / sLen;

        // Color: vivid shamrock green → yellow → brown as t rises
        const cr = Math.round(20  + 170 * t);
        const cg = Math.round(155 -  75 * t);
        const cb = Math.round(30  -  20 * t);
        const lobeCol    = (cr << 16) | (cg << 8) | cb;
        const outlineCol = t > 0.55 ? 0x7a4a00 : 0x1a5c10;
        const stemCol    = t > 0.55 ? 0x7a4a00 : 0x3a6010;

        // ── wall nub ──
        g.fillStyle(0x5a3a1a);
        g.fillCircle(nubX, nubY, 3.5);

        // ── stem ──
        g.lineStyle(2.5, stemCol);
        g.beginPath(); g.moveTo(nubX, nubY); g.lineTo(cx, cy); g.strokePath();

        // ── three heart-shaped lobes at 120° intervals ──
        // Lobes fan out perpendicular to the stem; first lobe points "sideways".
        const baseAngle = Math.atan2(sny, snx) + Math.PI / 2;

        // Draw all filled circles first so they blend into a trefoil
        g.fillStyle(lobeCol);
        for (let i = 0; i < 3; i++) {
            const a  = baseAngle + i * (2 * Math.PI / 3);
            const lx = cx + Math.cos(a) * LOBE_DIST;
            const ly = cy + Math.sin(a) * LOBE_DIST;
            g.fillCircle(lx, ly, LOBE_R);
        }

        // Outlines + midrib veins
        for (let i = 0; i < 3; i++) {
            const a  = baseAngle + i * (2 * Math.PI / 3);
            const lx = cx + Math.cos(a) * LOBE_DIST;
            const ly = cy + Math.sin(a) * LOBE_DIST;

            g.lineStyle(1.4, outlineCol);
            g.strokeCircle(lx, ly, LOBE_R);

            // Heart indent: small dark notch at the inner edge of each lobe
            const notchX = lx - Math.cos(a) * LOBE_R * 0.55;
            const notchY = ly - Math.sin(a) * LOBE_R * 0.55;
            g.fillStyle(outlineCol);
            g.fillCircle(notchX, notchY, 2.2);

            // Midrib from centre to lobe tip
            g.lineStyle(0.9, outlineCol);
            g.beginPath();
            g.moveTo(cx, cy);
            g.lineTo(lx + Math.cos(a) * LOBE_R * 0.75, ly + Math.sin(a) * LOBE_R * 0.75);
            g.strokePath();
        }

        // Centre dot to cover stem tip and tidy the trefoil junction
        g.fillStyle(lobeCol);
        g.fillCircle(cx, cy, 4);
        g.lineStyle(1, outlineCol);
        g.strokeCircle(cx, cy, 4);

        // ── stem tear marks appear above 65% ──
        if (t > 0.65) {
            const crack = (t - 0.65) / 0.35;
            // perpendicular to stem for the tear width
            const px2 = -sny * 4 * crack;
            const py2 =  snx * 4 * crack;
            const tearX = nubX + sdx * 0.4;
            const tearY = nubY + sdy * 0.4;
            g.lineStyle(1.5, 0x8b3a00);
            g.beginPath();
            g.moveTo(tearX - px2, tearY - py2);
            g.lineTo(tearX + px2, tearY + py2);
            g.strokePath();
            if (crack > 0.45) {
                const t2X = nubX + sdx * 0.65;
                const t2Y = nubY + sdy * 0.65;
                g.beginPath();
                g.moveTo(t2X - px2 * 0.6, t2Y - py2 * 0.6);
                g.lineTo(t2X + px2 * 0.6, t2Y + py2 * 0.6);
                g.strokePath();
            }
        }
    }

    private drawKabouter ()
    {
        const g  = this.gfx;
        const { bx, by, grabPeg, grabLimb, pendAngle, spinAngle } = this;
        const sY = by - BODY_H / 2 + 6;   // shoulder Y
        const hY = by + BODY_H / 2 - 4;   // hip Y

        // ── legs (ragdoll, drawn first so body overlaps) ──
        this.drawLegs(hY);

        // ── arms with hook-on-stick ──
        if (this.state === 'hanging') {
            // grabbing arm: hook on the stretched leaf tip
            const grabSX   = bx + (grabLimb === 'rightHand' ? 11 : -11);
            const gripTipX = grabPeg.x;
            const gripTipY = grabPeg.y + this.gripSlide;
            const gDir     = Math.atan2(gripTipY - sY, gripTipX - grabSX);
            const gEX      = grabSX + Math.cos(gDir) * ARM_U;
            const gEY      = sY     + Math.sin(gDir) * ARM_U;
            g.lineStyle(3.5, 0x111111);
            g.beginPath(); g.moveTo(grabSX, sY); g.lineTo(gEX, gEY); g.lineTo(gripTipX, gripTipY); g.strokePath();
            this.drawHook(gripTipX, gripTipY, gDir);

            // free arm: spins with hook dangling at tip
            const freeSX = bx + (grabLimb === 'rightHand' ? -11 : 11);
            const fEX    = freeSX + Math.cos(spinAngle) * ARM_U;
            const fEY    = sY     + Math.sin(spinAngle) * ARM_U;
            const fHX    = fEX    + Math.cos(spinAngle) * ARM_L;
            const fHY    = fEY    + Math.sin(spinAngle) * ARM_L;
            g.lineStyle(3.5, 0x111111);
            g.beginPath(); g.moveTo(freeSX, sY); g.lineTo(fEX, fEY); g.lineTo(fHX, fHY); g.strokePath();
            this.drawHook(fHX, fHY, spinAngle);

        } else {
            // flying: both arms spin wildly
            const lEX = bx - 11 + Math.cos(this.leftAngle) * ARM_U;
            const lEY = sY       + Math.sin(this.leftAngle) * ARM_U;
            const lHX = lEX      + Math.cos(this.leftAngle) * ARM_L;
            const lHY = lEY      + Math.sin(this.leftAngle) * ARM_L;
            g.lineStyle(3.5, 0x111111);
            g.beginPath(); g.moveTo(bx - 11, sY); g.lineTo(lEX, lEY); g.lineTo(lHX, lHY); g.strokePath();
            this.drawHook(lHX, lHY, this.leftAngle);

            const rEX = bx + 11 + Math.cos(this.spinAngle) * ARM_U;
            const rEY = sY       + Math.sin(this.spinAngle) * ARM_U;
            const rHX = rEX      + Math.cos(this.spinAngle) * ARM_L;
            const rHY = rEY      + Math.sin(this.spinAngle) * ARM_L;
            g.lineStyle(3.5, 0x111111);
            g.beginPath(); g.moveTo(bx + 11, sY); g.lineTo(rEX, rEY); g.lineTo(rHX, rHY); g.strokePath();
            this.drawHook(rHX, rHY, this.spinAngle);
        }

        // ── body (round gnome torso) ──
        g.fillStyle(0xffffff);
        g.lineStyle(3, 0x111111);
        g.fillRoundedRect(bx - BODY_W / 2, by - BODY_H / 2, BODY_W, BODY_H, 11);
        g.strokeRoundedRect(bx - BODY_W / 2, by - BODY_H / 2, BODY_W, BODY_H, 11);
        // belt
        g.fillStyle(0x111111);
        g.fillRect(bx - BODY_W / 2 + 3, by + 1, BODY_W - 6, 5);
        // belt buckle
        g.fillStyle(0xffffff);
        g.lineStyle(1.5, 0x111111);
        g.fillRect(bx - 4, by + 1, 8, 5);
        g.strokeRect(bx - 4, by + 1, 8, 5);

        // ── neck + head (spring-pendulum) ──
        const neckX = bx;
        const neckY = by - BODY_H / 2;
        const hx    = neckX + HEAD_LEN * Math.sin(this.headAngle);
        const hy    = neckY - HEAD_LEN * Math.cos(this.headAngle);
        g.lineStyle(3, 0x111111);
        g.beginPath(); g.moveTo(neckX, neckY); g.lineTo(hx, hy); g.strokePath();
        this.drawKaboterHead(hx, hy);
    }

    private drawLegs (hipY: number)
    {
        const g = this.gfx;
        const legs: [number, LegState][] = [[-1, this.legL], [1, this.legR]];

        for (const [side, leg] of legs) {
            const hipX = this.bx + side * 9;
            const φu   = leg[0];
            const φl   = leg[2];

            const kx = hipX  + LEG_U * Math.sin(φu);
            const ky = hipY  + LEG_U * Math.cos(φu);
            const fx = kx    + LEG_L * Math.sin(φl);
            const fy = ky    + LEG_L * Math.cos(φl);

            g.lineStyle(5, 0x111111);
            g.beginPath(); g.moveTo(hipX, hipY); g.lineTo(kx, ky); g.lineTo(fx, fy); g.strokePath();
            // stubby gnome boot
            g.fillStyle(0x111111); g.lineStyle(1.5, 0x111111);
            g.fillRoundedRect(fx - 5, fy - 3, 10, 6, 3);
        }
    }

    private drawHook (tipX: number, tipY: number, dir: number)
    {
        const g = this.gfx;
        // arc-based hook: 270° curve forming a J shape
        const hookR = 5;
        const perpA = dir + Math.PI / 2;
        const cX    = tipX + Math.cos(perpA) * hookR;
        const cY    = tipY + Math.sin(perpA) * hookR;
        const startA = dir - Math.PI / 2;  // from center back to tip
        g.lineStyle(2.5, 0x111111);
        g.beginPath();
        g.arc(cX, cY, hookR, startA, startA + Math.PI * 1.5, false);
        g.strokePath();
    }

    private drawKaboterHead (hx: number, hy: number)
    {
        const g      = this.gfx;
        const headR  = 14;
        const brimY  = hy - headR + 3;

        // ── pointy hat cone (draw behind head) ──
        g.fillStyle(0xcc1111);
        g.lineStyle(2.5, 0x111111);
        // slight tilt: apex offset a few pixels right
        g.fillTriangle(hx - 12, brimY, hx + 12, brimY, hx + 4, hy - headR - 24);
        g.strokeTriangle(hx - 12, brimY, hx + 12, brimY, hx + 4, hy - headR - 24);
        // hat stripe
        g.lineStyle(1.5, 0x888888);
        g.beginPath();
        g.moveTo(hx - 7, brimY - 6);
        g.lineTo(hx + 6, brimY - 6);
        g.strokePath();

        // ── hat brim ──
        g.fillStyle(0x111111);
        g.fillRect(hx - 15, brimY - 5, 30, 6);
        g.lineStyle(1.5, 0x111111);
        g.strokeRect(hx - 15, brimY - 5, 30, 6);

        // ── head circle ──
        g.fillStyle(0xffffff);
        g.lineStyle(2.5, 0x111111);
        g.fillCircle(hx, hy, headR);
        g.strokeCircle(hx, hy, headR);

        // ── eyes ──
        g.fillStyle(0x111111);
        g.fillCircle(hx - 4, hy - 3, 2.5);
        g.fillCircle(hx + 4, hy - 3, 2.5);

        // ── rosy cheeks ──
        g.fillStyle(0xcccccc);
        g.fillCircle(hx - 7, hy + 1, 3);
        g.fillCircle(hx + 7, hy + 1, 3);

        // ── nose ──
        g.fillStyle(0xdddddd);
        g.lineStyle(1.5, 0x111111);
        g.fillCircle(hx, hy + 2, 3.5);
        g.strokeCircle(hx, hy + 2, 3.5);

        // ── beard (fluffy triangle below head) ──
        const beardY = hy + headR - 3;
        g.fillStyle(0xffffff);
        g.lineStyle(2, 0x111111);
        g.fillTriangle(hx - 11, beardY, hx + 11, beardY, hx, beardY + 20);
        g.strokeTriangle(hx - 11, beardY, hx + 11, beardY, hx, beardY + 20);
        // beard texture
        g.lineStyle(1, 0x999999);
        g.beginPath(); g.moveTo(hx - 6, beardY + 2); g.lineTo(hx - 3, beardY + 14); g.strokePath();
        g.beginPath(); g.moveTo(hx,     beardY + 2); g.lineTo(hx,     beardY + 17); g.strokePath();
        g.beginPath(); g.moveTo(hx + 6, beardY + 2); g.lineTo(hx + 3, beardY + 14); g.strokePath();
    }
}
