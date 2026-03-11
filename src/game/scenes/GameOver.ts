import { Scene } from 'phaser';

const STORAGE_KEY = 'wallclimber_scores';
const MAX_SCORES  = 10;

interface ScoreEntry { name: string; score: number; }

export class GameOver extends Scene
{
    private score: number = 0;

    constructor ()
    {
        super('GameOver');
    }

    init (data: { score?: number })
    {
        this.score = data?.score ?? 0;
    }

    create ()
    {
        const playerName: string = this.registry.get('playerName') || 'Anonymous';

        // ── persist score ──────────────────────────────────────────────────────
        const scores = this.loadScores();
        scores.push({ name: playerName, score: this.score });
        scores.sort((a, b) => b.score - a.score);
        if (scores.length > MAX_SCORES) scores.length = MAX_SCORES;
        this.saveScores(scores);

        // ── background ────────────────────────────────────────────────────────
        this.cameras.main.setBackgroundColor(0x1a0a2e);
        const bg = this.add.image(512, 384, 'background');
        bg.setAlpha(0.15);

        // ── title ─────────────────────────────────────────────────────────────
        this.add.text(512, 60, 'GAME OVER', {
            fontFamily: 'Arial Black', fontSize: 64, color: '#ff4444',
            stroke: '#000000', strokeThickness: 8, align: 'center'
        }).setOrigin(0.5);

        // ── player score ───────────────────────────────────────────────────────
        this.add.text(512, 145, `${playerName}  —  ${this.score}% height`, {
            fontFamily: 'Arial Black', fontSize: 28, color: '#ffff00',
            stroke: '#000000', strokeThickness: 6, align: 'center'
        }).setOrigin(0.5);

        // ── high scores panel ─────────────────────────────────────────────────
        this.add.text(512, 210, 'HIGH SCORES', {
            fontFamily: 'Arial Black', fontSize: 26, color: '#ffffff',
            stroke: '#000000', strokeThickness: 5, align: 'center'
        }).setOrigin(0.5);

        const panelX = 260;
        const panelY = 235;
        const panelW = 504;
        const rowH   = 38;
        const gfx    = this.add.graphics();

        scores.forEach((entry, i) => {
            const y        = panelY + i * rowH;
            const isPlayer = entry.name === playerName && entry.score === this.score;
            const bgColor  = isPlayer ? 0x2d4a2d : (i % 2 === 0 ? 0x1a1a2e : 0x16213e);

            gfx.fillStyle(bgColor, 0.85);
            gfx.fillRect(panelX, y, panelW, rowH - 2);

            const rank  = `#${i + 1}`;
            const label = `${entry.name}`;
            const pct   = `${entry.score}%`;

            const textStyle = {
                fontFamily: 'Arial', fontSize: 20,
                color: isPlayer ? '#ffff88' : '#dddddd',
                stroke: '#000000', strokeThickness: 3
            };

            this.add.text(panelX + 12,          y + 9, rank,  textStyle);
            this.add.text(panelX + 60,           y + 9, label, textStyle);
            this.add.text(panelX + panelW - 12,  y + 9, pct,   { ...textStyle, align: 'right' }).setOrigin(1, 0);
        });

        // ── click to restart ──────────────────────────────────────────────────
        const restartY = panelY + scores.length * rowH + 30;
        this.add.text(512, restartY, 'Click anywhere to play again', {
            fontFamily: 'Arial', fontSize: 22, color: '#aaaaaa',
            stroke: '#000000', strokeThickness: 4, align: 'center'
        }).setOrigin(0.5);

        this.input.once('pointerdown', () => {
            this.scene.start('MainMenu');
        });
    }

    // ── localStorage helpers ───────────────────────────────────────────────────

    private loadScores (): ScoreEntry[]
    {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    }

    private saveScores (scores: ScoreEntry[]): void
    {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(scores));
        } catch { /* storage unavailable */ }
    }
}
