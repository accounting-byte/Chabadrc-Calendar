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

// ----------------------------------------------------------------------
// TYPES
// ----------------------------------------------------------------------

export type UserRole = 'viewer' | 'admin';

export type Floor = 1 | 2 | 3 | 4 | 5 | 6;

export type EventCategory = 'Maintenance' | 'Cleaning' | 'Event';

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  category: EventCategory;
  floor: Floor;
  room: string;
  description?: string;
  isRecurring?: boolean;
}

export interface Request {
  id: string;
  title: string;
  date: Date;
  category: EventCategory;
  floor: Floor;
  room: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected';
  submittedBy?: string;
}

export interface FilterState {
  showMaintenance: boolean;
  showCleaning: boolean;
  showEvents: boolean;
  floor?: Floor | null;
}

// ----------------------------------------------------------------------
// SERVICES: Data Generation
// ----------------------------------------------------------------------

const generateId = () => Math.random().toString(36).substr(2, 9);

const createEvent = (
  title: string,
  date: Date,
  category: EventCategory,
  floor: Floor,
  room: string,
  durationHours = 1
): CalendarEvent => {
  const start = setMinutes(setHours(new Date(date), 9), 0); // Default 9 AM
  const end = setHours(start, 9 + durationHours);
  return {
    id: generateId(),
    title,
    start,
    end,
    category,
    floor,
    room,
    isRecurring: true,
  };
};

const generateInitialData = (): CalendarEvent[] => {
  const events: CalendarEvent[] = [];
  const yearStart = startOfYear(new Date());
  const year = yearStart.getFullYear();

  // --- Maintenance ---
  events.push(createEvent('Backflow Inspection', new Date(year, 0, 15), 'Maintenance', 1, 'Garage/Main Line'));
  events.push(createEvent('Backflow Inspection', new Date(year, 6, 15), 'Maintenance', 1, 'Garage/Main Line'));

  for (let i = 0; i < 12; i++) {
    events.push(createEvent('Aroma System Check', new Date(year, i, 1), 'Maintenance', 2, 'Lobby/Sanctuary'));
    events.push(createEvent('Elevator Maintenance (Eastern)', new Date(year, i, 5), 'Maintenance', 1, 'All Floors'));
  }

  let current = yearStart;
  for (let i = 0; i < 52; i++) {
     const day = current.getDay();
     const diff = current.getDate() - day + (day === 0 ? -6 : 1); 
     // eslint-disable-next-line @typescript-eslint/no-unused-vars
     const monday = new Date(current.setDate(diff));
     events.push(createEvent('Chiller Inspection', addWeeks(yearStart, i), 'Maintenance', 6, 'Rooftop'));
  }

  [0, 3, 6, 9].forEach(m => {
    events.push(createEvent('Grease Tank/Hood Clean (Yanky)', new Date(year, m, 10), 'Maintenance', 6, 'Kitchen'));
  });

  // --- Cleaning ---
  for (let i = 0; i < 12; i++) {
    events.push(createEvent('Carpet Deep Clean', new Date(year, i, 15), 'Cleaning', 2, 'Sanctuary'));
  }
  events.push(createEvent('Exterior Power Washing', new Date(year, 7, 20), 'Cleaning', 1, 'Exterior'));

  // --- Fixed Annual Events ---
  events.push(createEvent('CTeen Jr Kickoff', new Date(year, 7, 24), 'Event', 6, 'Rooftop Lounge')); 
  events.push(createEvent('Chanukah Parade (CTeen)', new Date(year, 11, 14), 'Event', 1, 'Garage/Street'));
  events.push(createEvent('Purim Party (CTeen)', new Date(year, 2, 1), 'Event', 2, 'Sanctuary'));
  events.push(createEvent('BMC Orientation', new Date(year, 8, 2), 'Event', 3, 'Offices/Conf Room'));
  events.push(createEvent('BMC Challah Bake', new Date(year, 10, 4), 'Event', 2, 'Sanctuary Hall'));
  events.push(createEvent('BMC Gala', new Date(year, 4, 12), 'Event', 6, 'Rooftop Ballroom'));
  events.push(createEvent('Hebrew School Opening', new Date(year, 8, 7), 'Event', 4, 'Classrooms'));
  events.push(createEvent('Family Chanukah Party', new Date(year, 11, 21), 'Event', 2, 'Sanctuary'));

  // Holidays
  events.push(createEvent('Rosh Hashana - Fabric Cleaning', new Date(year, 8, 15), 'Cleaning', 2, 'Sanctuary'));
  events.push(createEvent('Sukkah Build', new Date(year, 8, 29), 'Maintenance', 1, 'Courtyard'));
  events.push(createEvent('Pesach Chametz Deep Clean', new Date(year, 3, 10), 'Cleaning', 6, 'Kitchen/All Floors'));

  return events;
};

