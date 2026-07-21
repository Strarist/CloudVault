import React, { useEffect, useState, useRef } from 'react';
import { useCollaborationStore, NotificationDetails } from '../store/collaborationStore';
import { Bell, MessageSquare, AtSign, UserPlus, ShieldAlert, Inbox, Loader2, Check } from 'lucide-react';

interface NotificationsDropdownProps {
  onSelectNotification: (workspaceId: string, fileId: string) => void;
}

export default function NotificationsDropdown({
  onSelectNotification,
}: NotificationsDropdownProps) {
  const {
    notifications,
    unreadCount,
    notificationsLoading,
    fetchNotifications,
    fetchUnreadCount,
    markAsRead,
    markAllAsRead,
  } = useCollaborationStore();

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch unread count on mount
  useEffect(() => {
    fetchUnreadCount();
  }, [fetchUnreadCount]);

  // Periodic poll of unread count (every 20s) - lightweight and compliant with guidelines
  useEffect(() => {
    const interval = setInterval(() => {
      fetchUnreadCount();
    }, 20000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch full notifications list when opening dropdown
  const handleToggle = () => {
    const nextState = !isOpen;
    setIsOpen(nextState);
    if (nextState) {
      fetchNotifications(1, 20);
    }
  };

  const handleNotificationClick = async (notif: NotificationDetails) => {
    // Mark as read immediately
    if (!notif.isRead) {
      await markAsRead(notif._id);
    }

    setIsOpen(false);

    // If notification has fileId and workspaceId, trigger selection/drawers
    const { fileId, workspaceId } = notif.payload;
    if (fileId && workspaceId) {
      onSelectNotification(workspaceId, fileId);
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'COMMENT':
        return <MessageSquare className="w-4 h-4 text-indigo-400" />;
      case 'MENTION':
        return <AtSign className="w-4 h-4 text-purple-400" />;
      case 'INVITATION':
        return <UserPlus className="w-4 h-4 text-emerald-400" />;
      case 'ROLE_CHANGED':
        return <ShieldAlert className="w-4 h-4 text-amber-400" />;
      default:
        return <Bell className="w-4 h-4 text-slate-400" />;
    }
  };

  const getNotificationText = (notif: NotificationDetails) => {
    const actor = notif.payload.actorUsername || 'Someone';
    switch (notif.type) {
      case 'COMMENT':
        return (
          <span>
            <strong className="text-slate-200">{actor}</strong> commented on your file
          </span>
        );
      case 'MENTION':
        return (
          <span>
            <strong className="text-slate-200">{actor}</strong> @mentioned you in a comment
          </span>
        );
      case 'INVITATION':
        return <span>You were invited to a new workspace</span>;
      case 'ROLE_CHANGED':
        return (
          <span>
            Your workspace role was updated to{' '}
            <strong className="text-indigo-400 uppercase">{notif.payload.newRole}</strong>
          </span>
        );
      default:
        return <span>New activity notification</span>;
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <div className="relative" ref={dropdownRef}>
      
      {/* Bell Trigger Button */}
      <button
        id="btn-notifications-bell"
        onClick={handleToggle}
        className="relative p-2 rounded-xl bg-slate-900 hover:bg-slate-805 text-slate-400 hover:text-slate-200 border border-slate-850 hover:border-slate-750 transition duration-150 cursor-pointer"
        title="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-indigo-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-slate-950 animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2.5 w-80 bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-2xl shadow-2xl p-2 z-50 animate-fade-in flex flex-col max-h-[420px]">
          
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-805/70 mb-1">
            <span className="text-xs font-bold text-white">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllAsRead()}
                className="text-[10px] text-indigo-400 hover:text-indigo-300 font-semibold transition cursor-pointer flex items-center gap-1"
              >
                <Check className="w-3 h-3" />
                <span>Mark all read</span>
              </button>
            )}
          </div>

          {/* List Content */}
          <div className="flex-1 overflow-y-auto space-y-0.5 divide-y divide-slate-850/40">
            {notificationsLoading && notifications.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="text-center py-12 px-4 flex flex-col items-center">
                <Inbox className="w-8 h-8 text-slate-700 mb-2" />
                <p className="text-slate-400 text-xs font-medium">All caught up!</p>
                <p className="text-slate-600 text-[9px] mt-1">
                  You have no notifications at the moment.
                </p>
              </div>
            ) : (
              notifications.map((notif) => (
                <button
                  key={notif._id}
                  onClick={() => handleNotificationClick(notif)}
                  className={`w-full text-left p-3 rounded-lg flex gap-3 transition cursor-pointer ${
                    notif.isRead
                      ? 'hover:bg-slate-850/40 text-slate-400'
                      : 'bg-indigo-500/5 hover:bg-indigo-500/10 text-slate-200'
                  }`}
                >
                  {/* Left Side: Dynamic Icon */}
                  <div className="w-8 h-8 rounded-full bg-slate-850 border border-slate-800 flex items-center justify-center shrink-0">
                    {getIcon(notif.type)}
                  </div>

                  {/* Right Side: Notification Details */}
                  <div className="flex-1 min-w-0 leading-tight space-y-1">
                    <div className="text-xs break-words">{getNotificationText(notif)}</div>
                    <div className="flex justify-between items-center text-[9px] font-mono text-slate-500">
                      <span>{formatTime(notif.createdAt)}</span>
                      {!notif.isRead && (
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
