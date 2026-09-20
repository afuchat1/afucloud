import { createRoot } from 'react-dom/client';
import { setBaseUrl } from '@workspace/api-client-react';

import App from './App';

import './index.css';

// Production data traffic goes directly to the Cloudflare Worker.
setBaseUrl('https://api.afuchat.com');

createRoot(document.getElementById('root')!).render(<App />);
