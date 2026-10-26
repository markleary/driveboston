import './styles.css';
import { App } from './game/app.ts';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const app = new App(canvas);
app.start().catch((err: unknown) => {
  console.error(err);
  app.loading.fail(`Could not start: ${err instanceof Error ? err.message : String(err)}`);
});
