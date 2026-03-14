import { Scene } from 'phaser';

const STORAGE_KEY   = 'wallclimber_scores_v2';
const MAX_EACH      = 10;
const API_BASE      = 'https://dumalis.se/wallclimber-scores/api/scores.php';

// Shape returned by GET /scores.php?type=...
interface ApiRow {
    name:       string;
    score:      number;
    created_at: string;
}

// Internal representation
interface ScoreEntry {
    name:  string;
    type:  'height' | 'skylounge';
    score: number;   // height %  OR  skylounge seconds — both stored in score
}

function formatTime (t: number): string {
    if (t < 60) return `${t.toFixed(1)}s`;
    const m = Math.floor(t / 60);
    const s = (t % 60).toFixed(1).padStart(4, '0');
    return `${m}m ${s}s`;
}

async function apiPost (entry: ScoreEntry): Promise<void> {
    await fetch(API_BASE, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: entry.name, type: entry.type, score: entry.score }),
    });
}

async function apiFetch (type: 'height' | 'skylounge'): Promise<ScoreEntry[]> {
    const res = await fetch(`${API_BASE}?type=${type}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: ApiRow[] = await res.json();
    return Array.isArray(data)
        ? data.map(r => ({ name: r.name, type, score: r.score }))
        : [];
}

export class GameOver extends Scene
{
    private scoreType:  'height' | 'skylounge' = 'height';
    private score:      number = 0;
    private _initData:  { score?: number; type?: string; time?: number } = {};

    // objects we'll replace when remote scores arrive
    private _leaderboardContainer: Phaser.GameObjects.Container | null = null;
    private _statusText: Phaser.GameObjects.Text | null = null;

    constructor () { super('GameOver'); }

    shutdown () { this.scale.off('resize', undefined, this); }

    init (data: { score?: number; type?: string; time?: number })
    {
        this._initData = data ?? {};
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

        // ── background ────────────────────────────────────────────────────────
        const W = this.scale.width;
        const H = this.scale.height;
        const cx = W / 2;

        this.cameras.main.setBackgroundColor(0x1a0a2e);
        const bg = this.add.image(cx, H / 2, 'background');
        bg.setDisplaySize(W, H);
        bg.setAlpha(0.15);

        // ── title ─────────────────────────────────────────────────────────────
        let leaderboardStartY: number;
        if (this.scoreType === 'skylounge') {
            this.add.text(cx, 48, '🍸  SKY LOUNGE!  🍸', {
                fontFamily: 'Arial Black', fontSize: 52, color: '#ffdd33',
                stroke: '#000000', strokeThickness: 8, align: 'center'
            }).setOrigin(0.5);
            this.add.text(cx, 118, `${playerName}  —  reached in  ${formatTime(this.score)}`, {
                fontFamily: 'Arial Black', fontSize: 24, color: '#ffffff',
                stroke: '#000000', strokeThickness: 5, align: 'center'
            }).setOrigin(0.5);
            leaderboardStartY = 158;
        } else {
            this.add.text(cx, 52, 'GAME OVER', {
                fontFamily: 'Arial Black', fontSize: 64, color: '#ff4444',
                stroke: '#000000', strokeThickness: 8, align: 'center'
            }).setOrigin(0.5);
            this.add.text(cx, 130, `${playerName}  —  ${this.score}% height`, {
                fontFamily: 'Arial Black', fontSize: 26, color: '#ffff00',
                stroke: '#000000', strokeThickness: 6, align: 'center'
            }).setOrigin(0.5);
            leaderboardStartY = 168;
        }

        // ── status / loading placeholder ──────────────────────────────────────
        this._statusText = this.add.text(cx, leaderboardStartY + 20, 'Syncing scores…', {
            fontFamily: 'Arial', fontSize: 18, color: '#888888',
            stroke: '#000000', strokeThickness: 3, align: 'center'
        }).setOrigin(0.5);

        // ── click to restart ──────────────────────────────────────────────────
        const restartText = this.add.text(cx, H - 40, 'Click anywhere to play again', {
            fontFamily: 'Arial', fontSize: 20, color: '#aaaaaa',
            stroke: '#000000', strokeThickness: 4, align: 'center'
        }).setOrigin(0.5);

        this.input.once('pointerdown', () => { this.scene.start('MainMenu'); });
        this.scale.on('resize', () => { this.scene.restart(this._initData); }, this);

        // ── build entry for this run ──────────────────────────────────────────
        const newEntry: ScoreEntry = {
            name:  playerName,
            type:  this.scoreType,
            score: this.score,  // height %  OR  skylounge seconds
        };

        // ── async: post + fetch, then render leaderboard ──────────────────────
        this.syncScores(newEntry, playerName, cx, leaderboardStartY, restartText).catch(() => {
            // fall back to local-only
            const local = this.loadLocalScores();
            local.push(newEntry);
            const sky = local.filter(e => e.type === 'skylounge')
                             .sort((a, b) => a.score - b.score)
                             .slice(0, MAX_EACH);
            const ht  = local.filter(e => e.type !== 'skylounge')
                             .sort((a, b) => b.score - a.score)
                             .slice(0, MAX_EACH);
            this.saveLocalScores([...sky, ...ht]);
            if (this.scene.isActive('GameOver')) {
                this.renderLeaderboard(sky, ht, newEntry, playerName, cx, leaderboardStartY, restartText);
            }
        });
    }

    private async syncScores (
        newEntry: ScoreEntry,
        playerName: string,
        cx: number,
        leaderboardStartY: number,
        restartText: Phaser.GameObjects.Text
    ): Promise<void> {
        // Submit score + fetch both boards in parallel
        const [skyRaw, htRaw] = await Promise.all([
            apiPost(newEntry).then(() => apiFetch('skylounge')),
            apiFetch('height'),
        ]);

        const sky = skyRaw.sort((a, b) => a.score - b.score).slice(0, MAX_EACH);
        const ht  = htRaw .sort((a, b) => b.score - a.score).slice(0, MAX_EACH);

        // Also persist locally
        this.saveLocalScores([...sky, ...ht]);

        if (this.scene.isActive('GameOver')) {
            this.renderLeaderboard(sky, ht, newEntry, playerName, cx, leaderboardStartY, restartText);
        }
    }

    private renderLeaderboard (
        skyScores: ScoreEntry[],
        htScores: ScoreEntry[],
        newEntry: ScoreEntry,
        playerName: string,
        cx: number,
        startY: number,
        restartText: Phaser.GameObjects.Text
    ): void {
        // Remove placeholder
        this._statusText?.destroy();
        this._statusText = null;
        this._leaderboardContainer?.destroy();

        const gfx = this.add.graphics();
        let nextY = startY;

        if (skyScores.length > 0) {
            this.add.text(cx, nextY, '★  Sky Lounge Club  ★', {
                fontFamily: 'Arial Black', fontSize: 20, color: '#ffdd33',
                stroke: '#000000', strokeThickness: 4, align: 'center'
            }).setOrigin(0.5);
            nextY += 28;

            skyScores.forEach((entry, i) => {
                const isMe = entry.name === playerName &&
                             newEntry.type === 'skylounge' &&
                             entry.score === newEntry.score;
                this.drawRow(gfx, cx, i, nextY, `#${i+1}`, entry.name,
                    formatTime(entry.score), 0x2d4a1a, 0x3d6a22, isMe);
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
                const isMe = entry.name === playerName &&
                             newEntry.type === 'height' &&
                             entry.score === newEntry.score;
                this.drawRow(gfx, cx, i, nextY, `#${i+1}`, entry.name,
                    `${entry.score}%`, 0x1a1a2e, 0x16213e, isMe);
                nextY += 32;
            });
            nextY += 10;
        }

        // Reposition restart text below leaderboard
        restartText.setY(nextY + 14);
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

    private loadLocalScores (): ScoreEntry[]
    {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch { return []; }
    }

    private saveLocalScores (scores: ScoreEntry[]): void
    {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(scores)); }
        catch { /* storage unavailable */ }
    }
}
