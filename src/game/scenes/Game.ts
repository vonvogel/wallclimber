import { Scene } from 'phaser';

const WORLD_W   = 1024;
const WORLD_H   = 2400;
const PEG_R     = 9;
const GRAB_R    = 24;
const GRAVITY   = 900;
const DAMPING   = 0.992;
const LEG_DAMP  = 0.95;
const SPIN_SPD  = Math.PI * 2;
const BODY_H    = 38;
const BODY_W    = 26;
const ARM_U     = 25;
const ARM_L     = 22;
const LEG_U     = 24;
const LEG_L     = 21;

type GameState = 'hanging' | 'flying';
type GrabLimb  = 'leftHand' | 'rightHand';

interface Peg { x: number; y: number; }

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

    private spaceKey!: Phaser.Input.Keyboard.Key;
    private wasSpace:  boolean = false;

    constructor () { super('Game'); }

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

        this.generatePegs();

        const wall = this.add.image(WORLD_W / 2, WORLD_H / 2, 'greenwall');
        wall.setDisplaySize(WORLD_W, WORLD_H);

        this.gfx = this.add.graphics();
        this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);

        this.hudLeft = this.add.text(12, 12, '[HOLD SPACE to spin, RELEASE to jump]', {
            fontFamily: 'Arial', fontSize: 15, color: '#ffffff',
            stroke: '#000000', strokeThickness: 3
        }).setScrollFactor(0).setDepth(10);

        this.hudText = this.add.text(WORLD_W - 12, 12, '', {
            fontFamily: 'Arial Black', fontSize: 22, color: '#ffff00',
            stroke: '#000000', strokeThickness: 5,
            align: 'right'
        }).setScrollFactor(0).setDepth(10).setOrigin(1, 0);

        const startPegs = this.pegs.filter(p => p.y >= WORLD_H - 300 && p.y <= WORLD_H - 200);
        this.grabPeg = startPegs.length > 0
            ? startPegs[Math.floor(Math.random() * startPegs.length)]
            : this.pegs[0];
        this.updateBody();

        this.cameras.main.centerOn(this.bx, this.by);
        this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    }

    update (_time: number, delta: number)
    {
        const dt    = Math.min(delta / 1000, 0.05);
        const space = this.spaceKey.isDown;

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
        const θ = this.pendAngle, ω = this.pendVel, L = this.pendLen;
        const pendAcc = -(GRAVITY / L) * Math.sin(θ);
        this.pendVel += pendAcc * dt;
        this.pendVel *= DAMPING;
        this.pendAngle += this.pendVel * dt;
        this.updateBody();

        // body acceleration in screen coords (y downward)
        const bodyAx = L * (pendAcc * Math.cos(θ) - ω * ω * Math.sin(θ));
        const bodyAy = L * (-pendAcc * Math.sin(θ) - ω * ω * Math.cos(θ));
        this.stepLeg(this.legL, dt, bodyAx, bodyAy);
        this.stepLeg(this.legR, dt, bodyAx, bodyAy);

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
        if (this.by > WORLD_H + 200) { this.scene.start('GameOver', { score: this.bestPct }); return; }

        // both arms spin wildly to catch a peg
        this.spinAngle += SPIN_SPD * dt;   // right arm clockwise
        this.leftAngle -= SPIN_SPD * dt;   // left arm counter-clockwise

        // body in free fall → effective gravity in body frame = 0 → legs gently drift
        this.stepLeg(this.legL, dt, 0, GRAVITY);
        this.stepLeg(this.legR, dt, 0, GRAVITY);

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

    private launch ()
    {
        const tangLen = this.pendVel * this.pendLen;
        const tvx     =  Math.cos(this.pendAngle) * tangLen;
        const tvy     = -Math.sin(this.pendAngle) * tangLen;

        const speed = 700;
        this.vx = Math.cos(this.spinAngle) * speed + tvx;
        this.vy = Math.sin(this.spinAngle) * speed + tvy;
        this.lastPeg   = this.grabPeg;
        // seed both arm angles from current spin position
        this.leftAngle = this.spinAngle;
        this.state     = 'flying';
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

        this.spinAngle = Math.PI / 2;   // free hand hangs straight down
        this.leftAngle = Math.PI / 2;
        this.state     = 'hanging';
    }

    // ─── helpers ──────────────────────────────────────────────────────────────

    private updateBody ()
    {
        this.bx = this.grabPeg.x + Math.sin(this.pendAngle) * this.pendLen;
        this.by = this.grabPeg.y + Math.cos(this.pendAngle) * this.pendLen;
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
                this.pegs.push({
                    x: Math.max(30, Math.min(WORLD_W - 30, x)),
                    y: Math.max(30, Math.min(WORLD_H - 30, y)),
                });
            }
        }
        this.pegs.sort((a, b) => b.y - a.y);
    }

    // ─── drawing ──────────────────────────────────────────────────────────────

    private draw ()
    {
        this.gfx.clear();
        this.drawPegs();
        this.drawMonkey();
    }

    private drawPegs ()
    {
        const g    = this.gfx;
        const camY = this.cameras.main.scrollY;
        const camH = this.cameras.main.height;
        for (const p of this.pegs) {
            if (p.y < camY - 30 || p.y > camY + camH + 30) continue;
            g.fillStyle(0xffffff);
            g.lineStyle(2.5, 0x111111);
            g.fillCircle(p.x, p.y, PEG_R);
            g.strokeCircle(p.x, p.y, PEG_R);
            g.lineStyle(1.5, 0x333333);
            g.beginPath(); g.moveTo(p.x - 4, p.y); g.lineTo(p.x + 4, p.y); g.strokePath();
            g.beginPath(); g.moveTo(p.x, p.y - 4); g.lineTo(p.x, p.y + 4); g.strokePath();
        }
    }

    private drawMonkey ()
    {
        const g  = this.gfx;
        const { bx, by, grabPeg, grabLimb, pendAngle, spinAngle } = this;
        const sY = by - BODY_H / 2 + 8;   // shoulder Y
        const hY = by + BODY_H / 2 - 5;   // hip Y

        // ── legs (always ragdoll, drawn first so body overlaps) ──
        this.drawLegs(hY);

        // ── arms ──
        if (this.state === 'hanging') {
            // grabbing arm: two-segment stretched toward peg
            const grabSX = bx + (grabLimb === 'rightHand' ? 13 : -13);
            const gDir   = Math.atan2(grabPeg.y - sY, grabPeg.x - grabSX);
            const gEX    = grabSX + Math.cos(gDir) * ARM_U;
            const gEY    = sY     + Math.sin(gDir) * ARM_U;
            g.lineStyle(4, 0x111111);
            g.beginPath(); g.moveTo(grabSX, sY); g.lineTo(gEX, gEY); g.lineTo(grabPeg.x, grabPeg.y); g.strokePath();

            // free arm: spins (or hangs down at rest)
            const freeSX = bx + (grabLimb === 'rightHand' ? -13 : 13);
            const fEX    = freeSX + Math.cos(spinAngle) * ARM_U;
            const fEY    = sY     + Math.sin(spinAngle) * ARM_U;
            const fHX    = fEX    + Math.cos(spinAngle) * ARM_L;
            const fHY    = fEY    + Math.sin(spinAngle) * ARM_L;
            g.lineStyle(4, 0x111111);
            g.beginPath(); g.moveTo(freeSX, sY); g.lineTo(fEX, fEY); g.lineTo(fHX, fHY); g.strokePath();
            g.fillStyle(0xffffff); g.lineStyle(2, 0x111111);
            g.fillCircle(fHX, fHY, 5); g.strokeCircle(fHX, fHY, 5);

        } else {
            // flying: both arms spin wildly
            const lEX = bx - 13 + Math.cos(this.leftAngle) * ARM_U;
            const lEY = sY       + Math.sin(this.leftAngle) * ARM_U;
            const lHX = lEX      + Math.cos(this.leftAngle) * ARM_L;
            const lHY = lEY      + Math.sin(this.leftAngle) * ARM_L;
            g.lineStyle(4, 0x111111);
            g.beginPath(); g.moveTo(bx - 13, sY); g.lineTo(lEX, lEY); g.lineTo(lHX, lHY); g.strokePath();
            g.fillStyle(0xffffff); g.lineStyle(2, 0x111111);
            g.fillCircle(lHX, lHY, 5); g.strokeCircle(lHX, lHY, 5);

            const rEX = bx + 13 + Math.cos(this.spinAngle) * ARM_U;
            const rEY = sY       + Math.sin(this.spinAngle) * ARM_U;
            const rHX = rEX      + Math.cos(this.spinAngle) * ARM_L;
            const rHY = rEY      + Math.sin(this.spinAngle) * ARM_L;
            g.lineStyle(4, 0x111111);
            g.beginPath(); g.moveTo(bx + 13, sY); g.lineTo(rEX, rEY); g.lineTo(rHX, rHY); g.strokePath();
            g.fillStyle(0xffffff); g.lineStyle(2, 0x111111);
            g.fillCircle(rHX, rHY, 5); g.strokeCircle(rHX, rHY, 5);
        }

        // ── body ──
        g.fillStyle(0xffffff);
        g.lineStyle(3, 0x111111);
        g.fillRoundedRect(bx - BODY_W / 2, by - BODY_H / 2, BODY_W, BODY_H, 7);
        g.strokeRoundedRect(bx - BODY_W / 2, by - BODY_H / 2, BODY_W, BODY_H, 7);
        g.lineStyle(1, 0x888888);
        for (let i = 1; i < 4; i++) {
            const ly = by - BODY_H / 2 + i * (BODY_H / 4);
            g.beginPath();
            g.moveTo(bx - BODY_W / 2 + 5, ly);
            g.lineTo(bx + BODY_W / 2 - 5, ly);
            g.strokePath();
        }

        // ── neck + head ──
        const bob = this.state === 'hanging' ? Math.sin(pendAngle * 3.5) * 2.5 : 0;
        const hx  = bx;
        const hy  = by - BODY_H / 2 - 16 + bob;
        g.lineStyle(3, 0x111111);
        g.beginPath(); g.moveTo(bx, by - BODY_H / 2); g.lineTo(hx, hy + 14); g.strokePath();
        this.drawHead(hx, hy);
    }

    private drawLegs (hipY: number)
    {
        const g = this.gfx;
        const legs: [number, LegState][] = [[-1, this.legL], [1, this.legR]];

        for (const [side, leg] of legs) {
            const hipX = this.bx + side * 9;
            const φu   = leg[0];
            const φl   = leg[2];

            const kx = hipX     + LEG_U * Math.sin(φu);
            const ky = hipY     + LEG_U * Math.cos(φu);
            const fx = kx       + LEG_L * Math.sin(φl);
            const fy = ky       + LEG_L * Math.cos(φl);

            g.lineStyle(4, 0x111111);
            g.beginPath(); g.moveTo(hipX, hipY); g.lineTo(kx, ky); g.lineTo(fx, fy); g.strokePath();
            g.fillStyle(0xffffff); g.lineStyle(1.5, 0x111111);
            g.fillCircle(fx, fy, 4); g.strokeCircle(fx, fy, 4);
        }
    }

    private drawHead (hx: number, hy: number)
    {
        const g = this.gfx;
        g.fillStyle(0xffffff);
        g.lineStyle(3, 0x111111);
        g.fillCircle(hx, hy, 15);
        g.strokeCircle(hx, hy, 15);
        g.fillStyle(0x111111);
        g.fillCircle(hx - 5, hy - 2, 3);
        g.fillCircle(hx + 5, hy - 2, 3);
        g.lineStyle(2, 0x111111);
        g.beginPath();
        g.arc(hx, hy + 4, 6, 0.25, Math.PI - 0.25);
        g.strokePath();
        g.fillStyle(0xffffff); g.lineStyle(2, 0x111111);
        g.fillCircle(hx - 14, hy, 4); g.strokeCircle(hx - 14, hy, 4);
        g.fillCircle(hx + 14, hy, 4); g.strokeCircle(hx + 14, hy, 4);
    }
}
