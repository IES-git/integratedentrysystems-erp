import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, FileText, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
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
}

export default function EstimateUploadPage() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

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
    // Update status to processing
    setFiles((prev) =>
      prev.map((f) =>
        f.id === uploadedFile.id ? { ...f, status: 'processing' as const, progress: 10 } : f
      )
    );

    // Simulate progress
    for (let progress = 20; progress <= 90; progress += 10) {
      await new Promise((r) => setTimeout(r, 200));
      setFiles((prev) =>
        prev.map((f) => (f.id === uploadedFile.id ? { ...f, progress } : f))
      );
    }

    // Create estimate in storage
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

    // Create sample parsed items (simulating OCR results)
    const sampleItems = [
      {
        itemLabel: 'Frame 1',
        canonicalCode: '4-0 X 7-0 HM FRAME',
        quantity: 2,
      },
      {
        itemLabel: 'Door 1',
        canonicalCode: '3-0 X 7-0 HM DOOR',
        quantity: 2,
      },
    ];

    for (const item of sampleItems) {
      const estimateItem = estimateItemStorage.create({
        estimateId: estimate.id,
        itemLabel: item.itemLabel,
        canonicalCode: item.canonicalCode,
        quantity: item.quantity,
      });

      // Add sample fields
      const sampleFields = [
        { fieldKey: 'gauge', fieldLabel: 'Gauge', fieldValue: '16 GA', valueType: 'code' as const },
        { fieldKey: 'finish', fieldLabel: 'Finish', fieldValue: 'P1 Prime Paint', valueType: 'string' as const },
        { fieldKey: 'anchor_type', fieldLabel: 'Anchor Type', fieldValue: 'Floor Anchors', valueType: 'string' as const },
        { fieldKey: 'hinge_prep', fieldLabel: 'Hinge Prep', fieldValue: '4-1/2" x 4-1/2" STD WT', valueType: 'string' as const },
        { fieldKey: 'strike_prep', fieldLabel: 'Strike Prep', fieldValue: 'ASA Strike', valueType: 'string' as const },
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

    // Complete
    setFiles((prev) =>
      prev.map((f) =>
        f.id === uploadedFile.id ? { ...f, status: 'done' as const, progress: 100 } : f
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

    toast({
      title: 'Processing started',
      description: `Processing ${pendingFiles.length} file(s)...`,
    });

    for (const file of pendingFiles) {
      try {
        await simulateOCR(file);
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

    toast({
      title: 'Processing complete',
      description: 'All files have been processed. Review the extracted data.',
    });
  };

  const completedCount = files.filter((f) => f.status === 'done').length;
  const hasCompletedFiles = completedCount > 0;

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="font-display text-4xl tracking-wide">Upload Estimate</h1>
        <p className="mt-1 text-muted-foreground">
          Upload Ceco PDF estimates for OCR processing and field extraction
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Upload Files</CardTitle>
            <CardDescription>
              Drag and drop PDF files or click to browse
            </CardDescription>
          </CardHeader>
          <CardContent>
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
                accept=".pdf"
                multiple
                onChange={handleFileSelect}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
              <Upload className="mb-4 h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-medium">Drop PDF files here</p>
              <p className="mt-1 text-xs text-muted-foreground">
                or click to browse
              </p>
            </div>

            {files.length > 0 && (
              <div className="mt-6 space-y-3">
                {files.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center gap-3 rounded-lg border border-border p-3"
                  >
                    <FileText className="h-5 w-5 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {file.file.name}
                      </p>
                      {file.status === 'processing' && (
                        <Progress value={file.progress} className="mt-2 h-1" />
                      )}
                      {file.status === 'error' && (
                        <p className="mt-1 text-xs text-destructive">
                          {file.error}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {file.status === 'pending' && (
                        <Badge variant="secondary">Pending</Badge>
                      )}
                      {file.status === 'processing' && (
                        <Badge variant="default">Processing</Badge>
                      )}
                      {file.status === 'done' && (
                        <CheckCircle2 className="h-5 w-5 text-success" />
                      )}
                      {file.status === 'error' && (
                        <AlertCircle className="h-5 w-5 text-destructive" />
                      )}
                      {file.status === 'pending' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeFile(file.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-6 flex gap-3">
              <Button
                onClick={processFiles}
                disabled={files.filter((f) => f.status === 'pending').length === 0}
                className="flex-1"
              >
                Process Files
              </Button>
              {hasCompletedFiles && (
                <Button
                  variant="outline"
                  onClick={() => navigate('/app/estimates')}
                >
                  View Estimates
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>How It Works</CardTitle>
            <CardDescription>
              The OCR extraction process
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
                  1
                </div>
                <div>
                  <p className="font-medium">Upload PDF</p>
                  <p className="text-sm text-muted-foreground">
                    Upload Ceco estimate PDFs for processing
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
                  2
                </div>
                <div>
                  <p className="font-medium">OCR Extraction</p>
                  <p className="text-sm text-muted-foreground">
                    System parses the PDF and extracts all field/value pairs
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
                    Verify extracted data and make corrections if needed
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
                    Create customer and manufacturer quotes from the data
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
