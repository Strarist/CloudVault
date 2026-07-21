import React from 'react';

interface AITagListProps {
  tags: string[];
}

export default function AITagList({ tags }: AITagListProps) {
  if (!tags || tags.length === 0) {
    return <span className="text-xs text-slate-500 italic">No tags generated.</span>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag, idx) => (
        <span
          key={idx}
          className="inline-flex items-center px-3 py-1 rounded-xl text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shadow-sm transition duration-150 hover:scale-105 hover:bg-indigo-500/20"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}
