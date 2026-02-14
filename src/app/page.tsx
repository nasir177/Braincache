'use client';
import { useRouter } from 'next/navigation';
import { Plus, Layers, LayoutGrid, Trash2, Globe, Lock, Share2, X, Copy, Check, ChevronDown } from 'lucide-react';
import { useState, useEffect } from 'react';
import { collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { formatDistanceToNow } from 'date-fns';

export default function Dashboard() {
  const router = useRouter();
  const [boards, setBoards] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // --- SHARE MODAL STATE ---
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [selectedBoard, setSelectedBoard] = useState<any>(null);
  const [isCopied, setIsCopied] = useState(false);

  // 1. Fetch Boards
  useEffect(() => {
    const fetchBoards = async () => {
      const q = query(collection(db, 'boards'), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      setBoards(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setIsLoading(false);
    };
    fetchBoards();
  }, []);

  // 2. Create New Board
  const createNewProject = async () => {
    const docRef = await addDoc(collection(db, 'boards'), {
      title: 'Untitled Board',
      createdAt: new Date().toISOString(),
      isPublic: false, 
    });
    router.push(`/board/${docRef.id}`);
  };

  // 3. Delete Board
  const deleteBoard = async (e: any, id: string) => {
    e.stopPropagation();
    if (confirm('Are you sure? This deletes the board and all contents.')) {
      await deleteDoc(doc(db, 'boards', id));
      setBoards(boards.filter(b => b.id !== id));
    }
  };

  // 4. Open Share Modal
  const openShareModal = (e: any, board: any) => {
    e.stopPropagation();
    setSelectedBoard(board);
    setIsShareModalOpen(true);
    setIsCopied(false);
  };

  // 5. Toggle Public/Private inside Modal
  const handlePrivacyChange = async (newStatus: boolean) => {
    if (!selectedBoard) return;
    
    // Optimistic Update
    const updatedBoard = { ...selectedBoard, isPublic: newStatus };
    setSelectedBoard(updatedBoard);
    setBoards(boards.map(b => b.id === selectedBoard.id ? updatedBoard : b));

    // Firebase Update
    await updateDoc(doc(db, 'boards', selectedBoard.id), { isPublic: newStatus });
  };

  // 6. Copy Link Logic
  const copyLink = () => {
    const url = `${window.location.origin}/board/${selectedBoard.id}`;
    navigator.clipboard.writeText(url);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans selection:bg-blue-100 pb-20 relative">
      {/* Navbar */}
      <nav className="h-16 bg-white border-b border-gray-200 px-4 md:px-8 flex items-center justify-between sticky top-0 z-40 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-600 rounded-lg shadow-lg shadow-blue-600/20">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-black tracking-tight text-gray-900">BRAINCACHE</span>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 md:px-8 py-8 md:py-12">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 md:mb-12 gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold text-gray-900 tracking-tight mb-2 md:mb-3">Your Workspaces</h1>
            <p className="text-lg text-gray-500">Manage your AI research, code snippets, and diagrams.</p>
          </div>
          <button 
            onClick={createNewProject}
            className="w-full md:w-auto px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2 transition-all active:scale-95"
          >
            <Plus className="w-5 h-5" /> New Board
          </button>
        </div>

        {/* Grid Layout */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
          
          {/* Create New Card */}
          <div 
            onClick={createNewProject}
            className="group h-64 bg-white border-2 border-dashed border-gray-300 hover:border-blue-500 rounded-3xl flex flex-col items-center justify-center cursor-pointer transition-all hover:shadow-xl hover:-translate-y-1"
          >
            <div className="p-4 bg-gray-50 group-hover:bg-blue-50 rounded-full mb-4 transition-colors">
                <Plus className="w-8 h-8 text-gray-400 group-hover:text-blue-600 transition-colors" />
            </div>
            <span className="font-bold text-gray-500 group-hover:text-blue-600 transition-colors">Create Empty Board</span>
          </div>

          {/* Render Boards */}
          {isLoading ? (
            <div className="h-64 flex items-center justify-center text-gray-400">Loading workspaces...</div>
          ) : boards.map((board) => (
            <div 
              key={board.id}
              onClick={() => router.push(`/board/${board.id}`)}
              className="group h-64 bg-white border border-gray-200 rounded-3xl p-6 flex flex-col justify-between hover:shadow-xl hover:border-blue-200 hover:-translate-y-1 transition-all cursor-pointer relative overflow-hidden"
            >
               {/* Background Decor */}
               <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <LayoutGrid className="w-32 h-32 text-blue-600 -mr-8 -mt-8" />
               </div>

               {/* Top Actions */}
               <div className="flex justify-between items-start relative z-10">
                 <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center text-purple-600 font-bold">
                    {board.title.substring(0, 2).toUpperCase()}
                 </div>
                 <div className="flex gap-1">
                    <button 
                      onClick={(e) => openShareModal(e, board)}
                      className={`p-2 rounded-full hover:bg-gray-100 transition-colors ${board.isPublic ? 'text-green-600' : 'text-gray-400'}`}
                      title="Share Project"
                    >
                      <Share2 className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={(e) => deleteBoard(e, board.id)}
                      className="p-2 rounded-full hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                      title="Delete Project"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                 </div>
               </div>

               {/* Bottom Info */}
               <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-xl font-bold text-gray-900 truncate">{board.title}</h3>
                    {board.isPublic ? <Globe className="w-3 h-3 text-green-500" /> : <Lock className="w-3 h-3 text-gray-400" />}
                  </div>
                  <p className="text-sm text-gray-400">
                    Created {formatDistanceToNow(new Date(board.createdAt))} ago
                  </p>
               </div>
            </div>
          ))}
        </div>
      </main>

      {/* --- FIGMA STYLE SHARE MODAL --- */}
      {isShareModalOpen && selectedBoard && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h3 className="font-bold text-lg text-gray-900">Share "{selectedBoard.title}"</h3>
              <button onClick={() => setIsShareModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-6">
              
              {/* Access Level Section */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-full ${selectedBoard.isPublic ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                    {selectedBoard.isPublic ? <Globe className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">General Access</p>
                    <p className="text-xs text-gray-500">
                      {selectedBoard.isPublic ? "Anyone with the link can view" : "Only you can access"}
                    </p>
                  </div>
                </div>
                
                {/* Custom Toggle Dropdown */}
                <div className="relative group">
                  <select 
                    value={selectedBoard.isPublic ? "public" : "private"}
                    onChange={(e) => handlePrivacyChange(e.target.value === 'public')}
                    className="appearance-none bg-transparent pl-2 pr-8 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-100 rounded-lg cursor-pointer outline-none focus:ring-2 focus:ring-blue-500/20"
                  >
                    <option value="private">Restricted</option>
                    <option value="public">Anyone with link</option>
                  </select>
                  <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              {/* Link Copy Section (Only visible if Public) */}
              {selectedBoard.isPublic && (
                <div className="animate-in slide-in-from-top-2 fade-in">
                  <div className="flex items-center gap-2 p-1.5 bg-gray-50 border border-gray-200 rounded-xl">
                    <div className="flex-1 px-3 py-1.5 overflow-hidden">
                      <p className="text-xs text-gray-400 font-medium uppercase mb-0.5">Project Link</p>
                      <p className="text-sm text-gray-700 truncate font-mono">
                        {typeof window !== 'undefined' ? `${window.location.origin}/board/${selectedBoard.id}` : '...'}
                      </p>
                    </div>
                    <button 
                      onClick={copyLink}
                      className={`px-4 py-2.5 rounded-lg font-bold text-sm transition-all flex items-center gap-2 ${isCopied ? 'bg-green-600 text-white shadow-lg shadow-green-600/20' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-600/20'}`}
                    >
                      {isCopied ? (
                        <>Copied <Check className="w-4 h-4" /></>
                      ) : (
                        <>Copy <Copy className="w-4 h-4" /></>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Footer Note */}
              {!selectedBoard.isPublic && (
                <div className="p-3 bg-yellow-50 text-yellow-800 text-xs rounded-lg border border-yellow-100 flex gap-2 items-start">
                  <Lock className="w-3 h-3 mt-0.5 shrink-0" />
                  <p>You must change access to <b>"Anyone with link"</b> before you can copy the URL.</p>
                </div>
              )}

            </div>
          </div>
        </div>
      )}
    </div>
  );
}