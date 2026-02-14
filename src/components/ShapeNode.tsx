'use client';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ReactFlow, Background, Controls, applyNodeChanges, applyEdgeChanges, addEdge, NodeChange, EdgeChange, Connection, Node, Edge, useReactFlow, ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { db, storage } from '@/lib/firebase';
import { collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc, query, where, writeBatch, getDoc } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { Type, Code2, Image as ImageIcon, Video, X, ChevronLeft, Square, Circle, Diamond, Shapes, Loader2, UploadCloud, Wand2, Copy, Globe, Lock, Search, PictureInPicture2, Database, Sparkles } from 'lucide-react';
import AICardNode from '@/components/AICardNode';
import ShapeNode from '@/components/ShapeNode';

const nodeTypes = { aiCard: AICardNode, shape: ShapeNode };

// --- AI MATH: COSINE SIMILARITY ---
function cosineSimilarity(vecA: number[], vecB: number[]) {
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// --- AI API: GENERATE VECTOR EMBEDDING ---
async function generateEmbedding(text: string) {
  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'models/text-embedding-004', content: { parts: [{ text }] } })
    });
    const data = await res.json();
    return data.embedding.values;
  } catch (e) { console.error("Embedding failed", e); return null; }
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
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeType, setActiveType] = useState('text');
  const [isDiagramMenuOpen, setIsDiagramMenuOpen] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);

  // Search States
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchingAI, setIsSearchingAI] = useState(false);

  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [link, setLink] = useState('');

  // 1. Initial Setup
  useEffect(() => {
    if (!boardId) return;
    const fetchBoardMeta = async () => {
      const bDoc = await getDoc(doc(db, 'boards', boardId));
      if (bDoc.exists()) setBoardData(bDoc.data());
    };
    fetchBoardMeta();

    const qNodes = query(collection(db, 'snippets'), where("boardId", "==", boardId));
    const unsubNodes = onSnapshot(qNodes, (snapshot) => {
      setNodes(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Node[]);
    });

    const qEdges = query(collection(db, 'boardEdges'), where("boardId", "==", boardId));
    const unsubEdges = onSnapshot(qEdges, (snapshot) => {
      setEdges(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Edge[]);
    });

    const handleEditEvent = (e: any) => {
      const { id, data } = e.detail;
      setEditingNodeId(id);
      setActiveType(data.type);
      setTitle(data.title || '');
      setContent(data.content || '');
      setLink(data.link || '');
      setIsModalOpen(true);
    };
    window.addEventListener('editNode', handleEditEvent);

    return () => { unsubNodes(); unsubEdges(); window.removeEventListener('editNode', handleEditEvent); };
  }, [boardId]);

  // React Flow Handlers
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
    changes.forEach((change) => {
      if (change.type === 'position' && !change.dragging && change.position) {
        updateDoc(doc(db, 'snippets', change.id), { position: change.position });
      }
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
    setEdges((eds) => addEdge(newEdge, eds as any));
    setDoc(doc(db, 'boardEdges', newEdge.id), newEdge);
  }, [boardId]);


  // --- AI FEATURE: SEMANTIC SEARCH ENGINE ---
  const executeSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      // Clear Highlights
      setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, isSearchResult: false } })));
      return;
    }

    setIsSearchingAI(true);
    try {
      // 1. Convert user's question into a Vector Array
      const queryEmbedding = await generateEmbedding(searchQuery);
      
      if (!queryEmbedding) {
         // Fallback to exact text search if API fails
         const lowerQuery = searchQuery.toLowerCase();
         setNodes(nds => nds.map(n => ({
            ...n, 
            data: { ...n.data, isSearchResult: (n.data.title as string)?.toLowerCase().includes(lowerQuery) || (n.data.content as string)?.toLowerCase().includes(lowerQuery) }
         })));
         return;
      }

      // 2. Perform Cosine Similarity Math against all Nodes
      let bestNode: Node | null = null;
      let highestScore = 0;

      const scoredNodes = nodes.map(n => {
        let score = 0;
        if (n.data.embedding) {
          score = cosineSimilarity(queryEmbedding, n.data.embedding as number[]);
        } else {
          // Fallback scoring if node has no embedding saved
          score = ((n.data.content as string)?.toLowerCase().includes(searchQuery.toLowerCase()) ? 0.5 : 0);
        }

        if (score > highestScore) {
          highestScore = score;
          bestNode = n;
        }

        // Similarity Threshold (0.65 is usually a good semantic match)
        return { ...n, data: { ...n.data, isSearchResult: score > 0.65 } };
      });

      setNodes(scoredNodes);

      // 3. Zoom to the best match
      if (bestNode && highestScore > 0.65) {
        setCenter(bestNode.position.x + 200, bestNode.position.y + 150, { zoom: 1.2, duration: 1000 });
      } else {
        alert("No strong semantic matches found.");
      }

    } finally {
      setIsSearchingAI(false);
    }
  };


  // Basic Features
  const openOverlayMode = () => {
    const width = 480; const height = 800; const left = window.screen.width - width - 20; const top = 80;
    window.open(`/board/${boardId}?mode=overlay`, 'BrainCacheOverlay', `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes`);
  };

  const magicOrganize = async () => { /* Hidden to save space in prompt, KEEP YOUR PREVIOUS LOGIC HERE */ };
  const cloneBoard = async () => { /* Hidden to save space in prompt, KEEP YOUR PREVIOUS LOGIC HERE */ };
  const handleRename = async () => { /* Hidden to save space in prompt, KEEP YOUR PREVIOUS LOGIC HERE */ };
  const handleShare = async () => { /* Hidden to save space in prompt, KEEP YOUR PREVIOUS LOGIC HERE */ };

  // --- UPDATED SAVE: NOW SAVES EMBEDDINGS ---
  const saveSnippet = async () => {
    if (!content && activeType !== 'image' && activeType !== 'video') return;
    
    // Generate AI Vector for the content
    const textToEmbed = `${title} ${content}`;
    const embedding = await generateEmbedding(textToEmbed);

    const dataPayload = { 
      boardId, 
      type: 'aiCard', 
      position: { x: window.innerWidth/2, y: window.innerHeight/2 }, 
      data: { type: activeType, title: title || 'Untitled', content, link, timestamp: new Date().toISOString(), embedding } 
    };

    if (editingNodeId) {
      await updateDoc(doc(db, 'snippets', editingNodeId), { 'data.title': title, 'data.content': content, 'data.link': link, 'data.embedding': embedding });
    } else {
      await setDoc(doc(db, 'snippets', `node_${Date.now()}`), dataPayload);
    }
    closeModal();
  };

  const handleFileUpload = async (file: File | undefined, dropX?: number, dropY?: number) => { /* KEEP PREV LOGIC */ };
  const addShape = async (shapeType: string) => { /* KEEP PREV LOGIC */ };
  const closeModal = () => { setIsModalOpen(false); setTitle(''); setContent(''); setLink(''); setEditingNodeId(null); };

  return (
    <div className="w-screen h-screen bg-[#F8FAFC] relative font-sans overflow-hidden"
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setIsDragging(false); if(e.dataTransfer.files[0]) handleFileUpload(e.dataTransfer.files[0], e.clientX, e.clientY); }}
    >
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*,video/*" onChange={(e) => handleFileUpload(e.target.files?.[0])} />

      {/* Loading Overlays */}
      {isUploading && <div className="absolute top-6 right-6 z-50 px-5 py-3 bg-white rounded-xl shadow-lg border flex items-center gap-3"><Loader2 className="w-5 h-5 text-blue-600 animate-spin" /><span className="text-sm font-bold text-black">Uploading...</span></div>}
      
      {/* Header */}
      <div className={`absolute top-4 left-4 right-4 z-10 flex justify-between items-center pointer-events-none ${isOverlay ? 'px-2' : ''}`}>
        <div className="flex gap-2 pointer-events-auto items-center">
          {!isOverlay && <button onClick={() => router.push('/')} className="p-2.5 bg-white rounded-xl shadow-sm border hover:bg-gray-50"><ChevronLeft className="w-5 h-5 text-gray-700" /></button>}
          <div onClick={handleRename} className={`px-4 py-2.5 bg-white rounded-xl shadow-sm border font-bold text-black cursor-pointer hover:bg-gray-50 items-center gap-2 ${isOverlay ? 'flex text-sm py-1.5 px-3' : 'hidden md:flex'}`}>
            {boardData?.title || 'Untitled'}
          </div>

          {/* UPDATED AI SEARCH BAR */}
          {!isOverlay && (
            <form onSubmit={executeSearch} className="relative group flex items-center bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm focus-within:ring-2 focus-within:ring-purple-500 transition-all w-10 focus-within:w-72 md:w-72">
                {isSearchingAI ? <Loader2 className="w-4 h-4 text-purple-500 animate-spin shrink-0" /> : <Search className="w-4 h-4 text-gray-400 shrink-0" />}
                <input 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Semantic Search (Press Enter)..." 
                  className="ml-2 bg-transparent outline-none text-sm text-gray-700 w-full placeholder-transparent md:placeholder-gray-400 focus:placeholder-gray-400"
                />
                <button type="submit" className="hidden md:flex px-2 py-1 bg-purple-50 text-purple-600 text-[10px] font-bold rounded flex items-center gap-1 border border-purple-100">
                  <Sparkles className="w-3 h-3" /> AI
                </button>
            </form>
          )}
        </div>

        <div className="flex gap-2 pointer-events-auto">
          {!isOverlay && <button onClick={openOverlayMode} className="p-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-lg shadow-blue-500/20 transition-all active:scale-95" title="Sidecar Mode"><PictureInPicture2 className="w-5 h-5" /></button>}
        </div>
      </div>

      {/* Toolbar */}
      <div className={`absolute z-20 bg-white rounded-2xl shadow-2xl border border-gray-100 p-2 flex gap-2 ${isOverlay || (typeof window !== 'undefined' && window.innerWidth < 768) ? 'bottom-6 left-1/2 -translate-x-1/2 flex-row' : 'top-1/2 left-6 -translate-y-1/2 flex-col'}`}>
        <ToolButton icon={<Type />} label="Text" onClick={() => { setActiveType('text'); setIsModalOpen(true); }} />
        <ToolButton icon={<Code2 />} label="Code" onClick={() => { setActiveType('code'); setIsModalOpen(true); }} />
        <div className={`bg-gray-200 ${isOverlay ? 'w-px h-6' : 'w-full h-px my-auto'}`}></div>
        <ToolButton icon={<ImageIcon />} label="Image" onClick={() => fileInputRef.current?.click()} />
        <ToolButton icon={<Video />} label="Video" onClick={() => fileInputRef.current?.click()} />
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

      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} nodeTypes={nodeTypes} fitView>
        <Background color="#CBD5E1" gap={24} size={2} />
        {!isOverlay && <Controls className="hidden md:flex bg-white border-gray-200 shadow-sm rounded-xl overflow-hidden" showInteractive={false} />}
      </ReactFlow>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[550px] rounded-3xl p-6 shadow-2xl animate-in fade-in zoom-in-95 border border-gray-200">
             <div className="flex justify-between items-center border-b border-gray-100 pb-4 mb-4">
               <h2 className="font-bold uppercase text-black text-sm">{editingNodeId ? 'Edit' : 'Save'} Snippet</h2>
               <button onClick={closeModal}><X className="w-5 h-5 text-gray-400" /></button>
             </div>
             <div className="space-y-4">
               <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="w-full p-3 bg-gray-50 border rounded-xl text-black outline-none" />
               <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Paste content here..." className="w-full h-40 p-3 bg-gray-50 border rounded-xl text-black resize-none outline-none" />
               <button onClick={saveSnippet} className="w-full py-4 bg-blue-600 text-white font-bold rounded-xl shadow-md">Save Snippet</button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}

const ToolButton = ({ icon, label, onClick }: any) => (
  <button onClick={onClick} className="p-3 text-gray-500 hover:bg-gray-100 hover:text-blue-600 rounded-xl transition-all flex flex-col items-center justify-center">
    {icon} 
  </button>
);