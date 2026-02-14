'use client';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ReactFlow, Background, Controls, applyNodeChanges, applyEdgeChanges, addEdge, NodeChange, EdgeChange, Connection, Node, Edge, useReactFlow, ReactFlowProvider } from '@xyflow/react';

// @ts-ignore
import '@xyflow/react/dist/style.css'; 

import { db } from '@/lib/firebase';
import { collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc, query, where, writeBatch, getDoc } from 'firebase/firestore';
import { Type, Code2, Image as ImageIcon, Video, X, ChevronLeft, Square, Circle, Diamond, Shapes, Loader2, Wand2, Copy, Globe, Lock, Search, PictureInPicture2, Database, Sparkles, Send, Link2, Trash2, Check, ChevronDown, Maximize2, Minimize2 } from 'lucide-react';
import AICardNode from '@/components/AICardNode';
import ShapeNode from '@/components/ShapeNode';

const nodeTypes = { aiCard: AICardNode, shape: ShapeNode };

// --- AI MATH ---
function cosineSimilarity(vecA: number[], vecB: number[]) {
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i]; normA += vecA[i] * vecA[i]; normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// --- AI API ---
async function generateEmbedding(text: string) {
  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'models/text-embedding-004', content: { parts: [{ text }] } })
    });
    const data = await res.json();
    return data.embedding.values;
  } catch (e) { return null; }
}

export default function BoardPage() {
  return (
    <ReactFlowProvider>
      <CanvasBoard />
    </ReactFlowProvider>
  );
}

