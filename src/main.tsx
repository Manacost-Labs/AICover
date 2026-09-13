import './index.css';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { MotionConfig } from 'motion/react';
import { ChatGptProvider, ChatGptCallback } from './components/ui/ChatGptConnection';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      {window.location.pathname === '/chatgpt/callback' ? <ChatGptCallback /> : <ChatGptProvider><App /></ChatGptProvider>}
    </MotionConfig>
  </StrictMode>,
);
