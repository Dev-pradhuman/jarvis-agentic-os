import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { SetupScreen } from './components/SetupScreen.tsx';
import './index.css';

function Root() { const [ready, setReady] = React.useState(null); React.useEffect(() => { fetch('http://127.0.0.1:3030/setup/status').then((r) => r.json()).then((x) => setReady(x.configured)).catch(() => setReady(true)); }, []); return ready === null ? null : ready ? <App /> : <SetupScreen onDone={() => setReady(true)} />; }
ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><Root /></React.StrictMode>);
