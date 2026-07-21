import React, { useEffect, useState, useRef } from 'react';
import { useCollaborationStore } from '../store/collaborationStore';
import { X, Send, Trash2, Loader2, MessageSquare, AtSign } from 'lucide-react';
import { FileDetails, MemberInfo } from '../store/workspaceStore';

interface CommentsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  file: FileDetails | null;
  workspaceId: string | undefined;
  members: MemberInfo[];
  currentUserId: string;
}

export default function CommentsDrawer({
  isOpen,
  onClose,
  file,
  workspaceId,
  members,
  currentUserId,
}: CommentsDrawerProps) {
  const {
    comments,
    commentsLoading,
    error,
    fetchComments,
    addComment,
    deleteComment,
  } = useCollaborationStore();

  const [newComment, setNewComment] = useState('');
  const [submitLoading, setSubmitLoading] = useState(false);
  const [deleteLoadingId, setDeleteLoadingId] = useState<string | null>(null);

  // Mention state
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<MemberInfo[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [mentionTriggerIndex, setMentionTriggerIndex] = useState(-1);
  const [mentionEmptyHint, setMentionEmptyHint] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Load comments and reset state when active file changes or drawer toggles
  useEffect(() => {
    if (isOpen && file && workspaceId) {
      fetchComments(workspaceId, file._id);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNewComment('');
    setShowSuggestions(false);
    setSuggestionIndex(0);
    setMentionTriggerIndex(-1);
    setMentionEmptyHint(null);
    setSubmitLoading(false);
    setDeleteLoadingId(null);
  }, [isOpen, file?._id, workspaceId, fetchComments]);

  // Handle outside click to close suggestions
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (suggestionsRef.current && !suggestionsRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!isOpen || !file || !workspaceId) return null;

  const handleSendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || submitLoading) return;

    setSubmitLoading(true);
    try {
      await addComment(workspaceId, file._id, newComment.trim());
      setNewComment('');
      setShowSuggestions(false);
    } catch {
      // Error handled by store
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!confirm('Are you sure you want to delete this comment?')) return;
    setDeleteLoadingId(commentId);
    try {
      await deleteComment(workspaceId, file._id, commentId);
    } catch {
      // Error handled by store
    } finally {
      setDeleteLoadingId(null);
    }
  };

  // Mention Suggestions logic
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setNewComment(text);

    const selectionStart = e.target.selectionStart;
    const textBeforeCursor = text.substring(0, selectionStart);
    
    // Look for the last "@" before the cursor
    const lastAtIdx = textBeforeCursor.lastIndexOf('@');
    
    if (lastAtIdx !== -1) {
      // Check if there is any whitespace between the last "@" and the cursor
      const textAfterAt = textBeforeCursor.substring(lastAtIdx + 1);
      const hasSpace = /\s/.test(textAfterAt);
      
      if (!hasSpace) {
        setMentionTriggerIndex(lastAtIdx);
        
        const query = textAfterAt.toLowerCase();
        const others = members.filter((m) => m.userId._id !== currentUserId);
        const filtered = others.filter((m) => {
          const username = m.userId.username?.toLowerCase() || '';
          const name = m.userId.name?.toLowerCase() || '';
          if (!username && !name) return false;
          if (!query) return !!username;
          return username.startsWith(query) || name.startsWith(query) || name.includes(query);
        });
        
        setSuggestions(filtered);
        setSuggestionIndex(0);
        setShowSuggestions(true);
        if (filtered.length === 0) {
          setMentionEmptyHint(
            others.length === 0
              ? 'No other members in this workspace. Invite someone to mention them.'
              : 'No matching members. Try @username (not display name).',
          );
        } else {
          setMentionEmptyHint(null);
        }
        return;
      }
    }
    
    setShowSuggestions(false);
    setMentionEmptyHint(null);
  };

  const insertMention = (username: string) => {
    if (mentionTriggerIndex === -1 || !textareaRef.current) return;

    const text = newComment;
    const beforeTrigger = text.substring(0, mentionTriggerIndex);
    const afterCursor = text.substring(textareaRef.current.selectionStart);
    
    const mentionText = `@${username} `;
    const newText = beforeTrigger + mentionText + afterCursor;
    
    setNewComment(newText);
    setShowSuggestions(false);
    
    // Focus back and set cursor position
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const newCursorPos = mentionTriggerIndex + mentionText.length;
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 50);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSuggestionIndex((prev) => (prev + 1) % suggestions.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSuggestionIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const selectedMember = suggestions[suggestionIndex];
        if (selectedMember?.userId?.username) {
          insertMention(selectedMember.userId.username);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setShowSuggestions(false);
      }
    }
  };

  const renderCommentContent = (content: string) => {
    // Basic regex-based formatting for mentions in UI
    const parts = content.split(/(@\w+)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('@')) {
        const username = part.substring(1);
        // Check if username corresponds to an actual workspace member
        const isMember = members.some((m) => m.userId.username?.toLowerCase() === username.toLowerCase());
        return (
          <span
            key={idx}
            className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
              isMember
                ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/10'
                : 'text-slate-400 font-medium'
            }`}
          >
            {part}
          </span>
        );
      }
      return <React.Fragment key={idx}>{part}</React.Fragment>;
    });
  };

  const formatCommentTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <>
    <button
      type="button"
      aria-label="Close comments"
      onClick={onClose}
      className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-[2px] cursor-default border-0"
    />
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-96 bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col transition-transform duration-300 animate-slide-in">
      
      {/* Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/40 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-indigo-400" />
          <h2 className="text-sm font-bold text-white truncate max-w-[200px]" title={file.name}>
            Comments ({comments.length})
          </h2>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* File Context Info */}
      <div className="p-4 bg-slate-950/20 border-b border-slate-850 px-5">
        <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Target File</span>
        <h3 className="text-xs font-semibold text-slate-300 truncate mt-0.5">{file.name}</h3>
        <p className="text-[10px] text-slate-500 mt-1">
          Uploaded by {file.createdBy?.name || 'Unknown'}
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-3 mx-4 mt-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-xs">
          {error}
        </div>
      )}

      {/* Comments List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {commentsLoading && comments.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
          </div>
        ) : comments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center px-4">
            <MessageSquare className="w-8 h-8 text-slate-700 mb-2" />
            <p className="text-slate-400 text-xs font-medium">No comments yet</p>
            <p className="text-slate-600 text-[10px] mt-1 max-w-[200px]">
              Start the discussion by asking a question or typing feedback below.
            </p>
          </div>
        ) : (
          comments.map((comment) => {
            const isAuthor = comment.authorId?._id === currentUserId;
            return (
              <div
                key={comment._id}
                className="p-3 bg-slate-950/30 border border-slate-850 rounded-xl space-y-2 hover:border-slate-800/80 transition group"
              >
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    <div className="w-6.5 h-6.5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-300 uppercase shrink-0">
                      {comment.authorId?.username?.charAt(0) || 'U'}
                    </div>
                    <div className="flex flex-col leading-tight">
                      <span className="text-xs font-bold text-slate-200">
                        {comment.authorId?.username || 'user'}
                      </span>
                      <span className="text-[9px] text-slate-500 font-mono">
                        {formatCommentTime(comment.createdAt)}
                      </span>
                    </div>
                  </div>
                  
                  {isAuthor && (
                    <button
                      disabled={deleteLoadingId === comment._id}
                      onClick={() => handleDeleteComment(comment._id)}
                      className="p-1 text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 rounded opacity-0 group-hover:opacity-100 transition duration-150 cursor-pointer disabled:opacity-40"
                      title="Delete Comment"
                    >
                      {deleteLoadingId === comment._id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Trash2 className="w-3 h-3" />
                      )}
                    </button>
                  )}
                </div>

                <p className="text-xs text-slate-300 leading-relaxed break-words whitespace-pre-wrap pl-8">
                  {renderCommentContent(comment.content)}
                </p>
              </div>
            );
          })
        )}
      </div>

      {/* Text area & Autocomplete mentions container */}
      <div className="p-4 border-t border-slate-800 bg-slate-950/20 relative">
        
        {/* Mention suggestions popup */}
        {showSuggestions && (
          <div
            ref={suggestionsRef}
            className="absolute bottom-full left-4 right-4 mb-2 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden z-50 divide-y divide-slate-850"
          >
            <div className="px-3 py-1.5 bg-slate-950/60 border-b border-slate-850 flex items-center gap-1.5">
              <AtSign className="w-3 h-3 text-indigo-400" />
              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Mention Team Member</span>
            </div>
            {suggestions.length > 0 ? (
              <div className="max-h-36 overflow-y-auto">
                {suggestions.map((member, idx) => (
                  <button
                    key={member._id}
                    onClick={() => member.userId.username && insertMention(member.userId.username)}
                    disabled={!member.userId.username}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2.5 transition cursor-pointer ${
                      idx === suggestionIndex
                        ? 'bg-indigo-600 text-white font-semibold'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <div className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-[9px] font-bold uppercase">
                      {member.userId.name.charAt(0)}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="font-semibold text-slate-100 leading-none truncate">
                        {member.userId.name}
                      </span>
                      <span className="text-[9px] text-slate-500 mt-0.5 leading-none truncate">
                        @{member.userId.username}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="px-3 py-2.5 text-[11px] text-slate-500 leading-snug">
                {mentionEmptyHint || 'No matching members.'}
              </p>
            )}
          </div>
        )}

        <form onSubmit={handleSendComment} className="flex gap-2">
          <textarea
            ref={textareaRef}
            rows={2}
            value={newComment}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder="Write a comment... Use @ to mention team members"
            className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-xs transition resize-none leading-relaxed"
            disabled={submitLoading}
          />
          <button
            type="submit"
            disabled={!newComment.trim() || submitLoading}
            className="px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white disabled:text-slate-500 font-medium transition cursor-pointer shrink-0 inline-flex items-center justify-center"
          >
            {submitLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </form>
      </div>
    </div>
    </>
  );
}
