import { Scene, GameObjects } from 'phaser';

export class MainMenu extends Scene
{
    background: GameObjects.Image;
    logo: GameObjects.Image;
    title: GameObjects.Text;
    private domElement!: Phaser.GameObjects.DOMElement;

    constructor ()
    {
        super('MainMenu');
    }

    create ()
    {
        this.background = this.add.image(512, 384, 'background');
        this.logo = this.add.image(512, 240, 'logo');

        this.title = this.add.text(512, 385, 'Wall Climber', {
            fontFamily: 'Arial Black', fontSize: 38, color: '#ffffff',
            stroke: '#000000', strokeThickness: 8,
            align: 'center'
        }).setOrigin(0.5);

        this.domElement = this.add.dom(512, 510).createFromHTML(`
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
        const name = input?.value?.trim() || 'Anonymous';
        this.registry.set('playerName', name);
        this.domElement.destroy();
        this.scene.start('Game');
    }
}
