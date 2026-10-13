import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './theme.css';
import Submit from './pages/Submit';
import Tv from './pages/Tv';
import Vote from './pages/Vote';
import Admin from './pages/Admin';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/tv" element={<Tv />} />
        <Route path="/vote" element={<Vote />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Submit />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