function CanvasBoard() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const boardId = params.id as string;
  const { fitView, setCenter } = useReactFlow();

  const isOverlay = searchParams.get('mode') === 'overlay';

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [boardData, setBoardData] = useState<any>(null);
  
  // UI States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeType, setActiveType] = useState('text');
  const [isDiagramMenuOpen, setIsDiagramMenuOpen] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchingAI, setIsSearchingAI] = useState(false);

  // --- GEMINI CHAT STATES ---
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isFullscreenChat, setIsFullscreenChat] = useState(false); 
  const [chatMessages, setChatMessages] = useState<{role: 'user'|'ai', text: string}[]>([{ role: 'ai', text: 'Hello! I am your AI assistant. How can I help you with this workspace today?' }]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [link, setLink] = useState('');

  useEffect(() => {
    if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [chatMessages, isChatLoading, isFullscreenChat]);

  // Initial Setup
  useEffect(() => {
    if (!boardId) return;
    const fetchBoardMeta = async () => {
      const bDoc = await getDoc(doc(db, 'boards', boardId));
      if (bDoc.exists()) setBoardData(bDoc.data());
    };
    fetchBoardMeta();

    const unsubNodes = onSnapshot(query(collection(db, 'snippets'), where("boardId", "==", boardId)), (snapshot) => {
      setNodes(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Node[]);
    });
    const unsubEdges = onSnapshot(query(collection(db, 'boardEdges'), where("boardId", "==", boardId)), (snapshot) => {
      setEdges(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Edge[]);
    });

    const handleEditEvent = (e: any) => {
      const { id, data } = e.detail;
      setEditingNodeId(id); setActiveType(data.type); setTitle(data.title || ''); setContent(data.content || ''); setLink(data.link || ''); setIsModalOpen(true);
    };
    window.addEventListener('editNode', handleEditEvent);

    return () => { unsubNodes(); unsubEdges(); window.removeEventListener('editNode', handleEditEvent); };
  }, [boardId]);

  // React Flow Handlers
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
    changes.forEach((change) => {
      if (change.type === 'position' && !change.dragging && change.position) updateDoc(doc(db, 'snippets', change.id), { position: change.position });
    });
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds));
    changes.forEach((change) => {
      if (change.type === 'remove') deleteDoc(doc(db, 'boardEdges', change.id));
    });
  }, []);

  const onConnect = useCallback((params: Connection) => {
    const newEdge = { ...params, id: `edge_${Date.now()}`, type: 'smoothstep', animated: true, boardId };
    setEdges((eds) => addEdge(newEdge as unknown as Edge, eds));
    setDoc(doc(db, 'boardEdges', newEdge.id), newEdge);
  }, [boardId]);

  // --- GEMINI CHAT ENGINE ---
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isChatLoading) return;

    const userMsg = chatInput.trim();
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setIsChatLoading(true);

    try {
      const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
      if (!apiKey) throw new Error("Missing Gemini API Key");

      const boardContext = nodes
        .filter(n => n.type === 'aiCard' && (n.data.type === 'text' || n.data.type === 'code'))
        .map(n => `Title: ${n.data.title || 'Untitled'}\nContent: ${n.data.content}`)
        .join('\n\n---\n\n');

      const systemPrompt = `You are BrainCache AI, an intelligent assistant. Answer the user naturally based ONLY on this workspace content: \n\n${boardContext || 'Empty board.'}`;

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: `${systemPrompt}\n\nQuestion: ${userMsg}` }] }] })
      });

      const json = await res.json();
      if (!res.ok || json.error) throw new Error("API Error");
      setChatMessages(prev => [...prev, { role: 'ai', text: json.candidates[0].content.parts[0].text }]);
    } catch (err: any) {
      setChatMessages(prev => [...prev, { role: 'ai', text: `⚠️ Error: ${err.message}` }]);
    } finally { setIsChatLoading(false); }
  };

  // --- AI SEARCH ENGINE ---
  const executeSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, isSearchResult: false } })));
      return;
    }
    setIsSearchingAI(true);
    try {
      const queryEmbedding = await generateEmbedding(searchQuery);
      if (!queryEmbedding) {
         const lowerQuery = searchQuery.toLowerCase();
         setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, isSearchResult: (n.data.title as string)?.toLowerCase().includes(lowerQuery) || (n.data.content as string)?.toLowerCase().includes(lowerQuery) } })));
         return;
      }
      let bestNode: Node | null = null;
      let highestScore = 0;
      const scoredNodes = nodes.map(n => {
        let score = n.data.embedding ? cosineSimilarity(queryEmbedding, n.data.embedding as number[]) : ((n.data.content as string)?.toLowerCase().includes(searchQuery.toLowerCase()) ? 0.5 : 0);
        if (score > highestScore) { highestScore = score; bestNode = n; }
        return { ...n, data: { ...n.data, isSearchResult: score > 0.65 } };
      });
      setNodes(scoredNodes);
      if (bestNode && highestScore > 0.65) setCenter(bestNode.position.x + 200, bestNode.position.y + 150, { zoom: 1.2, duration: 1000 });
      else alert("No strong semantic matches found.");
    } finally { setIsSearchingAI(false); }
  };

  const handleAddEmbed = () => {
    const userInput = prompt("Paste link (Figma, YouTube, Docs, ChatGPT, Gemini):");
    if (!userInput) return;
    if (userInput.includes('localhost') || userInput.includes('127.0.0.1') || (typeof window !== 'undefined' && userInput.includes(window.location.host))) {
      alert("⚠️ Cannot embed the board into itself!"); return;
    }

    let embedUrl = userInput;
    let cardType = 'embed';
    let cardTitle = 'Embedded Content';

    try {
      if (userInput.includes('chatgpt.com') || userInput.includes('chat.openai.com') || userInput.includes('gemini.google.com')) {
        cardType = 'bookmark'; 
        cardTitle = userInput.includes('gemini') ? 'Gemini Session' : 'ChatGPT Session';
      } 
      else if (userInput.includes('figma.com')) {
        embedUrl = `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(userInput)}`;
        cardTitle = 'Figma Design';
      } else if (userInput.includes('youtube.com/watch?v=')) {
        embedUrl = userInput.replace('watch?v=', 'embed/').split('&')[0];
        cardTitle = 'YouTube Video';
      } else if (userInput.includes('youtu.be/')) {
        embedUrl = `https://www.youtube.com/embed/${userInput.split('youtu.be/')[1].split('?')[0]}`;
        cardTitle = 'YouTube Video';
      } else if (userInput.includes('docs.google.com')) {
        embedUrl = userInput.replace(/\/edit.*$/, '/preview');
        cardTitle = 'Google Document';
      }
    } catch (e) { console.error("URL Parse error", e); }

    setDoc(doc(db, 'snippets', `node_${Date.now()}`), {
      boardId, type: 'aiCard', position: { x: window.innerWidth/2, y: window.innerHeight/2 },
      data: { type: cardType, title: cardTitle, content: embedUrl, timestamp: new Date().toISOString() }
    });
  };

  const clearBoard = async () => {
    if (!confirm("⚠️ Are you sure you want to clear the entire board? This cannot be undone.")) return;
    const batch = writeBatch(db);
    nodes.forEach(n => batch.delete(doc(db, 'snippets', n.id)));
    edges.forEach(e => batch.delete(doc(db, 'boardEdges', e.id)));
    await batch.commit();
  };

  const openOverlayMode = () => {
    window.open(`/board/${boardId}?mode=overlay`, 'BrainCacheOverlay', `width=480,height=800,left=${window.screen.width - 500},top=80,menubar=no,toolbar=no,location=no,status=no,resizable=yes`);
  };

  const magicOrganize = async () => {
    if (nodes.length === 0) return;
    const batch = writeBatch(db);
    const groups: Record<string, Node[]> = { code: [], image: [], video: [], text: [], shape: [] };
    nodes.forEach(n => { const type = n.type === 'shape' ? 'shape' : (n.data.type as string || 'text'); if (groups[type]) groups[type].push(n); else groups.text.push(n); });
    let currentX = 0; const GAP_X = 450; const GAP_Y = 500; 
    Object.entries(groups).forEach(([type, groupNodes], typeIndex) => {
       if (groupNodes.length === 0) return;
       groupNodes.forEach((node, index) => { batch.update(doc(db, 'snippets', node.id), { position: { x: currentX + (index * GAP_X), y: typeIndex * GAP_Y } }); });
    });
    await batch.commit(); setTimeout(() => fitView({ duration: 800 }), 500);
  };

  const handleRename = async () => {
    const newTitle = prompt("Enter new board name:", boardData?.title);
    if (newTitle) { await updateDoc(doc(db, 'boards', boardId), { title: newTitle }); setBoardData({ ...boardData, title: newTitle }); }
  };

  const saveSnippet = async () => {
    if (!content && activeType !== 'image' && activeType !== 'video') return;
    try {
      const textToEmbed = `${title} ${content}`;
      const embedding = await generateEmbedding(textToEmbed);
      const dataPayload = { boardId, type: 'aiCard', position: { x: window.innerWidth/2, y: window.innerHeight/2 }, data: { type: activeType, title: title || 'Untitled', content, link, timestamp: new Date().toISOString(), embedding } };
      
      if (editingNodeId) {
        await updateDoc(doc(db, 'snippets', editingNodeId), { 'data.title': title, 'data.content': content, 'data.link': link, 'data.embedding': embedding });
      } else {
        await setDoc(doc(db, 'snippets', `node_${Date.now()}`), dataPayload);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to save snippet.");
    } finally {
      closeModal(); 
    }
  };

  // --- NEW: DIRECT FIRESTORE IMAGE UPLOAD (BASE64) ---
  const handleFileUpload = async (file: File | undefined, dropX?: number, dropY?: number) => {
    if (!file) return;

    // Strict 1MB Check for Firestore Documents
    const MAX_FILE_SIZE = 1000000; 
    if (file.size > MAX_FILE_SIZE) {
      alert(`⚠️ File is too large! The database has a strict 1MB limit. Please choose a smaller file.`);
      return;
    }

    setIsUploading(true);
    const fileType = file.type.startsWith('video/') ? 'video' : 'image';

    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        const base64Content = reader.result as string;
        
        await setDoc(doc(db, 'snippets', `node_${Date.now()}`), {
          boardId, type: 'aiCard', position: { x: dropX || window.innerWidth/2, y: dropY || window.innerHeight/2 },
          data: { type: fileType, title: file.name, content: base64Content, timestamp: new Date().toISOString() }
        });
        setIsUploading(false);
      };
      reader.onerror = (error) => {
        console.error("Error converting file:", error);
        alert("Failed to read file for database storage.");
        setIsUploading(false);
      };
    } catch (e: any) { 
      console.error(e); 
      alert(`Upload failed: ${e.message}`);
      setIsUploading(false); 
    }
  };

  const addShape = async (shapeType: string) => {
    await setDoc(doc(db, 'snippets', `shape_${Date.now()}`), { boardId, type: 'shape', position: { x: window.innerWidth/2, y: window.innerHeight/2 }, data: { shapeType, label: 'New Step' } });
    setIsDiagramMenuOpen(false);
  };

  const closeModal = () => { setIsModalOpen(false); setTitle(''); setContent(''); setLink(''); setEditingNodeId(null); };
  const handlePrivacyChange = async (newStatus: boolean) => { await updateDoc(doc(db, 'boards', boardId), { isPublic: newStatus }); setBoardData({ ...boardData, isPublic: newStatus }); };
  const copyLink = () => { navigator.clipboard.writeText(`${window.location.origin}/board/${boardId}`); setIsCopied(true); setTimeout(() => setIsCopied(false), 2000); };

  return (
    <div className="w-screen h-screen bg-[#F8FAFC] relative font-sans overflow-hidden"
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setIsDragging(false); if(e.dataTransfer.files[0]) handleFileUpload(e.dataTransfer.files[0], e.clientX, e.clientY); }}
    >
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*,video/*" onChange={(e) => handleFileUpload(e.target.files?.[0])} />

      {isUploading && <div className="absolute top-6 right-6 z-50 px-5 py-3 bg-white rounded-xl shadow-lg border flex items-center gap-3"><Loader2 className="w-5 h-5 text-blue-600 animate-spin" /><span className="text-sm font-bold text-black">Uploading...</span></div>}
      
      {/* Header */}
      <div className={`absolute top-4 left-4 right-4 z-10 flex justify-between items-center pointer-events-none ${isOverlay ? 'px-2' : ''}`}>
        <div className="flex gap-2 pointer-events-auto items-center">
          {!isOverlay && <button onClick={() => router.push('/')} className="p-2.5 bg-white rounded-xl shadow-sm border hover:bg-gray-50"><ChevronLeft className="w-5 h-5 text-gray-700" /></button>}
          <div onClick={handleRename} className={`px-4 py-2.5 bg-white rounded-xl shadow-sm border font-bold text-black cursor-pointer hover:bg-gray-50 items-center gap-2 flex text-sm py-1.5 px-3`}>
            {boardData?.title || 'Untitled'}
          </div>
          {!isOverlay && (
            <form onSubmit={executeSearch} className="relative group flex items-center bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm focus-within:ring-2 focus-within:ring-purple-500 transition-all w-10 focus-within:w-72 md:w-72">
                {isSearchingAI ? <Loader2 className="w-4 h-4 text-purple-500 animate-spin shrink-0" /> : <Search className="w-4 h-4 text-gray-400 shrink-0" />}
                <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Semantic Search (Press Enter)..." className="ml-2 bg-transparent outline-none text-sm text-gray-900 w-full placeholder-transparent md:placeholder-gray-400 focus:placeholder-gray-400 font-medium" />
                <button type="submit" className="hidden md:flex px-2 py-1 bg-purple-50 text-purple-600 text-[10px] font-bold rounded flex items-center gap-1 border border-purple-100"><Sparkles className="w-3 h-3" /> AI</button>
            </form>
          )}
        </div>

        <div className="flex gap-2 pointer-events-auto">
          {!isOverlay && <button onClick={clearBoard} className="p-2.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl shadow-sm border transition-all" title="Clear Entire Board"><Trash2 className="w-5 h-5" /></button>}
          {!isOverlay && <button onClick={() => setIsShareModalOpen(true)} className="p-2.5 bg-white rounded-xl shadow-sm border hover:bg-gray-50 text-gray-500 transition-all" title="Share Project">{boardData?.isPublic ? <Globe className="w-5 h-5 text-green-600" /> : <Lock className="w-5 h-5" />}</button>}
          {!isOverlay && <button onClick={openOverlayMode} className="p-2.5 bg-gray-900 hover:bg-black text-white rounded-xl shadow-lg transition-all active:scale-95" title="Sidecar Mode"><PictureInPicture2 className="w-5 h-5" /></button>}
        </div>
      </div>

      {/* Toolbar */}
      <div className={`absolute z-20 bg-white rounded-2xl shadow-2xl border border-gray-100 p-2 flex gap-2 ${isOverlay || (typeof window !== 'undefined' && window.innerWidth < 768) ? 'bottom-6 left-1/2 -translate-x-1/2 flex-row' : 'top-1/2 left-6 -translate-y-1/2 flex-col'}`}>
        <ToolButton icon={<Type />} label="Text" onClick={() => { setActiveType('text'); setIsModalOpen(true); }} />
        <ToolButton icon={<Code2 />} label="Code" onClick={() => { setActiveType('code'); setIsModalOpen(true); }} />
        <div className={`bg-gray-200 ${isOverlay ? 'w-px h-6' : 'w-full h-px my-auto'}`}></div>
        <ToolButton icon={<ImageIcon />} label="Image" onClick={() => fileInputRef.current?.click()} />
        <ToolButton icon={<Video />} label="Video" onClick={() => fileInputRef.current?.click()} />
        <ToolButton icon={<Link2 />} label="Embed" onClick={handleAddEmbed} />
        <div className={`bg-gray-200 ${isOverlay ? 'w-px h-6' : 'w-full h-px my-auto'}`}></div>
        
        <div className="relative flex flex-col items-center">
          <button onClick={() => setIsDiagramMenuOpen(!isDiagramMenuOpen)} className={`p-3 rounded-xl transition-all ${isDiagramMenuOpen ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:text-blue-600'}`}><Shapes className="w-6 h-6" /></button>
          {isDiagramMenuOpen && (
            <div className={`absolute bg-white border border-gray-100 shadow-xl rounded-2xl p-2 flex gap-2 animate-in fade-in ${isOverlay ? 'bottom-full mb-2 left-0 flex-row' : 'left-full ml-4 top-0 flex-col'}`}>
              <ToolButton icon={<Square />} label="Rect" onClick={() => addShape('rectangle')} />
              <ToolButton icon={<Circle />} label="Circ" onClick={() => addShape('circle')} />
              <ToolButton icon={<Diamond />} label="Dia" onClick={() => addShape('diamond')} />
              <ToolButton icon={<Database />} label="DB" onClick={() => addShape('database')} />
            </div>
          )}
        </div>
        <div className={`bg-gray-200 ${isOverlay ? 'w-px h-6' : 'w-full h-px my-auto'}`}></div>
        <ToolButton icon={<Wand2 className="text-purple-600" />} label="Organize" onClick={magicOrganize} />
      </div>


      {/* --- THE GEMINI-STYLE CHAT INTERFACE --- */}
      {isChatOpen && (
        <div className={
          isFullscreenChat 
            ? "fixed inset-0 z-50 bg-white flex flex-col animate-in fade-in duration-300" 
            : "absolute bottom-24 right-6 w-[420px] max-w-[90vw] h-[650px] bg-white border border-gray-200 rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-5 z-40"
        }>
          
          <div className="px-6 py-4 flex justify-between items-center bg-white border-b border-gray-100 shrink-0">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-blue-600" />
              <span className="font-medium text-lg text-gray-800 tracking-tight">BrainCache <span className="text-blue-600 font-bold">AI</span></span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setIsFullscreenChat(!isFullscreenChat)} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors">
                {isFullscreenChat ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
              </button>
              <button onClick={() => { setIsChatOpen(false); setIsFullscreenChat(false); }} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div ref={chatScrollRef} className="flex-1 overflow-y-auto bg-white">
            <div className={`mx-auto w-full space-y-8 py-8 ${isFullscreenChat ? 'max-w-4xl px-8' : 'px-5'}`}>
              
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start gap-4'}`}>
                  {msg.role === 'ai' && <div className="shrink-0 mt-1"><Sparkles className="w-6 h-6 text-blue-600" /></div>}
                  {msg.role === 'user' ? (
                    <div className="bg-gray-100 text-gray-900 px-5 py-3 rounded-[24px] rounded-br-sm max-w-[85%] text-[15px] font-medium leading-relaxed shadow-sm">
                      {msg.text}
                    </div>
                  ) : (
                    <div className="text-gray-900 text-[15px] leading-relaxed max-w-full whitespace-pre-wrap mt-1">
                      {msg.text}
                    </div>
                  )}
                </div>
              ))}

              {isChatLoading && (
                <div className="flex justify-start gap-4">
                  <div className="shrink-0 mt-1"><Sparkles className="w-6 h-6 text-blue-600 animate-pulse" /></div>
                  <div className="text-gray-400 text-[15px] font-medium mt-1 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Generating...
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className={`bg-white shrink-0 pb-6 pt-2 ${isFullscreenChat ? 'w-full max-w-4xl mx-auto px-8' : 'px-5'}`}>
            <form onSubmit={handleSendMessage} className="relative flex items-end gap-2 bg-gray-100 rounded-[28px] p-2 focus-within:bg-gray-200/50 transition-colors border border-gray-200/50">
              <input 
                value={chatInput} 
                onChange={(e) => setChatInput(e.target.value)} 
                placeholder="Ask BrainCache AI..." 
                className="flex-1 bg-transparent px-4 py-3 min-h-[48px] text-[15px] text-gray-900 placeholder-gray-500 font-medium outline-none"
                disabled={isChatLoading} 
              />
              <button 
                type="submit" 
                disabled={!chatInput.trim() || isChatLoading} 
                className="p-3 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 shrink-0 mb-0.5 mr-0.5 transition-colors"
              >
                <Send className="w-5 h-5" />
              </button>
            </form>
            {isFullscreenChat && <p className="text-center text-[11px] text-gray-400 mt-4 font-medium">BrainCache AI may display inaccurate info, so double-check its responses.</p>}
          </div>
        </div>
      )}

      {/* Floating Chat Toggle Button */}
      {!isFullscreenChat && (
        <div className={`absolute bottom-6 right-6 z-30 ${isOverlay ? 'hidden' : ''}`}>
          <button 
            onClick={() => setIsChatOpen(!isChatOpen)} 
            className="p-4 rounded-full shadow-2xl transition-all duration-300 hover:scale-105 active:scale-95 flex items-center justify-center bg-blue-600 text-white hover:bg-blue-700"
            title="Chat with Board AI"
          >
            {isChatOpen ? <X className="w-6 h-6" /> : <Sparkles className="w-6 h-6" />}
          </button>
        </div>
      )}

      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} nodeTypes={nodeTypes} fitView>
        <Background color="#CBD5E1" gap={24} size={2} />
        {!isOverlay && <Controls className="hidden md:flex bg-white border-gray-200 shadow-sm rounded-xl overflow-hidden" showInteractive={false} />}
      </ReactFlow>

      {/* Modals */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[550px] rounded-3xl p-6 shadow-2xl animate-in fade-in zoom-in-95 border border-gray-200">
             <div className="flex justify-between items-center border-b border-gray-100 pb-4 mb-4">
               <h2 className="font-bold uppercase text-black text-sm">{editingNodeId ? 'Edit' : 'Save'} Snippet</h2>
               <button onClick={closeModal}><X className="w-5 h-5 text-gray-400" /></button>
             </div>
             <div className="space-y-4">
               <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="w-full p-3 bg-gray-50 border rounded-xl text-black outline-none font-medium text-gray-900" />
               <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Paste content here..." className="w-full h-40 p-3 bg-gray-50 border rounded-xl text-black resize-none outline-none font-medium text-gray-900" />
               <button onClick={saveSnippet} className="w-full py-4 bg-blue-600 text-white font-bold rounded-xl shadow-md hover:bg-blue-700 transition-colors">Save Snippet</button>
             </div>
          </div>
        </div>
      )}

      {isShareModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h3 className="font-bold text-lg text-gray-900">Share Board</h3>
              <button onClick={() => setIsShareModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-full ${boardData?.isPublic ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                    {boardData?.isPublic ? <Globe className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">General Access</p>
                    <p className="text-xs text-gray-500">{boardData?.isPublic ? "Anyone with the link can view" : "Only you can access"}</p>
                  </div>
                </div>
                <div className="relative group">
                  <select value={boardData?.isPublic ? "public" : "private"} onChange={(e) => handlePrivacyChange(e.target.value === 'public')} className="appearance-none bg-transparent pl-2 pr-8 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-100 rounded-lg cursor-pointer outline-none focus:ring-2 focus:ring-blue-500/20">
                    <option value="private">Restricted</option>
                    <option value="public">Anyone with link</option>
                  </select>
                  <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
              {boardData?.isPublic && (
                <div className="animate-in slide-in-from-top-2 fade-in">
                  <div className="flex items-center gap-2 p-1.5 bg-gray-50 border border-gray-200 rounded-xl">
                    <div className="flex-1 px-3 py-1.5 overflow-hidden">
                      <p className="text-xs text-gray-400 font-medium uppercase mb-0.5">Project Link</p>
                      <p className="text-sm text-gray-700 truncate font-mono">{`${window.location.origin}/board/${boardId}`}</p>
                    </div>
                    <button onClick={copyLink} className={`px-4 py-2.5 rounded-lg font-bold text-sm transition-all flex items-center gap-2 ${isCopied ? 'bg-green-600 text-white shadow-lg shadow-green-600/20' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-600/20'}`}>
                      {isCopied ? <>Copied <Check className="w-4 h-4" /></> : <>Copy <Copy className="w-4 h-4" /></>}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

const ToolButton = ({ icon, label, onClick }: any) => (
  <button onClick={onClick} className="p-3 text-gray-500 hover:bg-gray-100 hover:text-gray-900 rounded-xl transition-all flex flex-col items-center justify-center">
    {icon} 
  </button>
);