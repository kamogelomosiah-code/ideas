import { useState, useEffect, ReactNode, Component } from 'react';
import { 
  Plus, Lightbulb, Target, Calendar, Trash2, LogOut, LogIn, 
  CheckCircle2, Clock, ChevronRight, Search, X, ArrowUpDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, User } from 'firebase/auth';
import { collection, addDoc, onSnapshot, query, where, orderBy, deleteDoc, doc, getDocFromServer } from 'firebase/firestore';
import { format, isPast, parseISO } from 'date-fns';
import { auth, db } from './firebase';

// --- Types ---
enum OperationType { CREATE = 'create', UPDATE = 'update', DELETE = 'delete', LIST = 'list', GET = 'get', WRITE = 'write' }

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

interface Note {
  id: string;
  title: string;
  content: string;
  type: 'idea' | 'goal';
  targetDate?: string;
  userId: string;
  createdAt: string;
}

// --- Error Handling ---
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-zinc-50 p-6">
          <div className="max-w-md w-full bg-white p-8 rounded-3xl shadow-xl shadow-zinc-200/50 border border-zinc-100">
            <h2 className="text-2xl font-semibold text-zinc-900 mb-4">Something went wrong</h2>
            <p className="text-zinc-500 mb-8">
              {this.state.error?.message.startsWith('{') 
                ? "A database error occurred. Please check your connection."
                : this.state.error?.message || "An unexpected error occurred."}
            </p>
            <button onClick={() => window.location.reload()} className="w-full py-3.5 bg-zinc-900 text-white rounded-xl font-medium hover:bg-zinc-800 transition-colors">
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Components ---

function NoteCard({ note, onDelete }: { note: Note; onDelete: (id: string) => void }) {
  const isGoal = note.type === 'goal';
  const Icon = isGoal ? Target : Lightbulb;
  const isOverdue = note.targetDate && isPast(parseISO(note.targetDate));

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="group relative bg-white border border-zinc-200/60 rounded-3xl p-6 shadow-sm hover:shadow-xl hover:shadow-zinc-200/50 transition-all duration-300 flex flex-col"
    >
      <div className="flex items-start justify-between mb-5">
        <div className={`p-3 rounded-2xl ${isGoal ? 'bg-indigo-50 text-indigo-600' : 'bg-amber-50 text-amber-600'}`}>
          <Icon className="w-5 h-5" />
        </div>
        <button 
          onClick={() => onDelete(note.id)}
          className="p-2 text-zinc-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <h3 className="text-lg font-semibold text-zinc-900 mb-3 leading-tight">{note.title}</h3>
      <p className="text-zinc-500 text-sm leading-relaxed mb-6 flex-grow whitespace-pre-wrap">
        {note.content}
      </p>

      <div className="pt-5 border-t border-zinc-100 flex flex-col gap-3">
        {note.targetDate && (
          <div className={`flex items-center gap-2 text-xs font-medium ${isOverdue ? 'text-red-500' : 'text-zinc-500'}`}>
            <Clock className="w-3.5 h-3.5" />
            <span>{format(parseISO(note.targetDate), 'MMM d, yyyy')}</span>
            {isOverdue && <span className="bg-red-50 px-2 py-0.5 rounded-md text-[10px] uppercase tracking-wider font-semibold">Overdue</span>}
          </div>
        )}
        <div className="flex items-center justify-between text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
          <span>{format(parseISO(note.createdAt), 'MMM d')}</span>
          <span className="flex items-center gap-1">
            {note.type} <ChevronRight className="w-3 h-3" />
          </span>
        </div>
      </div>
    </motion.div>
  );
}

