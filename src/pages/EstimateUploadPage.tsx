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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
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
  /** Local tracking ID (not the Supabase estimate ID). */
  id: string;
  status: FileStatus;
  /** 0-100 progress indicator. */
  progress: number;
  error?: string;
  /** Supabase estimate UUID, set once the upload phase succeeds. */
  estimateId?: string;
  /** Count of items extracted by Gemini. */
  itemCount?: number;
  /** Count of new fields discovered by Gemini. */
  newFieldsDiscovered?: number;
}

function isAcceptedFile(file: File): boolean {
  return ACCEPTED_TYPES.includes(file.type);
}

function fileIcon(file: File) {
  if (file.type === 'application/pdf') {
    return <FileText className="h-5 w-5 shrink-0 text-primary" />;
  }
  return <ImageIcon className="h-5 w-5 shrink-0 text-primary" />;
}

export default function EstimateUploadPage() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

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
    if (newFiles.length === 0) {
      toast({
        title: 'Unsupported file type',
        description: 'Only PDF, JPG, PNG, and GIF files are accepted.',
        variant: 'destructive',
      });
      return;
    }
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

    toast({
      title: 'Processing started',
      description: `Uploading and processing ${pendingFiles.length} file(s)…`,
    });

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

    if (processedEstimateIds.length > 0) {
      toast({
        title: 'Processing complete',
        description: `${processedEstimateIds.length} estimate(s) ready for review.`,
      });

      // Navigate to wizard with all processed estimate IDs
      const idsParam = processedEstimateIds.join(',');
      navigate(`/app/estimates/wizard?ids=${idsParam}`);
    } else {
      toast({
        title: 'Processing failed',
        description: 'None of the files could be processed. Check errors above.',
        variant: 'destructive',
      });
    }
  };

  // -----------------------------------------------------------------------
  // Derived counts
  // -----------------------------------------------------------------------

  const pendingCount = files.filter((f) => f.status === 'pending').length;
  const doneCount = files.filter((f) => f.status === 'done').length;
  const errorCount = files.filter((f) => f.status === 'error').length;

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="font-display text-4xl tracking-wide">Upload Estimate</h1>
        <p className="mt-1 text-muted-foreground">
          Upload estimate PDFs or images for AI-powered field extraction
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Upload card */}
        <Card>
          <CardHeader>
            <CardTitle>Upload Files</CardTitle>
            <CardDescription>
              Drag and drop PDF or image files, or click to browse
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Drop zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={cn(
                'relative flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border transition-colors',
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
              <Upload className="mb-4 h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-medium">
                Drop PDF or image files here
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Supports PDF, JPG, PNG, GIF — or click to browse
              </p>
            </div>

            {/* File list */}
            {files.length > 0 && (
              <div className="mt-6 space-y-3">
                {files.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center gap-3 rounded-lg border border-border p-3"
                  >
                    {fileIcon(entry.file)}

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {entry.file.name}
                      </p>

                      {(entry.status === 'uploading' ||
                        entry.status === 'processing') && (
                        <Progress
                          value={entry.progress}
                          className="mt-2 h-1"
                        />
                      )}

                      {entry.status === 'error' && (
                        <p className="mt-1 text-xs text-destructive">
                          {entry.error}
                        </p>
                      )}

                      {entry.status === 'done' && entry.itemCount !== undefined && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {entry.itemCount} item(s) extracted
                          {entry.newFieldsDiscovered
                            ? `, ${entry.newFieldsDiscovered} new field(s) discovered`
                            : ''}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {entry.status === 'pending' && (
                        <Badge variant="secondary">Pending</Badge>
                      )}
                      {entry.status === 'uploading' && (
                        <Badge variant="default" className="gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Uploading
                        </Badge>
                      )}
                      {entry.status === 'processing' && (
                        <Badge variant="default" className="gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Processing
                        </Badge>
                      )}
                      {entry.status === 'done' && (
                        <CheckCircle2 className="h-5 w-5 text-success" />
                      )}
                      {entry.status === 'error' && (
                        <AlertCircle className="h-5 w-5 text-destructive" />
                      )}
                      {entry.status === 'pending' && !isProcessing && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeFile(entry.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Action button */}
            <div className="mt-6">
              <Button
                onClick={processFiles}
                disabled={pendingCount === 0 || isProcessing}
                className="w-full"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing…
                  </>
                ) : (
                  `Upload & Process ${pendingCount > 0 ? `${pendingCount} File${pendingCount !== 1 ? 's' : ''}` : 'Files'}`
                )}
              </Button>

              {/* Summary after processing */}
              {!isProcessing && (doneCount > 0 || errorCount > 0) && (
                <p className="mt-3 text-center text-xs text-muted-foreground">
                  {doneCount > 0 && `${doneCount} succeeded`}
                  {doneCount > 0 && errorCount > 0 && ' · '}
                  {errorCount > 0 && `${errorCount} failed`}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* How it works card */}
        <Card>
          <CardHeader>
            <CardTitle>How It Works</CardTitle>
            <CardDescription>
              AI-powered estimate extraction process
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
                  1
                </div>
                <div>
                  <p className="font-medium">Upload PDF or Image</p>
                  <p className="text-sm text-muted-foreground">
                    Upload estimate files — PDFs, photos, or scans
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
                  2
                </div>
                <div>
                  <p className="font-medium">AI Extraction</p>
                  <p className="text-sm text-muted-foreground">
                    Gemini reads the document and extracts line items, fields,
                    and customer info automatically
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
                  3
                </div>
                <div>
                  <p className="font-medium">Review & Edit</p>
                  <p className="text-sm text-muted-foreground">
                    Verify the extracted data side-by-side with the original
                    document and make corrections
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
                  4
                </div>
                <div>
                  <p className="font-medium">Generate Quote</p>
                  <p className="text-sm text-muted-foreground">
                    Create customer and manufacturer quotes from the extracted
                    data
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
