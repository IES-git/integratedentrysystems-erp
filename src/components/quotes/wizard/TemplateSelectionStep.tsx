import { useState, useMemo } from 'react';
import { Search, FileCode2, Sparkles, Wand2, PenTool, CheckCircle2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Template } from '@/types';

type SelectionMode = 'templates' | 'ai' | 'custom';

interface TemplateSelectionStepProps {
  templates: Template[];
  quoteType: 'customer' | 'manufacturer' | 'both';
  selectedTemplateId: string | null;
  onTemplateChange: (id: string | null) => void;
  onBack: () => void;
  onComplete: () => void;
}

// Mock AI matching scores - in real implementation this would come from backend
function getAiMatchScore(template: Template): number {
  const hash = template.id.split('').reduce((a, b) => {
    a = (a << 5) - a + b.charCodeAt(0);
    return a & a;
  }, 0);
  return 65 + Math.abs(hash % 30); // 65-95%
}

export function TemplateSelectionStep({
  templates,
  quoteType,
  selectedTemplateId,
  onTemplateChange,
  onBack,
  onComplete,
}: TemplateSelectionStepProps) {
  // Default to 'ai' if no templates available, otherwise 'templates'
  const [selectionMode, setSelectionMode] = useState<SelectionMode>(() => 
    templates.length === 0 ? 'ai' : 'templates'
  );
  const [searchQuery, setSearchQuery] = useState('');

  // Filter templates by audience based on quote type
  const relevantTemplates = useMemo(() => {
    if (quoteType === 'both') return templates;
    return templates.filter((t) => t.audience === quoteType);
  }, [templates, quoteType]);

  // Add AI scores and sort by match percentage
  const templatesWithScores = useMemo(() => {
    return relevantTemplates
      .map((t) => ({
        ...t,
        aiScore: getAiMatchScore(t),
      }))
      .sort((a, b) => b.aiScore - a.aiScore);
  }, [relevantTemplates]);

  const filteredTemplates = useMemo(() => {
    if (!searchQuery.trim()) return templatesWithScores;
    const query = searchQuery.toLowerCase();
    return templatesWithScores.filter(
      (t) =>
        t.name.toLowerCase().includes(query) ||
        t.description?.toLowerCase().includes(query)
    );
  }, [templatesWithScores, searchQuery]);

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  const canComplete =
    selectionMode === 'ai' ||
    selectionMode === 'custom' ||
    (selectionMode === 'templates' && selectedTemplateId);

  const SelectionIndicator = ({ selected }: { selected: boolean }) => (
    <div
      className={cn(
        'flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors shrink-0',
        selected ? 'border-primary bg-primary' : 'border-muted-foreground/30'
      )}
    >
      {selected && (
        <svg
          className="h-3 w-3 text-primary-foreground"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </div>
  );

  const getScoreColor = (score: number) => {
    if (score >= 85) return 'text-success bg-success/10 border-success/20';
    if (score >= 70) return 'text-primary bg-primary/10 border-primary/20';
    return 'text-muted-foreground bg-muted border-muted';
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Choose how to format the quote output.
      </p>

      {/* Option 1: Select from Templates with AI Matching */}
      <div
        onClick={() => {
          setSelectionMode('templates');
          onTemplateChange(null);
        }}
        className={cn(
          'rounded-lg border-2 p-4 cursor-pointer transition-all',
          selectionMode === 'templates'
            ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
            : 'border-border hover:border-muted-foreground/50'
        )}
      >
        <div className="flex items-start gap-4">
          <SelectionIndicator selected={selectionMode === 'templates'} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <FileCode2 className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Templates with AI Matching</span>
              <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">
                <Sparkles className="mr-1 h-3 w-3" />
                Recommended
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground pl-6 mb-3">
              Select from existing templates ranked by AI compatibility
            </p>

            {selectionMode === 'templates' && (
              <div className="pl-6 space-y-3" onClick={(e) => e.stopPropagation()}>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search templates..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 h-9"
                  />
                </div>

                <ScrollArea className="h-56 rounded-md border bg-background">
                  <div className="p-1">
                    {filteredTemplates.length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        {relevantTemplates.length === 0
                          ? 'No templates available for this quote type'
                          : 'No templates match your search'}
                      </p>
                    ) : (
                      filteredTemplates.map((template) => (
                        <button
                          key={template.id}
                          onClick={() => onTemplateChange(template.id)}
                          className={cn(
                            'w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                            selectedTemplateId === template.id
                              ? 'bg-primary text-primary-foreground'
                              : 'hover:bg-muted'
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-medium">
                                {template.name}
                              </p>
                              <Badge
                                variant="outline"
                                className={cn(
                                  'text-xs shrink-0',
                                  selectedTemplateId === template.id
                                    ? 'border-primary-foreground/30 text-primary-foreground'
                                    : 'capitalize'
                                )}
                              >
                                {template.audience}
                              </Badge>
                            </div>
                            {template.description && (
                              <p
                                className={cn(
                                  'truncate text-xs mt-0.5',
                                  selectedTemplateId === template.id
                                    ? 'text-primary-foreground/70'
                                    : 'text-muted-foreground'
                                )}
                              >
                                {template.description}
                              </p>
                            )}
                          </div>
                          <Badge
                            variant="outline"
                            className={cn(
                              'shrink-0 text-xs font-medium',
                              selectedTemplateId === template.id
                                ? 'border-primary-foreground/30 text-primary-foreground'
                                : getScoreColor(template.aiScore)
                            )}
                          >
                            <Sparkles className="mr-1 h-3 w-3" />
                            {template.aiScore}%
                          </Badge>
                        </button>
                      ))
                    )}
                  </div>
                </ScrollArea>

                {selectedTemplate && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" />
                    Selected: {selectedTemplate.name}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Option 2: AI Suggestion */}
      <div
        onClick={() => {
          setSelectionMode('ai');
          onTemplateChange(null);
        }}
        className={cn(
          'rounded-lg border-2 p-4 cursor-pointer transition-all',
          selectionMode === 'ai'
            ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
            : 'border-border hover:border-muted-foreground/50'
        )}
      >
        <div className="flex items-center gap-4">
          <SelectionIndicator selected={selectionMode === 'ai'} />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">AI Suggestion</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground pl-6">
              Let AI automatically determine the best format based on the estimate
            </p>
          </div>
        </div>
      </div>

      {/* Option 3: Custom */}
      <div
        onClick={() => {
          setSelectionMode('custom');
          onTemplateChange(null);
        }}
        className={cn(
          'rounded-lg border-2 p-4 cursor-pointer transition-all',
          selectionMode === 'custom'
            ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
            : 'border-border hover:border-muted-foreground/50'
        )}
      >
        <div className="flex items-center gap-4">
          <SelectionIndicator selected={selectionMode === 'custom'} />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <PenTool className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Custom</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground pl-6">
              Manually configure fields and layout in the quote builder
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t pt-4">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button onClick={onComplete} disabled={!canComplete}>
          Create Quote
        </Button>
      </div>
    </div>
  );
}
