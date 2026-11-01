import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import './styles.css';
import { cafeLegacyScene } from '../webgal/scenes/cafe/legacy.js';

createApp(App, { content: cafeLegacyScene }).use(createPinia()).mount('#app');
