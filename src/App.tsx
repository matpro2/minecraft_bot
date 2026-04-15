import React, { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Terminal, Send, Activity, Package, Mic, MicOff, Play, Square } from 'lucide-react';

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [logs, setLogs] = useState<string[]>([]);
  const [chatMessages, setChatMessages] = useState<{username: string, message: string}[]>([]);
  const [inventory, setInventory] = useState<{name: string, count: number, displayName: string}[]>([]);
  const [position, setPosition] = useState<{x: string, y: string, z: string} | null>(null);
  
  const [config] = useState({
    host: 'localhost',
    port: '49292',
    version: '1.21.11',
    username: 'AI',
    auth: 'offline'
  });

  const [chatInput, setChatInput] = useState('');
  const [isListening, setIsListening] = useState(false);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const startListening = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'fr-FR';
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      if (socket && transcript.trim() && status === 'connected') {
        socket.emit('send_chat', transcript);
      }
    };
    recognition.start();
  };

  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('log', (msg: string) => setLogs(prev => [...prev, msg]));
    newSocket.on('status', (newStatus: any) => setStatus(newStatus));
    newSocket.on('chat', (data: any) => setChatMessages(prev => [...prev, data]));
    newSocket.on('inventory', (items: any) => setInventory(items));
    newSocket.on('position', (pos: any) => setPosition(pos));

    return () => { newSocket.close(); };
  }, []);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  const handleJoin = () => {
    if (socket) {
      setLogs(prev => [...prev, 'connecting...']);
      socket.emit('connect_bot', config);
    }
  };

  const handleLeave = () => {
    if (socket) {
      socket.emit('disconnect_bot');
      setInventory([]);
      setPosition(null);
      setStatus('disconnected');
    }
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (socket && chatInput.trim() && status === 'connected') {
      socket.emit('send_chat', chatInput);
      setChatInput('');
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 md:p-8 font-sans">
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        <div className="lg:col-span-4 space-y-6 flex flex-col h-[calc(100vh-4rem)]">
          
          <div className="glass-panel rounded-2xl p-6 shrink-0">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg">
                <Activity size={20} />
              </div>
              <h1 className="text-lg font-semibold">Bot Controller</h1>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={handleJoin}
                disabled={status !== 'disconnected' && status !== 'error'}
                className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-20 disabled:cursor-not-allowed text-white py-4 rounded-xl font-bold transition-all active:scale-95"
              >
                <Play size={20} fill="currentColor" /> JOIN
              </button>
              
              <button 
                onClick={handleLeave}
                disabled={status === 'disconnected'}
                className="flex items-center justify-center gap-2 bg-zinc-800 hover:bg-red-600 disabled:opacity-20 disabled:cursor-not-allowed text-white py-4 rounded-xl font-bold transition-all active:scale-95"
              >
                <Square size={20} fill="currentColor" /> LEAVE
              </button>
            </div>
            
            <div className="mt-4 p-3 bg-black/20 rounded-lg border border-white/5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500 uppercase font-bold tracking-widest">Bot ID</span>
                <span className="text-emerald-500 font-mono">{config.username}</span>
              </div>
            </div>
          </div>

          <div className="glass-panel rounded-2xl p-4 flex flex-col gap-3 shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-400 uppercase">Status</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium capitalize text-zinc-300">{status}</span>
                <div className={`w-2.5 h-2.5 rounded-full ${
                  status === 'connected' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 
                  status === 'connecting' ? 'bg-yellow-500 animate-pulse' : 
                  status === 'error' ? 'bg-red-500' : 'bg-zinc-600'
                }`} />
              </div>
            </div>
            
            {position && (
              <div className="flex items-center justify-between pt-3 border-t border-white/5 font-mono text-[10px]">
                <span className="text-zinc-500">POS</span>
                <span className="text-zinc-300 bg-black/30 px-2 py-1 rounded">
                  X: {position.x} Y: {position.y} Z: {position.z}
                </span>
              </div>
            )}
          </div>

          <div className="glass-panel rounded-2xl p-6 flex flex-col flex-1 min-h-0">
            <div className="flex items-center gap-2 mb-4 shrink-0">
              <Package size={16} className="text-zinc-400" />
              <h2 className="text-sm font-medium">Inventaire</h2>
            </div>
            <div className="overflow-y-auto flex-1 pr-2 space-y-2 custom-scrollbar">
              {inventory.length === 0 ? (
                <div className="text-zinc-600 text-xs italic text-center mt-4">Vide</div>
              ) : (
                inventory.map((item, i) => (
                  <div key={i} className="flex items-center justify-between glass-input rounded-lg p-2 border-white/5 bg-white/5">
                    <span className="text-sm text-zinc-300 truncate">{item.displayName || item.name}</span>
                    <span className="text-xs font-mono text-emerald-400">x{item.count}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-8 space-y-6 flex flex-col h-[calc(100vh-4rem)]">
          
          <div className="glass-panel rounded-2xl flex flex-col flex-1 min-h-0">
            <div className="border-b border-white/5 p-4 flex items-center gap-2 bg-black/20 rounded-t-2xl">
              <Terminal size={16} className="text-zinc-400" />
              <h2 className="text-sm font-medium">Console System</h2>
            </div>
            <div className="p-4 overflow-y-auto flex-1 font-mono text-[11px] space-y-1">
              {logs.map((log, i) => {
                const safeLog = typeof log === 'string' ? log : JSON.stringify(log);
                return (
                  <div key={i} className={safeLog.includes('[ERROR]') ? 'text-red-400' : safeLog.includes('[SYSTEM]') ? 'text-emerald-400' : 'text-zinc-500'}>
                    {safeLog}
                  </div>
                );
              })}
              <div ref={logsEndRef} />
            </div>
          </div>

          <div className="glass-panel rounded-2xl flex flex-col h-[40%]">
            <div className="border-b border-white/5 p-4 flex items-center gap-2 bg-black/20 rounded-t-2xl">
              <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
              <h2 className="text-sm font-medium">Minecraft Chat</h2>
            </div>
            <div className="p-4 overflow-y-auto flex-1 space-y-2">
              {chatMessages.map((msg, i) => (
                <div key={i} className="text-sm">
                  <span className="font-bold text-zinc-500">&lt;{msg.username}&gt;</span>{' '}
                  <span className="text-zinc-300">{msg.message}</span>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            <form onSubmit={handleSendChat} className="p-3 border-t border-white/5 flex gap-2 bg-black/10">
              <input 
                type="text" 
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Envoyer un message..."
                disabled={status !== 'connected'}
                className="flex-1 glass-input rounded-lg py-2 px-3 text-sm focus:outline-none"
              />
              <button 
                type="button"
                onClick={startListening}
                className={`p-2 rounded-lg w-10 transition-colors ${isListening ? 'bg-red-500 animate-pulse' : 'glass-input text-zinc-400'}`}
              >
                {isListening ? <MicOff size={16} /> : <Mic size={16} />}
              </button>
              <button type="submit" disabled={status !== 'connected'} className="bg-emerald-600 text-white p-2 rounded-lg w-10 disabled:opacity-20">
                <Send size={16} />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}