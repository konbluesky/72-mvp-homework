import { createInteractiveEngine } from './runtime/bootstrap';
import { DEMO_ASSETS } from './scenes/engine-demo/definition';

export { DEMO_SCENES } from './scenes/engine-demo/definition';
export const createWorkbench = () => createInteractiveEngine(DEMO_ASSETS);
