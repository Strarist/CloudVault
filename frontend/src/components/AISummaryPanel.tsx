import React, { useEffect, useState } from 'react';
import { X, Sparkles, FileText, Loader2, RefreshCw, AlertTriangle, CheckCircle2, Clock, Lock } from 'lucide-react';
import { FileDetails, useWorkspaceStore } from '../store/workspaceStore';
import { apiClient } from '../api/client';
import AITagList from './AITagList';

interface AISummaryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  file: FileDetails | null;
  workspaceId: string | undefined;
  userRole: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER' | undefined;
}

interface AIResultData {
  aiEnabled?: boolean;
  status: string;
  summary: string;
  tags: string[];
  modelName: string;
  modelVersion: string;
  generatedAt: string | null;
}

interface ExtractedTextData {
  available?: boolean;
  content: string;
  truncated: boolean;
  reason?: string;
}

export default function AISummaryPanel({
  isOpen,
  onClose,
  file,
  workspaceId,
  userRole,
}: AISummaryPanelProps) {
  const { fetchFiles, fetchIntelligence } = useWorkspaceStore();

  const [activeTab, setActiveTab] = useState<'insights' | 'text'>('insights');
  const [aiResult, setAiResult] = useState<AIResultData | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [textResult, setTextResult] = useState<ExtractedTextData | null>(null);
  const [textLoading, setTextLoading] = useState(false);
  const [reprocessLoading, setReprocessLoading] = useState(false);
  
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [staleQueueHint, setStaleQueueHint] = useState<string | null>(null);
  const pollCountRef = React.useRef(0);

  const isViewer = userRole === 'VIEWER';
  const MAX_POLLS = 40; // ~2 minutes at 3s interval

  // Fetch AI Result
  const fetchAIResult = async () => {
    if (!file || !workspaceId) return;
    setAiLoading(true);
    setError(null);
    try {
      const response = await apiClient.get(`/workspaces/${workspaceId}/files/${file._id}/ai`);
      setAiResult(response.data as AIResultData);
    } catch (err) {
      const axiosError = err as { response?: { data?: { error?: string } } };
      setError(axiosError.response?.data?.error || 'Failed to fetch AI insights.');
    } finally {
      setAiLoading(false);
    }
  };

  // Fetch Extracted Text
  const fetchExtractedText = async () => {
    if (!file || !workspaceId) return;
    setTextLoading(true);
    setError(null);
    try {
      const response = await apiClient.get(`/workspaces/${workspaceId}/files/${file._id}/text`);
      setTextResult(response.data as ExtractedTextData);
    } catch (err) {
      const axiosError = err as { response?: { data?: { error?: string } } };
      setError(axiosError.response?.data?.error || 'Failed to fetch extracted text.');
      setTextResult(null);
    } finally {
      setTextLoading(false);
    }
  };

  // Reprocess Document
  const handleReprocess = async () => {
    if (!file || !workspaceId || isViewer || reprocessLoading) return;
    setReprocessLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await apiClient.post(`/workspaces/${workspaceId}/files/${file._id}/reprocess`);
      setSuccess('Document successfully queued for reprocessing.');
      // Refresh files in parent dashboard
      await fetchFiles(workspaceId);
      // Immediately refresh results (will transition to PENDING/PROCESSING)
      await fetchAIResult();
    } catch (err) {
      const axiosError = err as { response?: { data?: { error?: string } } };
      setError(axiosError.response?.data?.error || 'Failed to request reprocessing.');
    } finally {
      setReprocessLoading(false);
    }
  };

  // Reset local state and fetch AI result on panel toggle / file change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveTab('insights');
    setAiResult(null);
    setTextResult(null);
    setError(null);
    setSuccess(null);
    setAiLoading(false);
    setTextLoading(false);
    setReprocessLoading(false);
    pollCountRef.current = 0;
    setStaleQueueHint(null);

    if (isOpen && file && workspaceId) {
      fetchAIResult();
      // Keep sidebar coverage in sync when opening an already-processed file
      void fetchIntelligence(workspaceId);
    }
  }, [isOpen, file?._id, workspaceId]);

  // Fetch extracted text when switching to the text tab
  useEffect(() => {
    if (isOpen && file && workspaceId && activeTab === 'text') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchExtractedText();
    }
  }, [isOpen, file?._id, workspaceId, activeTab]);

  // Telemetry polling loop: if status is PENDING or PROCESSING, poll every 3 seconds
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const currentStatus = aiResult?.status || file?.aiStatus;
    const isProcessing = currentStatus === 'PROCESSING' || currentStatus === 'PENDING';

    if (isOpen && file && workspaceId && isProcessing) {
      intervalId = setInterval(async () => {
        if (pollCountRef.current >= MAX_POLLS) {
          setStaleQueueHint(
            'AI processing timed out waiting for a worker. Start `npm run worker:dev`, enable workspace AI, then retry reprocessing.',
          );
          if (intervalId) clearInterval(intervalId);
          return;
        }

        try {
          const response = await apiClient.get(`/workspaces/${workspaceId}/files/${file._id}/ai`);
          const newResult = response.data as AIResultData;
          setAiResult(newResult);
          pollCountRef.current += 1;

          if (newResult.status === 'READY' || newResult.status === 'FAILED') {
            setStaleQueueHint(null);
            await fetchFiles(workspaceId);
            await fetchIntelligence(workspaceId);
            if (activeTab === 'text') {
              await fetchExtractedText();
            }
            return;
          }

          if (newResult.status === 'PENDING' && pollCountRef.current >= 10) {
            setStaleQueueHint(
              'Still queued. Ensure the AI worker is running (`npm run worker:dev`) and workspace AI is enabled.',
            );
          }
        } catch {
          pollCountRef.current += 1;
        }
      }, 3000);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isOpen, file?._id, workspaceId, aiResult?.status, file?.aiStatus, activeTab]);

  if (!isOpen || !file || !workspaceId) return null;

  const currentStatus = aiResult?.status || file?.aiStatus || 'NOT_STARTED';
  const isMockProvider =
    !!aiResult?.modelName &&
    /mock/i.test(`${aiResult.modelName} ${aiResult.modelVersion || ''}`);

  return (
    <>
    <button
      type="button"
      aria-label="Close AI panel"
      onClick={onClose}
      className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-[2px] cursor-default border-0"
    />
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[450px] bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col transition-transform duration-300 animate-slide-in">
      
      {/* Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/40 backdrop-blur-md">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-5 h-5 text-indigo-400 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-white truncate" title={file.name}>
              AI Document Intelligence
            </h2>
            {isMockProvider && (
              <span className="text-[10px] font-medium text-amber-400/90">
                Mock provider — local/dev summaries only
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition cursor-pointer shrink-0"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Target Info */}
      <div className="p-4 bg-slate-950/20 border-b border-slate-850 px-5 flex justify-between items-center">
        <div className="truncate pr-4">
          <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">File Name</span>
          <h3 className="text-xs font-semibold text-slate-300 truncate mt-0.5">{file.name}</h3>
        </div>
        
        {/* Status Badge */}
        <div className="shrink-0">
          {currentStatus === 'READY' && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Ready
            </span>
          )}
          {(currentStatus === 'PROCESSING' || currentStatus === 'PENDING') && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Loader2 className="w-3 h-3 animate-spin" />
              Processing
            </span>
          )}
          {currentStatus === 'FAILED' && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
              Failed
            </span>
          )}
          {currentStatus === 'NOT_STARTED' && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
              Unprocessed
            </span>
          )}
        </div>
      </div>

      {/* Tabs Switcher */}
      <div className="flex border-b border-slate-800 bg-slate-950/10 p-1">
        <button
          onClick={() => setActiveTab('insights')}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition ${
            activeTab === 'insights'
              ? 'bg-slate-800 text-white shadow'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>AI Insights</span>
        </button>
        <button
          onClick={() => setActiveTab('text')}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition ${
            activeTab === 'text'
              ? 'bg-slate-800 text-white shadow'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Extracted Text</span>
        </button>
      </div>

      {/* Notifications */}
      {staleQueueHint && (
        <div className="mx-4 mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-300 text-xs flex gap-2">
          <Clock className="w-4 h-4 shrink-0" />
          <span>{staleQueueHint}</span>
        </div>
      )}
      {error && (
        <div className="mx-4 mt-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-xs flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="mx-4 mt-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-xs flex gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* Body Content */}
      <div className="flex-1 overflow-y-auto p-5">
        
        {/* Insights Tab */}
        {activeTab === 'insights' && (
          <div className="space-y-6">
            {aiLoading ? (
              <div className="flex flex-col items-center justify-center h-48">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
                <span className="text-xs text-slate-500 mt-2 font-medium">Fetching AI summary...</span>
              </div>
            ) : aiResult?.aiEnabled === false ? (
              <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
                <Lock className="w-12 h-12 text-slate-500" />
                <div>
                  <p className="text-slate-350 text-sm font-semibold">AI Insights Disabled</p>
                  <p className="text-slate-500 text-xs mt-1.5 max-w-[280px]">
                    AI document intelligence is disabled for this workspace. An administrator can enable it in the workspace settings.
                  </p>
                </div>
              </div>
            ) : currentStatus === 'NOT_STARTED' ? (
              <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
                <Sparkles className="w-12 h-12 text-slate-600" />
                <div>
                  <p className="text-slate-355 text-sm font-semibold font-medium">Insights Not Generated</p>
                  <p className="text-slate-500 text-xs mt-1.5 max-w-[280px]">
                    This document has not been processed. Click the button below to schedule text extraction and summarization.
                  </p>
                </div>
                {!isViewer && (
                  <button
                    onClick={handleReprocess}
                    disabled={reprocessLoading}
                    className="flex items-center gap-1.5 px-4.5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white rounded-xl transition cursor-pointer disabled:opacity-50"
                  >
                    {reprocessLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    <span>Reprocess Insights</span>
                  </button>
                )}
              </div>
            ) : currentStatus === 'PENDING' ? (
              <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
                <Clock className="w-12 h-12 text-indigo-400 animate-pulse" />
                <div>
                  <p className="text-slate-300 text-sm font-semibold">Job Queued</p>
                  <p className="text-slate-500 text-xs mt-1.5 max-w-[280px]">
                    This document is in the processing queue. Insights will display automatically once a worker becomes available.
                  </p>
                </div>
              </div>
            ) : currentStatus === 'PROCESSING' ? (
              <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
                <Loader2 className="w-12 h-12 animate-spin text-indigo-500" />
                <div>
                  <p className="text-indigo-400 text-sm font-semibold">Analyzing Document...</p>
                  <p className="text-slate-500 text-xs mt-1.5 max-w-[280px]">
                    Extracting layout details and running summarization. This panel will refresh automatically.
                  </p>
                </div>
              </div>
            ) : currentStatus === 'FAILED' ? (
              <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
                <AlertTriangle className="w-12 h-12 text-rose-500" />
                <div>
                  <p className="text-slate-300 text-sm font-semibold">Processing Failed</p>
                  <p className="text-slate-500 text-xs mt-1.5 max-w-[280px]">
                    The worker failed to process this document. This may be due to an unsupported format or provider timeout.
                  </p>
                </div>
                {!isViewer && (
                  <button
                    onClick={handleReprocess}
                    disabled={reprocessLoading}
                    className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white rounded-xl transition cursor-pointer disabled:opacity-50"
                  >
                    {reprocessLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    <span>Retry Reprocessing</span>
                  </button>
                )}
              </div>
            ) : (
              aiResult && (
                <div className="space-y-6">
                  {/* Summary Box */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                        {isMockProvider ? 'Mock Summary' : 'AI Generated Summary'}
                      </span>
                      {isMockProvider && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-amber-500/10 text-amber-400 border border-amber-500/25">
                          Dev Mock
                        </span>
                      )}
                    </div>
                    <div className="p-4 bg-slate-950/40 border border-slate-850 rounded-xl leading-relaxed text-sm text-slate-300">
                      {aiResult.summary}
                    </div>
                  </div>

                  {/* Tags Box */}
                  <div className="space-y-2.5">
                    <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Generated Tags</span>
                    <AITagList tags={aiResult.tags} />
                  </div>

                  {/* Metadata Audit Box */}
                  <div className="p-4 bg-slate-950/20 border border-slate-850/80 rounded-xl space-y-2">
                    <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">AI Pipeline Metadata</span>
                    <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-xs mt-1">
                      <div>
                        <span className="text-slate-500 block">Model Engine</span>
                        <span className="text-slate-300 font-medium">{aiResult.modelName} (v{aiResult.modelVersion})</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Processed On</span>
                        <span className="text-slate-300 font-medium">
                          {aiResult.generatedAt ? new Date(aiResult.generatedAt).toLocaleString() : 'N/A'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Reprocess controls for editors */}
                  {!isViewer && (
                    <div className="pt-4 border-t border-slate-800 flex justify-end">
                      <button
                        onClick={handleReprocess}
                        disabled={reprocessLoading || currentStatus === 'PROCESSING' || currentStatus === 'PENDING'}
                        className="flex items-center gap-1.5 px-4.5 py-2.5 bg-slate-800 hover:bg-slate-750 text-xs font-semibold text-slate-300 border border-slate-700 rounded-xl transition cursor-pointer disabled:opacity-50"
                        title="Reprocess Document"
                      >
                        {reprocessLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        <span>Reprocess Insights</span>
                      </button>
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        )}

        {/* Extracted Text Tab */}
        {activeTab === 'text' && (
          <div className="h-full flex flex-col">
            {textLoading ? (
              <div className="flex flex-col items-center justify-center h-48">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
                <span className="text-xs text-slate-500 mt-2 font-medium">Downloading text cache...</span>
              </div>
            ) : aiResult?.aiEnabled === false ? (
              <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
                <Lock className="w-10 h-10 text-slate-500" />
                <p className="text-slate-350 text-sm font-semibold">AI Features Disabled</p>
                <p className="text-slate-500 text-xs mt-1.5 max-w-[280px]">
                  Text extraction is disabled for this workspace. Enable AI to process text assets.
                </p>
              </div>
            ) : textResult?.available === false ? (
              <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
                <FileText className="w-10 h-10 text-slate-600 animate-pulse" />
                <p className="text-slate-350 text-sm font-semibold">Extracted text is not yet available.</p>
                <p className="text-slate-550 text-xs mt-1.5 max-w-[280px]">
                  Text extraction runs as part of the AI processing pipeline. Wait for status to become Ready.
                </p>
              </div>
            ) : (
              textResult && (
                <div className="space-y-4">
                  {textResult.truncated && (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400 text-xs flex gap-2">
                      <AlertTriangle className="w-4.5 h-4.5 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold block">Preview Cache Loaded</span>
                        <span>Large files are safely truncated to 50KB in cache. Full text remains archived in storage.</span>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2 h-full">
                    <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Raw Extracted Content</span>
                    <pre className="p-4 bg-slate-950/80 border border-slate-850 rounded-xl text-xs text-slate-355 font-mono overflow-auto max-h-[450px] whitespace-pre-wrap leading-relaxed">
                      {textResult.content}
                    </pre>
                  </div>
                </div>
              )
            )}
          </div>
        )}

      </div>
    </div>
    </>
  );
}
