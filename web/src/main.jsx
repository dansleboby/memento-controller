import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/jost';
import '@fontsource/allison';
import './styles.css';
import { readFinish } from './finish.js';
import { storedTheme } from './theme.js';
import App from './App.jsx';

document.documentElement.dataset.finish = readFinish();
const theme = storedTheme();
if (theme) document.documentElement.dataset.theme = theme;

createRoot(document.getElementById('root')).render(<App />);
