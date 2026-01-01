import React, { useMemo } from 'react';
import { CalendarEvent, FilterState, Floor } from '../types';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, isToday } from 'date-fns';
import { ChevronLeft, ChevronRight, Wrench, Sparkles, Calendar as CalendarIcon, Filter } from 'lucide-react';
import { Button } from './Button';

interface CalendarViewProps {
  currentDate: Date;
  onDateChange: (date: Date) => void;
  events: CalendarEvent[];
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
  onEventClick?: (event: CalendarEvent) => void;
}

export const CalendarView: React.FC<CalendarViewProps> = ({
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
