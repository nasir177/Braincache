'use client';
import { useState, useRef, useCallback } from 'react';
import { Handle, Position } from '@xyflow/react';
import { ExternalLink, Clock, Code2, Image as ImageIcon, Video, MessageSquare, ChevronDown, ChevronUp, Eye, Trash2, Edit3, Share2, Layers, Sparkles, Loader2, Link2 } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { format } from 'date-fns';
import { toPng } from 'html-to-image';
import download from 'downloadjs';
import { doc, deleteDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export default function AICardNode({ id, data }: { id: string; data: any }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'code' | 'preview' | 'explain'>('code');
  const [explanation, setExplanation] = useState<string | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  
  const Icon = data.type === 'code' ? Code2 : data.type === 'image' ? ImageIcon : data.type === 'video' ? Video : data.type === 'embed' ? Link2 : MessageSquare;
  const isHighlighted = data.isSearchResult;

  const handleDelete = () => deleteDoc(doc(db, 'snippets', id));
  const handleEdit = () => window.dispatchEvent(new CustomEvent('editNode', { detail: { id, data } }));

  const handleExplainCode = async () => {
    if (!data.content) return;
    setActiveTab('explain');
    setIsExplaining(true);
    setExplanation(null);
    try {
      const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
      if (!apiKey) throw new Error("Missing Gemini API Key");
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: `Explain this code concisely for a junior developer:\n\n${data.content}` }] }] })
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error?.message || "API failed");
      setExplanation(json.candidates[0].content.parts[0].text);
    } catch (err: any) {
      setExplanation(`⚠️ AI Error: ${err.message}`);
    } finally { setIsExplaining(false); }
  };

  const shareCard = useCallback(async () => {
    if (!cardRef.current) return;
    try {
      const watermark = cardRef.current.querySelector('.braincache-watermark') as HTMLElement;
      if (watermark) watermark.style.opacity = '1';
      const dataUrl = await toPng(cardRef.current, { backgroundColor: '#ffffff', style: { transform: 'scale(1)' }, pixelRatio: 2 });
      if (watermark) watermark.style.opacity = '';
      download(dataUrl, `braincache-${data.title.replace(/\s+/g, '-').toLowerCase()}.png`);
    } catch (err) { console.error(err); }
  }, [data.title]);

  const renderHighlightedText = (text: string) => {
    if (!text) return null;
    return text.split(/(==.*?==)/g).map((part, i) => part.startsWith('==') && part.endsWith('==') ? (
      <mark key={i} className="bg-yellow-200 text-yellow-900 px-1 rounded-sm font-semibold">{part.slice(2, -2)}</mark>
    ) : ( part ));
  };

  return (
    <div ref={cardRef} className={`w-[400px] max-w-[90vw] bg-white border ${isHighlighted ? 'border-purple-500 ring-4 ring-purple-500/30 shadow-2xl scale-105' : 'border-gray-200 shadow-sm'} rounded-2xl transition-all duration-300 font-sans group relative flex flex-col`}>
      <Handle type="target" position={Position.Top} className="w-3 h-3 bg-blue-500 opacity-0 group-hover:opacity-100" />
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-blue-500 opacity-0 group-hover:opacity-100" />
      <Handle type="source" position={Position.Right} id="right" className="w-3 h-3 bg-blue-500 opacity-0 group-hover:opacity-100" />
      <Handle type="target" position={Position.Left} id="left" className="w-3 h-3 bg-blue-500 opacity-0 group-hover:opacity-100" />

      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-b from-white to-gray-50 rounded-t-2xl">
        <div className="flex gap-3 items-center overflow-hidden">
          <div className="p-2.5 rounded-xl bg-white border shadow-sm text-gray-700 shrink-0"><Icon className="w-5 h-5" /></div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-gray-900 truncate pr-2">{data.title}</h3>
            <div className="flex items-center gap-1 text-[11px] font-medium text-gray-400">
              <Clock className="w-3 h-3" /> {data.timestamp ? format(new Date(data.timestamp), 'MMM d, h:mm a') : 'Now'}
            </div>
          </div>
        </div>
        
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white/80 backdrop-blur-sm p-1 rounded-lg z-10">
          {data.type === 'code' && <button onClick={handleExplainCode} className="p-1.5 text-purple-600 hover:bg-purple-50 rounded-md" title="AI Explain"><Sparkles className="w-4 h-4" /></button>}
          <button onClick={shareCard} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md" title="Share"><Share2 className="w-4 h-4" /></button>
          {data.type !== 'embed' && <button onClick={handleEdit} className="p-1.5 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-md" title="Edit"><Edit3 className="w-4 h-4" /></button>}
          <button onClick={handleDelete} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md" title="Delete"><Trash2 className="w-4 h-4" /></button>
          {data.type === 'embed' && <a href={data.content} target="_blank" rel="noreferrer" className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md" title="Open Link"><ExternalLink className="w-4 h-4" /></a>}
        </div>
      </div>

      {/* Code Tabs */}
      {data.type === 'code' && (
        <div className="flex border-b border-gray-100 bg-gray-50 text-[11px] font-bold text-gray-500">
          <button onClick={() => setActiveTab('code')} className={`flex-1 py-2.5 flex items-center justify-center gap-2 transition-colors ${activeTab === 'code' ? 'bg-white text-blue-600 border-b-2 border-blue-600' : 'hover:bg-gray-100'}`}><Code2 className="w-3 h-3" /> CODE</button>
          <button onClick={() => setActiveTab('preview')} className={`flex-1 py-2.5 flex items-center justify-center gap-2 transition-colors ${activeTab === 'preview' ? 'bg-white text-green-600 border-b-2 border-green-600' : 'hover:bg-gray-100'}`}><Eye className="w-3 h-3" /> PREVIEW</button>
          {explanation && <button onClick={() => setActiveTab('explain')} className={`flex-1 py-2.5 flex items-center justify-center gap-2 transition-colors ${activeTab === 'explain' ? 'bg-white text-purple-600 border-b-2 border-purple-600' : 'hover:bg-gray-100'}`}><Sparkles className="w-3 h-3" /> EXPLANATION</button>}
        </div>
      )}

      {/* Body */}
      <div className={`p-5 nodrag cursor-text text-sm text-gray-800 bg-white relative ${!isExpanded && (data.type === 'text' || data.type === 'code') ? 'max-h-[280px] overflow-hidden' : ''}`}>
        
        {data.type === 'embed' ? (
           <div className="w-full h-[320px] rounded-xl overflow-hidden border border-gray-200 bg-gray-50 flex items-center justify-center relative">
              {/* Professional iframe wrapper */}
              <iframe src={data.content} className="w-full h-full border-0 absolute inset-0" allowFullScreen loading="lazy" />
           </div>
        ) : data.type === 'code' ? (
          activeTab === 'code' ? (
            <SyntaxHighlighter language="javascript" style={vscDarkPlus} customStyle={{ margin: 0, padding: '16px', fontSize: '13px', borderRadius: '12px', height: '100%' }}>{data.content}</SyntaxHighlighter>
          ) : activeTab === 'preview' ? (
            <iframe srcDoc={`<html><style>body{margin:0;font-family:sans-serif;}</style><body>${data.content}</body></html>`} className="w-full h-48 border-0 bg-gray-50 rounded-xl" />
          ) : (
            <div className="bg-purple-50 p-4 rounded-xl text-purple-900 text-sm whitespace-pre-wrap">{isExplaining ? <div className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Thinking...</div> : explanation}</div>
          )
        ) : data.type === 'image' ? (
           <img src={data.content} alt="Content" className="w-full rounded-xl object-cover" />
        ) : data.type === 'video' ? (
           <video src={data.content} controls className="w-full rounded-xl bg-black" />
        ) : (
          <div className="leading-relaxed whitespace-pre-wrap">{renderHighlightedText(data.content)}</div>
        )}

        {!isExpanded && (data.type === 'text' || (data.type === 'code' && activeTab === 'code')) && data.content.length > 250 && (
          <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-white via-white/90 to-transparent flex items-end justify-center pb-2 z-10">
            <button onClick={() => setIsExpanded(true)} className="flex items-center gap-1.5 text-xs font-bold text-gray-700 bg-white px-4 py-2 rounded-full shadow-lg border border-gray-100 hover:bg-gray-50">Read More <ChevronDown className="w-3 h-3" /></button>
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="w-full bg-white flex justify-center pb-2 z-10">
           <button onClick={() => setIsExpanded(false)} className="flex items-center gap-1 text-xs font-bold text-gray-400 p-2">Show Less <ChevronUp className="w-3 h-3" /></button>
        </div>
      )}

      {/* Watermark */}
      <div className="braincache-watermark px-5 py-3 bg-gray-50 border-t border-gray-100 rounded-b-2xl flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity duration-500">
         <div className="flex items-center gap-2"><Layers className="w-3 h-3 text-blue-600" /><span className="text-[10px] font-black tracking-wider text-gray-400 uppercase">BrainCache</span></div>
      </div>
    </div>
  );
}