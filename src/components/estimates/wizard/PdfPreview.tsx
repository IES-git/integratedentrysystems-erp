import { useState } from 'react';
import { FileText, Maximize2, Minimize2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PdfPreviewProps {
  pdfUrl: string;
  fileName: string;
  className?: string;
  onClose?: () => void;
  expandable?: boolean;
}

export function PdfPreview({ pdfUrl, fileName, className, onClose, expandable = true }: PdfPreviewProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const handleOpenInNewTab = () => {
    window.open(pdfUrl, '_blank');
  };

  if (isExpanded) {
    return (
      <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            <span className="font-medium">{fileName}</span>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setIsExpanded(false)}>
            <Minimize2 className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 p-4">
          <object
            data={pdfUrl}
            type="application/pdf"
            className="h-full w-full rounded-lg border"
            title={`PDF Preview: ${fileName}`}
          >
            <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
              <FileText className="h-12 w-12" />
              <p>Unable to display PDF</p>
              <Button variant="outline" onClick={handleOpenInNewTab}>
                Open in New Tab
              </Button>
            </div>
          </object>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col rounded-lg border bg-card', className)}>
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-medium truncate">{fileName}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {expandable && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsExpanded(true)}>
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          )}
          {onClose && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 p-2">
        {loadError ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground py-8">
            <FileText className="h-10 w-10" />
            <p className="text-sm">Unable to preview PDF</p>
            <Button variant="outline" size="sm" onClick={handleOpenInNewTab}>
              Open in New Tab
            </Button>
          </div>
        ) : (
          <object
            data={pdfUrl}
            type="application/pdf"
            className="h-full w-full rounded border"
            title={`PDF Preview: ${fileName}`}
            onError={() => setLoadError(true)}
          >
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground py-8">
              <FileText className="h-10 w-10" />
              <p className="text-sm">Unable to preview PDF</p>
              <Button variant="outline" size="sm" onClick={handleOpenInNewTab}>
                Open in New Tab
              </Button>
            </div>
          </object>
        )}
      </div>
    </div>
  );
}