// ----------------------------------------------------------------------
// SERVICES: Gemini AI
// ----------------------------------------------------------------------

const getAiClient = () => {
  try {
    if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
      return new GoogleGenAI({ apiKey: process.env.API_KEY });
    }
  } catch (e) {
    console.warn("Environment variables not accessible or API Key missing.");
  }
  return null;
};

const ai = getAiClient();

const analyzeSchedule = async (events: CalendarEvent[], query: string): Promise<string> => {
  if (!ai) {
    return "Gemini API Key is missing. Please configure process.env.API_KEY in your deployment environment.";
  }

  const eventData = events.map(e => ({
    title: e.title,
    date: e.start.toLocaleDateString(),
    type: e.category,
    location: `Floor ${e.floor} - ${e.room}`
  }));

  const prompt = `
    You are a Facility Management Assistant for the Chabad Russian Center & SIB JCC.
    
    Here is the upcoming schedule data:
    ${JSON.stringify(eventData.slice(0, 50))} (Truncated to first 50 for brevity)
    
    User Query: "${query}"
    
    Provide a concise, helpful summary or answer based on the schedule provided. 
    Focus on conflicts, heavy maintenance days, or preparation needed for events.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    return response.text || "No insights available.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "I'm having trouble connecting to the AI service right now.";
  }
};

// ----------------------------------------------------------------------
// COMPONENTS: UI Building Blocks
// ----------------------------------------------------------------------

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  className = '', 
  ...props 
}) => {
  const baseStyles = "inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2";
  
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500",
    secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus:ring-slate-500",
    danger: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500",
    ghost: "bg-transparent text-slate-600 hover:bg-slate-100 focus:ring-slate-500",
  };

  const sizes = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2 text-sm",
    lg: "px-6 py-3 text-base",
  };

  return (
    <button 
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};

// ----------------------------------------------------------------------
// COMPONENTS: Forms & Modals
// ----------------------------------------------------------------------

interface RequestFormProps {
  onSubmit: (req: Omit<Request, 'id' | 'status'>) => void;
  onCancel: () => void;
}

const RequestForm: React.FC<RequestFormProps> = ({ onSubmit, onCancel }) => {
  const [formData, setFormData] = useState({
    title: '',
    date: '',
    category: 'Event' as EventCategory,
    floor: 1 as Floor,
    room: '',
    description: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      date: new Date(formData.date),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700">Request Title</label>
        <div className="mt-1 relative rounded-md shadow-sm">
          <input
            required
            type="text"
            className="block w-full rounded-md border-slate-300 pl-3 py-2 border focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            placeholder="e.g., Fix AC in Lobby"
            value={formData.title}
            onChange={e => setFormData({ ...formData, title: e.target.value })}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700">Date</label>
          <div className="mt-1 relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Calendar className="h-4 w-4 text-slate-400" />
            </div>
            <input
              required
              type="date"
              className="block w-full pl-10 rounded-md border-slate-300 py-2 border focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              value={formData.date}
              onChange={e => setFormData({ ...formData, date: e.target.value })}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700">Type</label>
          <div className="mt-1 relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Tag className="h-4 w-4 text-slate-400" />
            </div>
            <select
              className="block w-full pl-10 rounded-md border-slate-300 py-2 border focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              value={formData.category}
              onChange={e => setFormData({ ...formData, category: e.target.value as EventCategory })}
            >
              <option value="Event">Event</option>
              <option value="Maintenance">Maintenance</option>
              <option value="Cleaning">Cleaning</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700">Floor</label>
          <div className="mt-1 relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Building className="h-4 w-4 text-slate-400" />
            </div>
            <select
              className="block w-full pl-10 rounded-md border-slate-300 py-2 border focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              value={formData.floor}
              onChange={e => setFormData({ ...formData, floor: Number(e.target.value) as Floor })}
            >
              <option value={1}>1 - Garage/Ground</option>
              <option value={2}>2 - Sanctuary</option>
              <option value={3}>3 - Offices</option>
              <option value={4}>4 - Classrooms</option>
              <option value={5}>5 - Classrooms (Upper)</option>
              <option value={6}>6 - Rooftop</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700">Room / Area</label>
          <div className="mt-1 relative">
             <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <MapPin className="h-4 w-4 text-slate-400" />
            </div>
            <input
              required
              type="text"
              placeholder="e.g., Kitchen"
              className="block w-full pl-10 rounded-md border-slate-300 py-2 border focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              value={formData.room}
              onChange={e => setFormData({ ...formData, room: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700">Details</label>
        <textarea
          rows={3}
          className="mt-1 block w-full rounded-md border-slate-300 py-2 border focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          value={formData.description}
          onChange={e => setFormData({ ...formData, description: e.target.value })}
        />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="gap-2">
          <Send className="w-4 h-4" />
          Submit Request
        </Button>
      </div>
    </form>
  );
};

interface EditEventModalProps {
  event: CalendarEvent;
  onSave: (event: CalendarEvent) => void;
  onDelete: (eventId: string) => void;
  onClose: () => void;
}

const EditEventModal: React.FC<EditEventModalProps> = ({ event, onSave, onDelete, onClose }) => {
  const [formData, setFormData] = useState({
    title: event.title,
    date: event.start.toISOString().split('T')[0],
    category: event.category,
    floor: event.floor,
    room: event.room,
    description: event.description || '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const [y, m, d] = formData.date.split('-').map(Number);
    const start = new Date(y, m - 1, d, 9, 0);
    const end = new Date(start);
    end.setHours(10); 

    onSave({
      ...event,
      title: formData.title,
      start,
      end,
      category: formData.category,
      floor: formData.floor,
      room: formData.room,
      description: formData.description,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 my-8">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-slate-900">Edit Event</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700">Title</label>
            <div className="mt-1">
              <input
                required
                type="text"
                className="block w-full rounded-md border-slate-300 pl-3 py-2 border focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                value={formData.title}
                onChange={e => setFormData({ ...formData, title: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700">Date</label>
              <div className="mt-1 relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Calendar className="h-4 w-4 text-slate-400" />
                </div>
                <input
                  required
                  type="date"
                  className="block w-full pl-10 rounded-md border-slate-300 py-2 border focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  value={formData.date}
                  onChange={e => setFormData({ ...formData, date: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700">Type</label>
              <div className="mt-1 relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Tag className="h-4 w-4 text-slate-400" />
                </div>
                <select
                  className="block w-full pl-10 rounded-md border-slate-300 py-2 border focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  value={formData.category}
                  onChange={e => setFormData({ ...formData, category: e.target.value as EventCategory })}
                >
                  <option value="Event">Event</option>
                  <option value="Maintenance">Maintenance</option>
                  <option value="Cleaning">Cleaning</option>
                </select>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700">Floor</label>
              <div className="mt-1 relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Building className="h-4 w-4 text-slate-400" />
                </div>
                <select
                  className="block w-full pl-10 rounded-md border-slate-300 py-2 border focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  value={formData.floor}
                  onChange={e => setFormData({ ...formData, floor: Number(e.target.value) as Floor })}
                >
                  <option value={1}>1 - Garage/Ground</option>
                  <option value={2}>2 - Sanctuary</option>
                  <option value={3}>3 - Offices</option>
                  <option value={4}>4 - Classrooms</option>
                  <option value={5}>5 - Classrooms (Upper)</option>
                  <option value={6}>6 - Rooftop</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700">Room / Area</label>
              <div className="mt-1 relative">
                 <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <MapPin className="h-4 w-4 text-slate-400" />
                </div>
                <input
                  required
                  type="text"
                  className="block w-full pl-10 rounded-md border-slate-300 py-2 border focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  value={formData.room}
                  onChange={e => setFormData({ ...formData, room: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Details</label>
            <textarea
              rows={3}
              className="mt-1 block w-full rounded-md border-slate-300 py-2 border focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
            />
          </div>

          <div className="flex justify-between pt-4 border-t border-slate-100 mt-6">
             <Button type="button" variant="danger" onClick={() => {
               if(confirm('Are you sure you want to delete this event? This action cannot be undone.')) {
                 onDelete(event.id);
               }
             }}>
               <Trash2 className="w-4 h-4 mr-2" />
               Delete
             </Button>
             <div className="flex gap-2">
               <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
               <Button type="submit">
                 <Save className="w-4 h-4 mr-2" />
                 Save Changes
               </Button>
             </div>
          </div>
        </form>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------
// COMPONENTS: Main Views
// ----------------------------------------------------------------------

interface CalendarViewProps {
  currentDate: Date;
  onDateChange: (date: Date) => void;
  events: CalendarEvent[];
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
  onEventClick?: (event: CalendarEvent) => void;
}

const CalendarView: React.FC<CalendarViewProps> = ({
  currentDate,
  onDateChange,
  events,
  filters,
  onFilterChange,
  onEventClick,
}) => {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const days = useMemo(() => eachDayOfInterval({ start: startDate, end: endDate }), [startDate, endDate]);

  const filteredEvents = useMemo(() => {
    return events.filter(e => {
      if (!filters.showMaintenance && e.category === 'Maintenance') return false;
      if (!filters.showCleaning && e.category === 'Cleaning') return false;
      if (!filters.showEvents && e.category === 'Event') return false;
      if (filters.floor && e.floor !== filters.floor) return false;
      return true;
    });
  }, [events, filters]);

  const nextMonth = () => onDateChange(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1));
  const prevMonth = () => onDateChange(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1));
  const today = () => onDateChange(new Date());

  const getEventColor = (category: string) => {
    switch (category) {
      case 'Maintenance': return 'bg-red-100 text-red-800 border-red-200';
      case 'Cleaning': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'Event': return 'bg-green-100 text-green-800 border-green-200';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[calc(100vh-140px)]">
      {/* Calendar Toolbar */}
      <div className="p-4 border-b border-slate-200 flex flex-col md:flex-row justify-between items-center gap-4 bg-slate-50">
        <div className="flex items-center gap-4">
          <div className="flex items-center bg-white rounded-md shadow-sm border border-slate-300">
            <button onClick={prevMonth} className="p-1.5 hover:bg-slate-50 text-slate-600"><ChevronLeft className="w-5 h-5" /></button>
            <button onClick={today} className="px-3 py-1.5 border-x border-slate-300 text-sm font-medium hover:bg-slate-50">Today</button>
            <button onClick={nextMonth} className="p-1.5 hover:bg-slate-50 text-slate-600"><ChevronRight className="w-5 h-5" /></button>
          </div>
          <h2 className="text-xl font-bold text-slate-800">
            {format(currentDate, 'MMMM yyyy')}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
           <div className="flex items-center bg-white p-1 rounded-md border border-slate-300 shadow-sm">
             <Filter className="w-4 h-4 text-slate-400 mx-2" />
             <select 
                className="text-sm border-none focus:ring-0 text-slate-700 bg-transparent"
                value={filters.floor || ''}
                onChange={(e) => onFilterChange({...filters, floor: e.target.value ? Number(e.target.value) as Floor : null})}
             >
               <option value="">All Floors</option>
               {[1,2,3,4,5,6].map(f => <option key={f} value={f}>Floor {f}</option>)}
             </select>
           </div>

           <button 
             onClick={() => onFilterChange({...filters, showMaintenance: !filters.showMaintenance})}
             className={`p-2 rounded-md transition-colors ${filters.showMaintenance ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-400'}`}
             title="Toggle Maintenance"
           >
             <Wrench className="w-4 h-4" />
           </button>
           <button 
             onClick={() => onFilterChange({...filters, showCleaning: !filters.showCleaning})}
             className={`p-2 rounded-md transition-colors ${filters.showCleaning ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400'}`}
             title="Toggle Cleaning"
           >
             <Sparkles className="w-4 h-4" />
           </button>
           <button 
             onClick={() => onFilterChange({...filters, showEvents: !filters.showEvents})}
             className={`p-2 rounded-md transition-colors ${filters.showEvents ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}
             title="Toggle Events"
           >
             <CalendarIcon className="w-4 h-4" />
           </button>
        </div>
      </div>

      {/* Grid Header */}
      <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
          <div key={day} className="py-2 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
            {day}
          </div>
        ))}
      </div>

      {/* Grid Body */}
      <div className="grid grid-cols-7 flex-1 auto-rows-fr overflow-y-auto">
        {days.map((day, dayIdx) => {
          const dayEvents = filteredEvents.filter(e => isSameDay(e.start, day));
          return (
            <div 
              key={day.toString()}
              className={`
                min-h-[100px] border-b border-r border-slate-100 p-2 transition-colors hover:bg-slate-50
                ${!isSameMonth(day, monthStart) ? 'bg-slate-50/50' : 'bg-white'}
              `}
            >
              <div className="flex justify-between items-start">
                <span className={`
                  text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full
                  ${isToday(day) ? 'bg-blue-600 text-white' : !isSameMonth(day, monthStart) ? 'text-slate-400' : 'text-slate-700'}
                `}>
                  {format(day, 'd')}
                </span>
              </div>
              
              <div className="mt-1 space-y-1">
                {dayEvents.slice(0, 4).map(event => (
                  <div 
                    key={event.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEventClick?.(event);
                    }}
                    className={`
                      text-[10px] px-1.5 py-0.5 rounded border truncate cursor-pointer hover:opacity-80
                      ${getEventColor(event.category)}
                    `}
                    title={`${event.title} - Floor ${event.floor} (${event.room})`}
                  >
                    <span className="font-semibold">{event.title}</span>
                    <span className="opacity-75"> - {event.room}</span>
                  </div>
                ))}
                {dayEvents.length > 4 && (
                  <div className="text-[10px] text-slate-500 pl-1">
                    + {dayEvents.length - 4} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

interface AdminPanelProps {
  requests: Request[];
  events: CalendarEvent[];
  onApprove: (req: Request) => void;
  onReject: (req: Request) => void;
}

const AdminPanel: React.FC<AdminPanelProps> = ({ requests, events, onApprove, onReject }) => {
  const [aiQuery, setAiQuery] = useState('');
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAiQuery = async () => {
    if (!aiQuery.trim()) return;
    setLoading(true);
    setAiResponse(null);
    try {
      const result = await analyzeSchedule(events, aiQuery);
      setAiResponse(result);
    } catch (err) {
      setAiResponse("Failed to get response.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
      {/* Request Inbox */}
      <div className="lg:col-span-2 space-y-4">
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          Request Inbox
          <span className="bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full">{requests.length}</span>
        </h2>
        
        {requests.length === 0 ? (
          <div className="bg-white p-8 rounded-xl border border-dashed border-slate-300 text-center text-slate-500">
            No pending requests. Good job!
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map(req => (
              <div key={req.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                      req.category === 'Maintenance' ? 'bg-red-100 text-red-800' : 
                      req.category === 'Cleaning' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
                    }`}>
                      {req.category}
                    </span>
                    <span className="text-xs text-slate-500">{req.date.toLocaleDateString()}</span>
                  </div>
                  <h3 className="font-semibold text-slate-800">{req.title}</h3>
                  <p className="text-sm text-slate-600 mt-1">
                    Floor {req.floor}: {req.room} — <span className="italic">{req.description}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="danger" onClick={() => onReject(req)} className="w-full sm:w-auto">
                    <X className="w-4 h-4 mr-1" /> Reject
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => onApprove(req)} className="w-full sm:w-auto bg-green-600 hover:bg-green-700 focus:ring-green-500">
                    <Check className="w-4 h-4 mr-1" /> Approve
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI Assistant */}
      <div className="bg-gradient-to-br from-indigo-50 to-purple-50 p-6 rounded-xl border border-indigo-100 flex flex-col h-fit">
        <div className="flex items-center gap-2 mb-4 text-indigo-900">
          <Sparkles className="w-5 h-5 text-indigo-600" />
          <h3 className="font-bold">AI Facility Assistant</h3>
        </div>
        
        <div className="space-y-3">
          <p className="text-sm text-indigo-800/80">
            Ask me to summarize the schedule, check for conflicts, or draft maintenance notices.
          </p>
          <textarea
            className="w-full rounded-md border-indigo-200 p-3 text-sm focus:ring-indigo-500 focus:border-indigo-500 min-h-[100px]"
            placeholder="e.g., What maintenance is scheduled for next week?"
            value={aiQuery}
            onChange={(e) => setAiQuery(e.target.value)}
          />
          <Button 
            onClick={handleAiQuery} 
            disabled={loading || !aiQuery}
            className="w-full bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-500"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <MessageSquare className="w-4 h-4 mr-2" />}
            Analyze Schedule
          </Button>

          {aiResponse && (
            <div className="mt-4 p-3 bg-white rounded-lg border border-indigo-100 text-sm text-slate-700 shadow-sm leading-relaxed whitespace-pre-line">
              {aiResponse}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------
// APP COMPONENT
// ----------------------------------------------------------------------

const App: React.FC = () => {
  // State
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [userRole, setUserRole] = useState<UserRole>('viewer');
  const [activeTab, setActiveTab] = useState<'calendar' | 'admin'>('calendar');
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginPassword, setLoginPassword] = useState('');
  
  // Filters
  const [filters, setFilters] = useState<FilterState>({
    showMaintenance: true,
    showCleaning: true,
    showEvents: true,
    floor: null,
  });

  // Init Data
  useEffect(() => {
    const initialEvents = generateInitialData();
    setEvents(initialEvents);
  }, []);

  // Handlers
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (loginPassword === 'admin123') {
      setUserRole('admin');
      setShowLoginModal(false);
      setLoginPassword('');
    } else {
      alert('Incorrect Password');
    }
  };

  const handleLogout = () => {
    setUserRole('viewer');
    setActiveTab('calendar');
    setEditingEvent(null);
  };

  const handleSubmitRequest = (reqData: Omit<Request, 'id' | 'status'>) => {
    const newRequest: Request = {
      ...reqData,
      id: Math.random().toString(36).substr(2, 9),
      status: 'pending',
      submittedBy: 'Guest User'
    };
    setRequests(prev => [newRequest, ...prev]);
    setShowRequestModal(false);
    alert('Request submitted for approval!');
  };

  const handleApproveRequest = (req: Request) => {
    const newEvent: CalendarEvent = {
      id: req.id,
      title: req.title,
      start: req.date, // defaults to 00:00
      end: req.date,
      category: req.category,
      floor: req.floor,
      room: req.room,
      description: req.description,
    };
    setEvents(prev => [...prev, newEvent]);
    setRequests(prev => prev.filter(r => r.id !== req.id));
  };

  const handleRejectRequest = (req: Request) => {
    if(confirm('Reject this request?')) {
        setRequests(prev => prev.filter(r => r.id !== req.id));
    }
  };

  const handleEventClick = (event: CalendarEvent) => {
    if (userRole === 'admin') {
      setEditingEvent(event);
    } else {
      // Read-only view for non-admins could go here
      alert(`${event.title}\n${event.start.toLocaleDateString()}\n${event.category} - Floor ${event.floor}\n${event.description || ''}`);
    }
  };

  const handleUpdateEvent = (updatedEvent: CalendarEvent) => {
    setEvents(prev => prev.map(e => e.id === updatedEvent.id ? updatedEvent : e));
    setEditingEvent(null);
  };

  const handleDeleteEvent = (eventId: string) => {
    setEvents(prev => prev.filter(e => e.id !== eventId));
    setEditingEvent(null);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans text-slate-900">
      
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 rounded-lg text-white">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">CRC & SIB JCC</h1>
              <p className="text-xs text-slate-500 font-medium">Facility Manager</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {userRole === 'viewer' ? (
              <Button variant="ghost" size="sm" onClick={() => setShowLoginModal(true)}>
                <Lock className="w-4 h-4 mr-2" />
                Staff Login
              </Button>
            ) : (
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-slate-600 bg-slate-100 px-3 py-1 rounded-full flex items-center">
                  <ShieldCheck className="w-3 h-3 mr-1 text-green-600" /> Admin
                </span>
                <Button variant="ghost" size="sm" onClick={handleLogout}>
                  <LogOut className="w-4 h-4 mr-2" />
                  Logout
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        
        {/* Actions Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="flex bg-slate-200 p-1 rounded-lg w-fit">
            <button
              onClick={() => setActiveTab('calendar')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'calendar' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Calendar
            </button>
            {userRole === 'admin' && (
              <button
                onClick={() => setActiveTab('admin')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${activeTab === 'admin' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
              >
                Dashboard
                {requests.length > 0 && <span className="bg-blue-600 text-white text-[10px] px-1.5 rounded-full">{requests.length}</span>}
              </button>
            )}
          </div>

          <Button onClick={() => setShowRequestModal(true)} className="shadow-lg shadow-blue-600/20">
            <PlusCircle className="w-4 h-4 mr-2" />
            Submit Request
          </Button>
        </div>

        {/* Content Views */}
        {activeTab === 'calendar' ? (
          <CalendarView 
            currentDate={currentDate}
            onDateChange={setCurrentDate}
            events={events}
            filters={filters}
            onFilterChange={setFilters}
            onEventClick={handleEventClick}
          />
        ) : (
          <AdminPanel 
            requests={requests}
            events={events}
            onApprove={handleApproveRequest}
            onReject={handleRejectRequest}
          />
        )}
      </main>

      {/* Login Modal */}
      {showLoginModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 transform transition-all">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-900">Staff Login</h3>
              <button onClick={() => setShowLoginModal(false)} className="text-slate-400 hover:text-slate-600"><XIcon /></button>
            </div>
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
                <input 
                  autoFocus
                  type="password" 
                  className="w-full rounded-md border-slate-300 py-2 px-3 border focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)}
                  placeholder="Enter admin password"
                />
                <p className="text-xs text-slate-400 mt-1">Hint: admin123</p>
              </div>
              <Button type="submit" className="w-full">Access Dashboard</Button>
            </form>
          </div>
        </div>
      )}

      {/* Request Modal */}
      {showRequestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 my-8">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-xl font-bold text-slate-900">Submit New Request</h3>
                <p className="text-sm text-slate-500">Maintenance, Cleaning, or Event Booking</p>
              </div>
              <button onClick={() => setShowRequestModal(false)} className="text-slate-400 hover:text-slate-600"><XIcon /></button>
            </div>
            <RequestForm onSubmit={handleSubmitRequest} onCancel={() => setShowRequestModal(false)} />
          </div>
        </div>
      )}

      {/* Edit Event Modal (Admin Only) */}
      {editingEvent && (
        <EditEventModal 
          event={editingEvent}
          onSave={handleUpdateEvent}
          onDelete={handleDeleteEvent}
          onClose={() => setEditingEvent(null)}
        />
      )}
    </div>
  );
};

const XIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
);

// ----------------------------------------------------------------------
// RENDER ROOT
// ----------------------------------------------------------------------

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