function AddNoteModal({ 
  isOpen, 
  onClose, 
  onAdd, 
  userId 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  onAdd: (note: Omit<Note, 'id'>) => Promise<void>;
  userId: string;
}) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [type, setType] = useState<'idea' | 'goal'>('goal'); // Default to goal to emphasize it
  const [targetDate, setTargetDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setContent('');
      setType('goal');
      setTargetDate('');
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim() || isSubmitting) return;
    
    setIsSubmitting(true);
    
    const newNote: Omit<Note, 'id'> = {
      title: title.trim(),
      content: content.trim(),
      type,
      userId,
      createdAt: new Date().toISOString()
    };
    
    if (targetDate) {
      newNote.targetDate = new Date(targetDate).toISOString();
    }
    
    await onAdd(newNote);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-zinc-900/20 backdrop-blur-sm"
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-lg bg-white rounded-[2rem] shadow-2xl overflow-hidden"
          >
            <form onSubmit={handleSubmit} className="p-6 sm:p-8">
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-2xl font-semibold text-zinc-900">New {type === 'idea' ? 'Idea' : 'Goal'}</h3>
                <button type="button" onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex bg-zinc-100/80 p-1.5 rounded-2xl mb-8">
                <button
                  type="button"
                  onClick={() => setType('goal')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    type === 'goal' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                  }`}
                >
                  <Target className="w-4 h-4" /> Goal
                </button>
                <button
                  type="button"
                  onClick={() => setType('idea')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    type === 'idea' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                  }`}
                >
                  <Lightbulb className="w-4 h-4" /> Idea
                </button>
              </div>

              <div className="space-y-5">
                <div>
                  <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2 ml-1">Title</label>
                  <input 
                    required type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                    placeholder={type === 'goal' ? "What do you want to achieve?" : "What's on your mind?"}
                    className="w-full px-5 py-3.5 bg-zinc-50 border border-zinc-200/80 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-300 transition-all placeholder:text-zinc-400"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2 ml-1">Description</label>
                  <textarea 
                    required rows={4} value={content} onChange={(e) => setContent(e.target.value)}
                    placeholder="Add more details..."
                    className="w-full px-5 py-3.5 bg-zinc-50 border border-zinc-200/80 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-300 transition-all resize-none placeholder:text-zinc-400"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2 ml-1">
                    Target Date {type === 'idea' && '(Optional)'}
                  </label>
                  <div className="relative">
                    <Calendar className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                    <input 
                      type="datetime-local" 
                      value={targetDate} 
                      onChange={(e) => setTargetDate(e.target.value)}
                      required={type === 'goal'}
                      className="w-full pl-12 pr-5 py-3.5 bg-zinc-50 border border-zinc-200/80 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-300 transition-all text-zinc-600"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-10">
                <button 
                  type="submit" disabled={isSubmitting}
                  className="w-full py-4 bg-zinc-900 text-white rounded-2xl font-medium hover:bg-zinc-800 active:scale-[0.98] transition-all shadow-lg shadow-zinc-200 disabled:opacity-70"
                >
                  {isSubmitting ? 'Saving...' : `Save ${type}`}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<Note[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [filter, setFilter] = useState<'all' | 'idea' | 'goal'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'target-asc' | 'target-desc'>('newest');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    async function testConnection() {
      try { await getDocFromServer(doc(db, 'test', 'connection')); } 
      catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    testConnection();
  }, []);

  useEffect(() => {
    if (!user) { setNotes([]); return; }
    const path = 'notes';
    const q = query(collection(db, path), where('userId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setNotes(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Note[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, path));
    return () => unsubscribe();
  }, [user]);

  const handleLogin = async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); } 
    catch (error) { console.error('Login Error:', error); }
  };

  const handleLogout = async () => {
    try { await signOut(auth); } 
    catch (error) { console.error('Logout Error:', error); }
  };

  const handleAddNote = async (noteData: Omit<Note, 'id'>) => {
    try { await addDoc(collection(db, 'notes'), noteData); } 
    catch (error) { handleFirestoreError(error, OperationType.CREATE, 'notes'); }
  };

  const handleDeleteNote = async (id: string) => {
    try { await deleteDoc(doc(db, 'notes', id)); } 
    catch (error) { handleFirestoreError(error, OperationType.DELETE, `notes/${id}`); }
  };

  const sortedAndFilteredNotes = notes
    .filter(note => {
      const matchesFilter = filter === 'all' || note.type === filter;
      const matchesSearch = note.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            note.content.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesFilter && matchesSearch;
    })
    .sort((a, b) => {
      if (sortBy === 'newest') {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      if (sortBy === 'oldest') {
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      if (sortBy === 'target-asc') {
        if (!a.targetDate) return 1;
        if (!b.targetDate) return -1;
        return new Date(a.targetDate).getTime() - new Date(b.targetDate).getTime();
      }
      if (sortBy === 'target-desc') {
        if (!a.targetDate) return 1;
        if (!b.targetDate) return -1;
        return new Date(b.targetDate).getTime() - new Date(a.targetDate).getTime();
      }
      return 0;
    });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-zinc-200 rounded-2xl"></div>
          <div className="h-3 w-24 bg-zinc-200 rounded-full"></div>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen flex flex-col bg-zinc-50 text-zinc-900 selection:bg-zinc-200/60">
        {/* Navigation */}
        <nav className="sticky top-0 z-40 bg-zinc-50/80 backdrop-blur-xl border-b border-zinc-200/60">
          <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center shadow-sm shadow-zinc-900/20">
                <Target className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-xl font-bold tracking-tight">Focus</h1>
            </div>
            
            {user ? (
              <div className="flex items-center gap-5">
                <div className="hidden sm:flex flex-col items-end">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Account</span>
                  <span className="text-sm font-medium">{user.displayName}</span>
                </div>
                <button 
                  onClick={handleLogout}
                  className="p-2.5 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-200/50 rounded-xl transition-all"
                  title="Logout"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <button 
                onClick={handleLogin}
                className="flex items-center gap-2 px-5 py-2.5 bg-zinc-900 text-white rounded-xl text-sm font-medium hover:bg-zinc-800 transition-all shadow-sm"
              >
                <LogIn className="w-4 h-4" /> Sign In
              </button>
            )}
          </div>
        </nav>

        <main className="flex-grow max-w-6xl mx-auto w-full px-6 py-12 sm:py-20">
          {!user ? (
            <div className="text-center py-20">
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-md mx-auto">
                <div className="w-24 h-24 bg-white border border-zinc-100 shadow-xl shadow-zinc-200/40 rounded-[2rem] flex items-center justify-center mx-auto mb-10">
                  <Target className="w-10 h-10 text-zinc-400" />
                </div>
                <h2 className="text-4xl sm:text-5xl font-bold mb-6 tracking-tight text-zinc-900">Achieve your goals.</h2>
                <p className="text-zinc-500 mb-12 text-lg leading-relaxed">
                  A beautifully simple space to organize your creative ideas and track your life goals with target dates.
                </p>
                <button 
                  onClick={handleLogin}
                  className="w-full py-4 bg-zinc-900 text-white rounded-2xl font-medium hover:bg-zinc-800 transition-all shadow-xl shadow-zinc-900/10 flex items-center justify-center gap-3 text-lg"
                >
                  <LogIn className="w-5 h-5" /> Continue with Google
                </button>
              </motion.div>
            </div>
          ) : (
            <div className="space-y-12">
              {/* Header & Controls */}
              <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8">
                <div>
                  <h2 className="text-4xl font-bold tracking-tight mb-3">Dashboard</h2>
                  <p className="text-zinc-500 font-medium">Tracking {notes.length} active items.</p>
                </div>
                
                <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-4">
                  <div className="relative flex-grow sm:flex-grow-0">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                    <input 
                      type="text" placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full sm:w-56 pl-11 pr-4 py-2.5 bg-white border border-zinc-200/80 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10 transition-all"
                    />
                  </div>
                  
                  <div className="flex bg-zinc-200/50 p-1 rounded-xl">
                    {(['all', 'idea', 'goal'] as const).map((t) => (
                      <button
                        key={t} onClick={() => setFilter(t)}
                        className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-semibold capitalize transition-all ${
                          filter === t ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                        }`}
                      >
                        {t}s
                      </button>
                    ))}
                  </div>

                  <div className="relative flex items-center bg-white border border-zinc-200/80 rounded-xl px-3 py-2.5 text-sm focus-within:ring-2 focus-within:ring-zinc-900/10 transition-all">
                    <ArrowUpDown className="w-4 h-4 text-zinc-400 mr-2" />
                    <select 
                      value={sortBy} 
                      onChange={(e) => setSortBy(e.target.value as any)}
                      className="bg-transparent border-none focus:outline-none text-zinc-700 font-medium cursor-pointer appearance-none pr-6 w-full sm:w-auto"
                    >
                      <option value="newest">Newest First</option>
                      <option value="oldest">Oldest First</option>
                      <option value="target-asc">Target Date (Soonest)</option>
                      <option value="target-desc">Target Date (Latest)</option>
                    </select>
                  </div>

                  <button 
                    onClick={() => setIsAdding(true)}
                    className="flex items-center justify-center gap-2 px-6 py-2.5 bg-zinc-900 text-white rounded-xl text-sm font-medium hover:bg-zinc-800 transition-all shadow-md shadow-zinc-900/10"
                  >
                    <Plus className="w-4 h-4" /> New
                  </button>
                </div>
              </div>

              <AddNoteModal 
                isOpen={isAdding} 
                onClose={() => setIsAdding(false)} 
                onAdd={handleAddNote} 
                userId={user.uid} 
              />

              {/* Notes Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                <AnimatePresence mode="popLayout">
                  {sortedAndFilteredNotes.map((note) => (
                    <NoteCard key={note.id} note={note} onDelete={handleDeleteNote} />
                  ))}
                </AnimatePresence>
              </div>

              {sortedAndFilteredNotes.length === 0 && (
                <motion.div 
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="text-center py-32 border-2 border-dashed border-zinc-200/80 rounded-[2rem] bg-zinc-50/50"
                >
                  <div className="w-16 h-16 bg-white shadow-sm border border-zinc-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <Target className="w-6 h-6 text-zinc-300" />
                  </div>
                  <h3 className="text-lg font-semibold text-zinc-900 mb-2">No items found</h3>
                  <p className="text-zinc-500 text-sm">Try adjusting your search or create a new goal.</p>
                </motion.div>
              )}
            </div>
          )}
        </main>

        <footer className="w-full border-t border-zinc-200/60 mt-auto">
          <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3 text-zinc-400">
              <Target className="w-4 h-4" />
              <span className="text-[11px] font-bold uppercase tracking-widest">Focus App © 2026</span>
            </div>
            <div className="flex items-center gap-8 text-[11px] font-bold text-zinc-400 uppercase tracking-widest">
              <span className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-indigo-500" /> Cloud Synced
              </span>
              <span className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-zinc-400" /> Real-time
              </span>
            </div>
          </div>
        </footer>
      </div>
    </ErrorBoundary>
  );
}
