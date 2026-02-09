import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload,
  FileText,
  Image as ImageIcon,
  X,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { uploadEstimateFile, processEstimate } from '@/lib/estimates-api';
import { cn } from '@/lib/utils';

// Accepted MIME types for estimates (PDF and images)
const ACCEPTED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
];
const ACCEPT_ATTR = '.pdf,.jpg,.jpeg,.png,.gif';

type FileStatus = 'pending' | 'uploading' | 'processing' | 'done' | 'error';

interface UploadedFile {
  file: File;
  id: string;
  status: FileStatus;
  progress: number;
  error?: string;
  estimateId?: string;
  itemCount?: number;
  newFieldsDiscovered?: number;
}

interface UploadEstimateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadComplete?: () => void;
}

function isAcceptedFile(file: File): boolean {
  return ACCEPTED_TYPES.includes(file.type);
}

function fileIcon(file: File) {
  if (file.type === 'application/pdf') {
    return <FileText className="h-4 w-4 shrink-0 text-primary" />;
  }
  return <ImageIcon className="h-4 w-4 shrink-0 text-primary" />;
}

export function UploadEstimateModal({
  open,
  onOpenChange,
  onUploadComplete,
}: UploadEstimateModalProps) {
  const navigate = useNavigate();
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();

  // -----------------------------------------------------------------------
  // Drag & drop / file selection
  // -----------------------------------------------------------------------

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files).filter(isAcceptedFile);
    addFiles(droppedFiles);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files).filter(isAcceptedFile);
      addFiles(selectedFiles);
    }
  };

  const addFiles = (newFiles: File[]) => {
    if (newFiles.length === 0) return;
    const uploadedFiles: UploadedFile[] = newFiles.map((file) => ({
      file,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      status: 'pending' as const,
      progress: 0,
    }));
    setFiles((prev) => [...prev, ...uploadedFiles]);
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  // -----------------------------------------------------------------------
  // Helpers to update a single file entry immutably
  // -----------------------------------------------------------------------

  const updateFile = (id: string, patch: Partial<UploadedFile>) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  // -----------------------------------------------------------------------
  // Upload & process a single file via Supabase
  // -----------------------------------------------------------------------

  const uploadAndProcess = async (entry: UploadedFile): Promise<string | null> => {
    if (!user) throw new Error('You must be signed in to upload.');

    // Phase 1 – Upload to Supabase Storage + create estimate row
    updateFile(entry.id, { status: 'uploading', progress: 15 });
    const { estimateId } = await uploadEstimateFile(entry.file, user.id);
    updateFile(entry.id, { estimateId, progress: 40 });

    // Phase 2 – Invoke the process-estimate Edge Function (Gemini)
    updateFile(entry.id, { status: 'processing', progress: 55 });
    const result = await processEstimate(estimateId);
    updateFile(entry.id, {
      status: 'done',
      progress: 100,
      itemCount: result.itemCount,
      newFieldsDiscovered: result.newFieldsDiscovered,
    });

    return estimateId;
  };

  // -----------------------------------------------------------------------
  // Process all pending files
  // -----------------------------------------------------------------------

  const processFiles = async () => {
    const pendingFiles = files.filter((f) => f.status === 'pending');

    if (pendingFiles.length === 0) {
      toast({
        title: 'No files to process',
        description: 'Add PDF or image files to upload.',
        variant: 'destructive',
      });
      return;
    }

    setIsProcessing(true);

    const processedEstimateIds: string[] = [];

    for (const entry of pendingFiles) {
      try {
        const estimateId = await uploadAndProcess(entry);
        if (estimateId) processedEstimateIds.push(estimateId);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'An unknown error occurred';
        updateFile(entry.id, { status: 'error', error: message });
      }
    }

    setIsProcessing(false);
    onUploadComplete?.();

    // Navigate to wizard with all processed estimate IDs
    if (processedEstimateIds.length > 0) {
      setFiles([]);
      onOpenChange(false);
      const idsParam = processedEstimateIds.join(',');
      navigate(`/app/estimates/wizard?ids=${idsParam}`);
    }
  };

  const handleClose = () => {
    if (!isProcessing) {
      setFiles([]);
      onOpenChange(false);
    }
  };

  const pendingCount = files.filter((f) => f.status === 'pending').length;
  const completedCount = files.filter((f) => f.status === 'done').length;

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload Estimates</DialogTitle>
          <DialogDescription>
            Drop PDF or image files, or click to browse. Multiple files
            supported.
          </DialogDescription>
        </DialogHeader>

        {/* Drop zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            'relative flex min-h-[140px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border transition-colors',
            isDragOver && 'border-primary bg-primary/5',
            'hover:border-primary/50 hover:bg-muted/50'
          )}
        >
          <input
            type="file"
            accept={ACCEPT_ATTR}
            multiple
            onChange={handleFileSelect}
            className="absolute inset-0 cursor-pointer opacity-0"
            disabled={isProcessing}
          />
          <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">Drop PDF or image files here</p>
          <p className="text-xs text-muted-foreground">or click to browse</p>
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="max-h-[200px] space-y-2 overflow-y-auto">
            {files.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-2 rounded border border-border p-2"
              >
                {fileIcon(entry.file)}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">
                    {entry.file.name}
                  </p>
                  {(entry.status === 'uploading' ||
                    entry.status === 'processing') && (
                    <Progress value={entry.progress} className="mt-1 h-1" />
                  )}
                  {entry.status === 'error' && (
                    <p className="text-xs text-destructive">{entry.error}</p>
                  )}
                  {entry.status === 'done' && entry.itemCount !== undefined && (
                    <p className="text-xs text-muted-foreground">
                      {entry.itemCount} item(s) extracted
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {entry.status === 'pending' && (
                    <Badge variant="secondary" className="text-xs">
                      Pending
                    </Badge>
                  )}
                  {entry.status === 'uploading' && (
                    <Badge variant="default" className="gap-1 text-xs">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Uploading
                    </Badge>
                  )}
                  {entry.status === 'processing' && (
                    <Badge variant="default" className="gap-1 text-xs">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Processing
                    </Badge>
                  )}
                  {entry.status === 'done' && (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  )}
                  {entry.status === 'error' && (
                    <AlertCircle className="h-4 w-4 text-destructive" />
                  )}
                  {entry.status === 'pending' && !isProcessing && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => removeFile(entry.id)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            onClick={processFiles}
            disabled={pendingCount === 0 || isProcessing}
            className="flex-1"
          >
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing…
              </>
            ) : (
              `Process ${pendingCount} File${pendingCount !== 1 ? 's' : ''}`
            )}
          </Button>
          {completedCount > 0 && !isProcessing && (
            <Button variant="outline" onClick={handleClose}>
              Done
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
