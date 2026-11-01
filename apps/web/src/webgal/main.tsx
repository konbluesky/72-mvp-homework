import { createRoot } from 'react-dom/client';
import { App } from './App';
import './workbench.css';
import { cafeSceneModule } from './scenes/cafe/index';
import { StoryApp } from './product/App';
import './product/styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('WEBGAL_ROOT_MISSING');
const root = createRoot(container);
root.render(
  new URLSearchParams(location.search).has('preview') ? (
    <App />
  ) : (
    <StoryApp scene={cafeSceneModule} />
  ),
);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    root.unmount();
  });
}
