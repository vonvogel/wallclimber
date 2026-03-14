import { Scene } from 'phaser';

export class Preloader extends Scene
{
    constructor ()
    {
        super('Preloader');
    }

    init ()
    {
        const W = this.scale.width;
        const H = this.scale.height;

        this.add.image(W / 2, H / 2, 'background').setDisplaySize(W, H);

        const barY = H - 48;
        this.add.rectangle(W / 2, barY, 468, 32).setStrokeStyle(1, 0xffffff);
        const bar = this.add.rectangle(W / 2 - 230, barY, 4, 28, 0xffffff);

        this.load.on('progress', (progress: number) => {
            bar.width = 4 + (460 * progress);
        });
    }

    preload ()
    {
        this.load.setPath('assets');
        this.load.image('titletext', 'titletext2.png');
        this.load.image('greenwall', 'greenwall.png');
        this.load.audio('gnome1',       'gnome1.mp3');
        this.load.audio('gnome2',       'gnome2.mp3');
        this.load.audio('oof1',         'oof1.mp3');
        this.load.audio('oof2',         'oof2.mp3');
        this.load.audio('parakeet1',    'parakeet1.mp3');
        this.load.audio('parakeet2',    'parakeet2.mp3');
        this.load.audio('parakeethit',  'parakeethitshort.wav');
        this.load.audio('ohno',         'ohno.mp3');
        this.load.audio('woohoo1',      'woohoo1.mp3');
        this.load.audio('woohoo2',      'woohoo2.mp3');
    }

    create ()
    {
        //  When all the assets have loaded, it's often worth creating global objects here that the rest of the game can use.
        //  For example, you can define global animations here, so we can use them in other scenes.

        //  Move to the MainMenu. You could also swap this for a Scene Transition, such as a camera fade.
        this.scene.start('MainMenu');
    }
}
