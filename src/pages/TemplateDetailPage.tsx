import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileCode2, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { QuotePresentationControls } from '@/components/quotes/QuotePresentationControls';
import { useToast } from '@/hooks/use-toast';
import { getTemplate, updateTemplate } from '@/lib/templates-api';
import {
  createDefaultQuoteDisplayConfig,
  normalizeAudienceDisplayConfig,
  parseAudienceDisplayConfig,
  serializeAudienceDisplayConfig,
  type QuotePresentationLineOption,
} from '@/lib/quote-display';
import type { QuoteDisplayConfig, Template } from '@/types';

const SAMPLE_LINES: QuotePresentationLineOption[] = [
  {
    displayKey: 'sample:door-frame',
    label: 'Opening 101 - door, frame, and preparations',
    canonicalCode: 'HM-OPENING',
    quantity: 1,
    unitCost: 920,
    unitPrice: 1380,
    lineTotal: 1380,
  },
  {
    displayKey: 'sample:hardware',
    label: 'Hardware set - hinges, lockset, closer, seals',
    canonicalCode: 'HW-SET',
    quantity: 1,
    unitCost: 615,
    unitPrice: 922.5,
    lineTotal: 922.5,
  },
  {
    displayKey: 'sample:glass-lite',
    label: 'Vision lite kit and glazing',
    canonicalCode: 'LITE-KIT',
    quantity: 1,
    unitCost: 180,
    unitPrice: 270,
    lineTotal: 270,
  },
  {
    displayKey: 'sample:freight',
    label: 'Freight and project handling',
    canonicalCode: 'FREIGHT',
    quantity: 1,
    unitCost: 150,
    unitPrice: 225,
    lineTotal: 225,
  },
];

export default function TemplateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [template, setTemplate] = useState<Template | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [displayConfig, setDisplayConfig] = useState<QuoteDisplayConfig>(() =>
    createDefaultQuoteDisplayConfig(null, 'customer'),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    getTemplate(id)
      .then((result) => {
        if (!result) {
          toast({ title: 'Template not found', variant: 'destructive' });
          navigate('/app/templates');
          return;
        }
        setTemplate(result);
        setName(result.name);
        setDescription(result.description);

        const audienceConfig =
          parseAudienceDisplayConfig(result.displayConfigJson, result.audience, result.name) ??
          normalizeAudienceDisplayConfig(
            createDefaultQuoteDisplayConfig(result, result.audience)[result.audience],
            result.audience,
            result.name,
          );
        setDisplayConfig({
          ...createDefaultQuoteDisplayConfig(null, 'both'),
          [result.audience]: audienceConfig,
        });
      })
      .catch((err) => {
        toast({
          title: 'Failed to load template',
          description: err instanceof Error ? err.message : undefined,
          variant: 'destructive',
        });
      })
      .finally(() => setIsLoading(false));
  }, [id, navigate, toast]);

  const quoteType = template?.audience ?? 'customer';

  const activeConfig = useMemo(
    () =>
      template
        ? normalizeAudienceDisplayConfig(
            {
              ...displayConfig[template.audience],
              templateName: name.trim() || template.name,
            },
            template.audience,
            name.trim() || template.name,
          )
        : null,
    [displayConfig, name, template],
  );

  const handleSave = async () => {
    if (!template || !activeConfig) return;
    setIsSaving(true);
    try {
      const updated = await updateTemplate(template.id, {
        name: name.trim() || template.name,
        description: description.trim(),
        displayConfigJson: serializeAudienceDisplayConfig(activeConfig),
      });
      setTemplate(updated);
      toast({ title: 'Template saved', description: `${updated.name} is ready for quotes.` });
    } catch (err) {
      toast({
        title: 'Failed to save template',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center py-32">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!template || !activeConfig) return null;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/app/templates')}
            className="mb-4 -ml-2"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Templates
          </Button>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <FileCode2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-2xl sm:text-3xl tracking-wide">
                  Edit Template
                </h1>
                <Badge variant={template.audience === 'customer' ? 'default' : 'secondary'}>
                  {template.audience}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Configure quote blocks, detail, copy, and line display defaults.
              </p>
            </div>
          </div>
        </div>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save Template
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,520px)_minmax(360px,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Template Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="template-name">Name</Label>
              <Input
                id="template-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="template-description">Description</Label>
              <Textarea
                id="template-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Layout Defaults</CardTitle>
          </CardHeader>
          <CardContent>
            <QuotePresentationControls
              value={{
                ...displayConfig,
                [template.audience]: activeConfig,
              }}
              quoteType={quoteType}
              lineOptions={SAMPLE_LINES}
              onChange={setDisplayConfig}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

