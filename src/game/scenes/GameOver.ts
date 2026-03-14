import { Scene } from 'phaser';

const STORAGE_KEY   = 'wallclimber_scores_v2';
const MAX_EACH      = 10;

interface ScoreEntry {
    name:   string;
    type:   'height' | 'skylounge';
    score?: number;   // height % — lower is worse
    time?:  number;   // seconds — lower is better (sky lounge only)
}

function formatTime (t: number): string {
    if (t < 60) return `${t.toFixed(1)}s`;
    const m = Math.floor(t / 60);
    const s = (t % 60).toFixed(1).padStart(4, '0');
    return `${m}m ${s}s`;
}

export class GameOver extends Scene
{
    private scoreType: 'height' | 'skylounge' = 'height';
    private score:     number = 0;   // percent OR seconds depending on type

    constructor () { super('GameOver'); }

    init (data: { score?: number; type?: string; time?: number })
    {
        if (data?.type === 'skylounge') {
            this.scoreType = 'skylounge';
            this.score     = data.time ?? 0;
        } else {
            this.scoreType = 'height';
            this.score     = data?.score ?? 0;
        }
    }

    create ()
    {
        const playerName: string = this.registry.get('playerName') || 'Anonymous';

        // ── persist score ──────────────────────────────────────────────────────
        const allScores   = this.loadScores();
        const newEntry: ScoreEntry = this.scoreType === 'skylounge'
            ? { name: playerName, type: 'skylounge', time: this.score }
            : { name: playerName, type: 'height',    score: this.score };

        allScores.push(newEntry);

        const skyScores  = allScores.filter(e => e.type === 'skylounge')
                                    .sort((a, b) => (a.time ?? 0) - (b.time ?? 0))
                                    .slice(0, MAX_EACH);
        const htScores   = allScores.filter(e => e.type !== 'skylounge')
                                    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
                                    .slice(0, MAX_EACH);

        this.saveScores([...skyScores, ...htScores]);

        // ── background ────────────────────────────────────────────────────────
        const W = this.scale.width;
        const H = this.scale.height;
        const cx = W / 2;   // horizontal centre in screen pixels

        this.cameras.main.setBackgroundColor(0x1a0a2e);
        const bg = this.add.image(cx, H / 2, 'background');
        bg.setDisplaySize(W, H);
        bg.setAlpha(0.15);

        // ── title ─────────────────────────────────────────────────────────────
        if (this.scoreType === 'skylounge') {
            this.add.text(cx, 48, '🍸  SKY LOUNGE!  🍸', {
                fontFamily: 'Arial Black', fontSize: 52, color: '#ffdd33',
                stroke: '#000000', strokeThickness: 8, align: 'center'
            }).setOrigin(0.5);
            this.add.text(cx, 118, `${playerName}  —  reached in  ${formatTime(this.score)}`, {
                fontFamily: 'Arial Black', fontSize: 24, color: '#ffffff',
                stroke: '#000000', strokeThickness: 5, align: 'center'
            }).setOrigin(0.5);
        } else {
            this.add.text(cx, 52, 'GAME OVER', {
                fontFamily: 'Arial Black', fontSize: 64, color: '#ff4444',
                stroke: '#000000', strokeThickness: 8, align: 'center'
            }).setOrigin(0.5);
            this.add.text(cx, 130, `${playerName}  —  ${this.score}% height`, {
                fontFamily: 'Arial Black', fontSize: 26, color: '#ffff00',
                stroke: '#000000', strokeThickness: 6, align: 'center'
            }).setOrigin(0.5);
        }

        // ── leaderboard ───────────────────────────────────────────────────────
        let nextY = 168;
        const gfx = this.add.graphics();

        if (skyScores.length > 0) {
            this.add.text(cx, nextY, '★  Sky Lounge Club  ★', {
                fontFamily: 'Arial Black', fontSize: 20, color: '#ffdd33',
                stroke: '#000000', strokeThickness: 4, align: 'center'
            }).setOrigin(0.5);
            nextY += 28;

            skyScores.forEach((entry, i) => {
                const isMe = entry.name === playerName && this.scoreType === 'skylounge' &&
                             entry.time === this.score;
                this.drawRow(gfx, cx, i, nextY, `#${i+1}`, entry.name,
                    formatTime(entry.time ?? 0), 0x2d4a1a, 0x3d6a22, isMe);
                nextY += 32;
            });
            nextY += 10;
        }

        if (htScores.length > 0) {
            this.add.text(cx, nextY, 'Height Records', {
                fontFamily: 'Arial Black', fontSize: 20, color: '#ffffff',
                stroke: '#000000', strokeThickness: 4, align: 'center'
            }).setOrigin(0.5);
            nextY += 28;

            htScores.forEach((entry, i) => {
                const isMe = entry.name === playerName && this.scoreType === 'height' &&
                             entry.score === this.score;
                this.drawRow(gfx, cx, i, nextY, `#${i+1}`, entry.name,
                    `${entry.score ?? 0}%`, 0x1a1a2e, 0x16213e, isMe);
                nextY += 32;
            });
            nextY += 10;
        }

        // ── click to restart ──────────────────────────────────────────────────
        this.add.text(cx, nextY + 14, 'Click anywhere to play again', {
            fontFamily: 'Arial', fontSize: 20, color: '#aaaaaa',
            stroke: '#000000', strokeThickness: 4, align: 'center'
        }).setOrigin(0.5);

        this.input.once('pointerdown', () => { this.scene.start('MainMenu'); });
    }

    private drawRow (
        gfx: Phaser.GameObjects.Graphics,
        cx: number,
        index: number, y: number,
        rank: string, name: string, value: string,
        evenColor: number, oddColor: number,
        highlight: boolean
    ) {
        const panelX = cx - 292;
        const panelW = 584;
        const rowH   = 30;
        const bg     = highlight ? 0x2a5a1a : (index % 2 === 0 ? evenColor : oddColor);
        gfx.fillStyle(highlight ? 0x3a7a22 : bg, 0.9);
        gfx.fillRect(panelX, y, panelW, rowH - 2);

        const style = {
            fontFamily: 'Arial', fontSize: 18,
            color: highlight ? '#ccffaa' : '#dddddd',
            stroke: '#000000', strokeThickness: 3
        };
        this.add.text(panelX + 10,          y + 6, rank,  style);
        this.add.text(panelX + 55,          y + 6, name,  style);
        this.add.text(panelX + panelW - 10, y + 6, value, { ...style, align: 'right' }).setOrigin(1, 0);
    }

    // ── localStorage helpers ──────────────────────────────────────────────────

    private loadScores (): ScoreEntry[]
    {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch { return []; }
    }

    private saveScores (scores: ScoreEntry[]): void
    {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(scores)); }
        catch { /* storage unavailable */ }
    }
}
