import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, FileText, X, AlertCircle, CheckCircle2 } from 'lucide-react';
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
import { estimateStorage, estimateItemStorage, itemFieldStorage } from '@/lib/storage';
import { cn } from '@/lib/utils';

interface UploadedFile {
  file: File;
  id: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  progress: number;
  error?: string;
  estimateId?: string;
}

interface UploadEstimateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadComplete?: () => void;
}

export function UploadEstimateModal({ open, onOpenChange, onUploadComplete }: UploadEstimateModalProps) {
  const navigate = useNavigate();
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();

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
    const droppedFiles = Array.from(e.dataTransfer.files).filter(
      (f) => f.type === 'application/pdf'
    );
    addFiles(droppedFiles);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files).filter(
        (f) => f.type === 'application/pdf'
      );
      addFiles(selectedFiles);
    }
  };

  const addFiles = (newFiles: File[]) => {
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

  const simulateOCR = async (uploadedFile: UploadedFile) => {
    setFiles((prev) =>
      prev.map((f) =>
        f.id === uploadedFile.id ? { ...f, status: 'processing' as const, progress: 10 } : f
      )
    );

    for (let progress = 20; progress <= 90; progress += 10) {
      await new Promise((r) => setTimeout(r, 150));
      setFiles((prev) =>
        prev.map((f) => (f.id === uploadedFile.id ? { ...f, progress } : f))
      );
    }

    const estimate = estimateStorage.create({
      customerId: null,
      uploadedByUserId: user?.id || '',
      source: 'ceco_pdf',
      originalPdfUrl: URL.createObjectURL(uploadedFile.file),
      originalPdfName: uploadedFile.file.name,
      ocrStatus: 'done',
      ocrError: null,
      extractedAt: new Date().toISOString(),
    });

    const sampleItems = [
      { itemLabel: 'Frame 1', canonicalCode: '4-0 X 7-0 HM FRAME', quantity: 2 },
      { itemLabel: 'Door 1', canonicalCode: '3-0 X 7-0 HM DOOR', quantity: 2 },
    ];

    for (const item of sampleItems) {
      const estimateItem = estimateItemStorage.create({
        estimateId: estimate.id,
        itemLabel: item.itemLabel,
        canonicalCode: item.canonicalCode,
        quantity: item.quantity,
      });

      const sampleFields = [
        { fieldKey: 'gauge', fieldLabel: 'Gauge', fieldValue: '16 GA', valueType: 'code' as const },
        { fieldKey: 'finish', fieldLabel: 'Finish', fieldValue: 'P1 Prime Paint', valueType: 'string' as const },
        { fieldKey: 'anchor_type', fieldLabel: 'Anchor Type', fieldValue: 'Floor Anchors', valueType: 'string' as const },
      ];

      for (const field of sampleFields) {
        itemFieldStorage.create({
          estimateItemId: estimateItem.id,
          fieldKey: field.fieldKey,
          fieldLabel: field.fieldLabel,
          fieldValue: field.fieldValue,
          valueType: field.valueType,
          sourceConfidence: 0.95,
        });
      }
    }

    setFiles((prev) =>
      prev.map((f) =>
        f.id === uploadedFile.id ? { ...f, status: 'done' as const, progress: 100, estimateId: estimate.id } : f
      )
    );

    return estimate;
  };

  const processFiles = async () => {
    const pendingFiles = files.filter((f) => f.status === 'pending');

    if (pendingFiles.length === 0) {
      toast({
        title: 'No files to process',
        description: 'Add PDF files to upload',
        variant: 'destructive',
      });
      return;
    }

    setIsProcessing(true);

    let lastEstimateId: string | undefined;

    for (const file of pendingFiles) {
      try {
        const estimate = await simulateOCR(file);
        lastEstimateId = estimate.id;
      } catch {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === file.id
              ? { ...f, status: 'error' as const, error: 'Processing failed' }
              : f
          )
        );
      }
    }

    setIsProcessing(false);
    
    onUploadComplete?.();

    // Navigate to wizard with the first processed estimate
    if (lastEstimateId) {
      setFiles([]);
      onOpenChange(false);
      navigate(`/app/estimates/wizard?id=${lastEstimateId}`);
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

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload Estimates</DialogTitle>
          <DialogDescription>
            Drop PDF files or click to browse. Multiple files supported.
          </DialogDescription>
        </DialogHeader>

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
            accept=".pdf"
            multiple
            onChange={handleFileSelect}
            className="absolute inset-0 cursor-pointer opacity-0"
            disabled={isProcessing}
          />
          <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">Drop PDF files here</p>
          <p className="text-xs text-muted-foreground">or click to browse</p>
        </div>

        {files.length > 0 && (
          <div className="max-h-[200px] space-y-2 overflow-y-auto">
            {files.map((file) => (
              <div
                key={file.id}
                className="flex items-center gap-2 rounded border border-border p-2"
              >
                <FileText className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{file.file.name}</p>
                  {file.status === 'processing' && (
                    <Progress value={file.progress} className="mt-1 h-1" />
                  )}
                  {file.status === 'error' && (
                    <p className="text-xs text-destructive">{file.error}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {file.status === 'pending' && (
                    <Badge variant="secondary" className="text-xs">Pending</Badge>
                  )}
                  {file.status === 'processing' && (
                    <Badge variant="default" className="text-xs">Processing</Badge>
                  )}
                  {file.status === 'done' && (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  )}
                  {file.status === 'error' && (
                    <AlertCircle className="h-4 w-4 text-destructive" />
                  )}
                  {file.status === 'pending' && !isProcessing && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => removeFile(file.id)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            onClick={processFiles}
            disabled={pendingCount === 0 || isProcessing}
            className="flex-1"
          >
            {isProcessing ? 'Processing...' : `Process ${pendingCount} File${pendingCount !== 1 ? 's' : ''}`}
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
