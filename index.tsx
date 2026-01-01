import React, { useState, useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { 
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, 
  isSameMonth, isSameDay, isToday, setHours, setMinutes, startOfYear, 
  addWeeks 
} from 'date-fns';
import { GoogleGenAI } from "@google/genai";
import { 
  ChevronLeft, ChevronRight, Wrench, Sparkles, Calendar as CalendarIcon, 
  Filter, Building2, Calendar, Lock, LogOut, PlusCircle, ShieldCheck, 
  Check, X, MessageSquare, Loader2, Send, Building, Tag, MapPin, Save, Trash2 
} from 'lucide-react';

// --- Types ---
type UserRole = 'viewer' | 'admin';
type Floor = 1 | 2 | 3 | 4 | 5 | 6;
type EventCategory = 'Maintenance' | 'Cleaning' | 'Event';

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  category: EventCategory;
  floor: Floor;
  room: string;
  description?: string;
}

interface Request {
  id: string;
  title: string;
  date: Date;
  category: EventCategory;
  floor: Floor;
  room: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected';
}

// --- Icons ---
const XIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
);

// --- App Component ---
const App: React.FC = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [userRole, setUserRole] = useState<UserRole>('viewer');
  const [activeTab, setActiveTab] = useState<'calendar' | 'admin'>('calendar');

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b p-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Building2 className="text-blue-600" />
          <h1 className="font-bold text-xl">CRC & SIB JCC Facility Manager</h1>
        </div>
        <button 
          onClick={() => setUserRole(userRole === 'admin' ? 'viewer' : 'admin')}
          className="text-sm bg-slate-100 px-3 py-1 rounded-full border hover:bg-slate-200 transition"
        >
          {userRole === 'admin' ? 'Logout (Admin)' : 'Staff Login'}
        </button>
      </header>

      <main className="max-w-7xl mx-auto p-6">
        <div className="bg-white rounded-xl shadow-sm border p-8 text-center">
          <CalendarIcon className="w-12 h-12 text-blue-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-800">Your Calendar is Ready</h2>
          <p className="text-slate-600 mt-2">The facility management system is now connected to GitHub.</p>
          <div className="mt-6 p-4 bg-blue-50 rounded-lg inline-block border border-blue-100">
            <p className="text-blue-800 font-medium">Viewing as: {userRole.toUpperCase()}</p>
          </div>
        </div>
      </main>
    </div>
  );
};

// --- Mounting Logic ---
const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<React.StrictMode><App /></React.StrictMode>);
}
