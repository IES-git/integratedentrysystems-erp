import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import {
  FileText,
  Image as ImageIcon,
  Maximize2,
  Minimize2,
  X,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  RotateCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface FilePreviewProps {
  fileUrl: string;
  fileName: string;
  fileType?: 'pdf' | 'image';
  className?: string;
  onClose?: () => void;
  expandable?: boolean;
}

// Default aspect ratio for letter paper (8.5 x 11)
const DEFAULT_ASPECT = 8.5 / 11;

export function FilePreview({
  fileUrl,
  fileName,
  fileType = 'pdf',
  className,
  onClose,
  expandable = true,
}: FilePreviewProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(
    null
  );
  const [pageAspectRatio, setPageAspectRatio] = useState<number>(DEFAULT_ASPECT);
  const containerRef = useRef<HTMLDivElement>(null);

  const isPdf = fileType === 'pdf';
  const Icon = isPdf ? FileText : ImageIcon;
  const fileTypeLabel = isPdf ? 'PDF' : 'Image';

  // Measure container width AND height so we can fit the page inside
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setContainerSize({ width, height });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [isExpanded]);

  const handleOpenInNewTab = () => {
    window.open(fileUrl, '_blank');
  };

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 25, 300));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 25, 25));
  const handleResetZoom = () => setZoom(100);

  const handleDocumentLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
    setCurrentPage(1);
    setLoadError(false);
  }, []);

  const handleDocumentLoadError = useCallback(() => {
    setLoadError(true);
  }, []);

  // Capture the page's native aspect ratio once it renders
  const handlePageLoadSuccess = useCallback(
    (page: { originalWidth?: number; originalHeight?: number; width: number; height: number }) => {
      const w = page.originalWidth ?? page.width;
      const h = page.originalHeight ?? page.height;
      if (w && h) {
        setPageAspectRatio(w / h);
      }
    },
    []
  );

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, numPages)));
  };

  const goToPrevPage = () => goToPage(currentPage - 1);
  const goToNextPage = () => goToPage(currentPage + 1);

  // Compute the width to pass to react-pdf <Page>.
  // At 100 % zoom the page fits entirely (both width and height) inside the container.
  // Zooming above 100 % lets the page grow larger (with scrolling enabled).
  const fittedPageWidth = useMemo(() => {
    if (!containerSize) return undefined;

    const padding = 32; // 16px each side
    const availableWidth = containerSize.width - padding;
    const availableHeight = containerSize.height - padding;

    // Width if we constrain by width
    const wByWidth = availableWidth;
    // Width if we constrain by height (derive width from aspect ratio)
    const wByHeight = availableHeight * pageAspectRatio;

    // Base "fit" width — the smaller of the two so the page fits in both dims
    const fitWidth = Math.max(100, Math.min(wByWidth, wByHeight));

    // Apply zoom
    return fitWidth * (zoom / 100);
  }, [containerSize, pageAspectRatio, zoom]);

  const renderFallback = (iconSize: string, textSize: string) => (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground py-8">
      <Icon className={iconSize} />
      <p className={textSize}>Unable to preview {fileTypeLabel.toLowerCase()}</p>
      <Button variant="outline" size="sm" onClick={handleOpenInNewTab}>
        Open in New Tab
      </Button>
    </div>
  );

  const renderPageControls = () => {
    if (!isPdf || numPages <= 1) return null;
    return (
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={goToPrevPage}
          disabled={currentPage <= 1}
          title="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-1 min-w-[5rem] justify-center">
          <span className="text-xs text-muted-foreground tabular-nums">
            {currentPage} / {numPages}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={goToNextPage}
          disabled={currentPage >= numPages}
          title="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    );
  };

  const renderZoomControls = () => (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={handleZoomOut}
        disabled={zoom <= 25}
        title="Zoom out"
      >
        <ZoomOut className="h-3.5 w-3.5" />
      </Button>
      <button
        onClick={handleResetZoom}
        className="text-xs text-muted-foreground min-w-[3rem] text-center hover:text-foreground transition-colors tabular-nums"
        title="Reset zoom"
      >
        {zoom}%
      </button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={handleZoomIn}
        disabled={zoom >= 300}
        title="Zoom in"
      >
        <ZoomIn className="h-3.5 w-3.5" />
      </Button>
    </div>
  );

  // Whether the current zoom causes the page to exceed the container
  const isOverflowing = zoom > 100;

  const renderPdfContent = () => {
    if (loadError) return renderFallback('h-10 w-10', 'text-sm');

    return (
      <div
        ref={containerRef}
        className={cn(
          'flex-1 min-h-0 flex items-center justify-center',
          isOverflowing ? 'overflow-auto' : 'overflow-hidden'
        )}
      >
        <Document
          file={fileUrl}
          onLoadSuccess={handleDocumentLoadSuccess}
          onLoadError={handleDocumentLoadError}
          loading={
            <div className="flex items-center justify-center py-20">
              <RotateCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          }
          error={renderFallback('h-10 w-10', 'text-sm')}
        >
          <Page
            pageNumber={currentPage}
            width={fittedPageWidth}
            onLoadSuccess={handlePageLoadSuccess}
            renderTextLayer={true}
            renderAnnotationLayer={true}
            loading={
              <div className="flex items-center justify-center py-20">
                <RotateCw className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            }
            className="shadow-lg rounded"
          />
        </Document>
      </div>
    );
  };

  const renderImageContent = () => {
    if (loadError) return renderFallback('h-10 w-10', 'text-sm');

    return (
      <div
        ref={containerRef}
        className={cn(
          'flex-1 min-h-0 flex items-center justify-center bg-muted/20',
          isOverflowing ? 'overflow-auto' : 'overflow-hidden'
        )}
      >
        <img
          src={fileUrl}
          alt={fileName}
          className="max-w-full max-h-full object-contain transition-transform"
          style={{
            transform: `scale(${zoom / 100})`,
            transformOrigin: 'center center',
          }}
          onError={() => setLoadError(true)}
          draggable={false}
        />
      </div>
    );
  };

  // Expanded (fullscreen) view
  if (isExpanded) {
    return (
      <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center justify-between border-b px-4 py-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className="h-5 w-5 text-primary shrink-0" />
            <span className="font-medium truncate">{fileName}</span>
          </div>
          <div className="flex items-center gap-2">
            {renderPageControls()}
            <div className="w-px h-5 bg-border mx-1" />
            {renderZoomControls()}
            <div className="w-px h-5 bg-border mx-1" />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                setIsExpanded(false);
                handleResetZoom();
              }}
              title="Exit fullscreen"
            >
              <Minimize2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {/* Content */}
        {isPdf ? renderPdfContent() : renderImageContent()}
      </div>
    );
  }

  // Inline view
  return (
    <div className={cn('flex flex-col rounded-lg border bg-card overflow-hidden', className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b px-3 py-2 shrink-0 bg-card">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-medium truncate">{fileName}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {renderPageControls()}
          {(numPages > 1 || !isPdf) && <div className="w-px h-4 bg-border mx-0.5" />}
          {renderZoomControls()}
          {expandable && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setIsExpanded(true)}
              title="Fullscreen"
            >
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
      {/* Content */}
      {isPdf ? renderPdfContent() : renderImageContent()}
    </div>
  );
}
