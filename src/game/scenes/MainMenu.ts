import { Scene, GameObjects } from 'phaser';

export class MainMenu extends Scene
{
    background: GameObjects.Image;
    titleImage: GameObjects.Image;
    private domElement!: Phaser.GameObjects.DOMElement;

    constructor () { super('MainMenu'); }

    shutdown () { this.scale.off('resize', undefined, this); }

    create ()
    {
        const W = this.scale.width;
        const H = this.scale.height;

        this.background = this.add.image(W / 2, H / 2, 'background').setDisplaySize(W, H).setTint(0x888888);
        this.titleImage = this.add.image(W / 2, H * 0.25, 'titletext').setDisplaySize(W * 0.6, H * 0.38);

        this.scale.on('resize', (size: Phaser.Structs.Size) => {
            const nW = size.width, nH = size.height;
            this.background.setPosition(nW / 2, nH / 2).setDisplaySize(nW, nH);
            this.titleImage.setPosition(nW / 2, nH * 0.25).setDisplaySize(nW * 0.6, nH * 0.38);
            this.domElement.setPosition(nW / 2, nH * 0.67);
        }, this);

        this.domElement = this.add.dom(W / 2, H * 0.67).createFromHTML(`
            <div style="text-align:center; font-family:Arial,sans-serif">
                <input type="text" id="nameInput" placeholder="Enter your name" maxlength="20"
                    style="font-size:22px; padding:8px 12px; width:220px; text-align:center;
                           border-radius:8px; border:3px solid #fff; background:rgba(0,0,0,0.7);
                           color:#fff; outline:none;" />
                <br/><br/>
                <button id="startBtn"
                    style="font-size:22px; padding:10px 32px; border-radius:8px; cursor:pointer;
                           background:#2ecc71; color:#fff; border:none; font-weight:bold;
                           box-shadow:0 4px 8px rgba(0,0,0,0.5);">
                    Start Climbing!
                </button>
                <br/><br/>
                <label id="soundLabel"
                    style="display:inline-flex; align-items:center; gap:8px; cursor:pointer;
                           font-size:18px; color:#fff; user-select:none;
                           text-shadow:0 2px 4px rgba(0,0,0,0.8);">
                    <input type="checkbox" id="muteToggle"
                        style="width:20px; height:20px; cursor:pointer; accent-color:#e74c3c;" />
                    No Sound
                </label>
            </div>
        `);

        this.domElement.addListener('click');
        this.domElement.on('click', (event: PointerEvent) => {
            if ((event.target as HTMLElement).id === 'startBtn') {
                this.startGame();
            }
        });

        this.domElement.addListener('keydown');
        this.domElement.on('keydown', (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
                this.startGame();
            }
        });
    }

    private startGame ()
    {
        const input = document.getElementById('nameInput') as HTMLInputElement;
        const name  = input?.value?.trim() || 'Anonymous';
        const mute  = (document.getElementById('muteToggle') as HTMLInputElement)?.checked ?? false;
        this.registry.set('playerName', name);
        this.registry.set('muted', mute);
        this.domElement.destroy();
        this.scene.start('Game');
    }
}
