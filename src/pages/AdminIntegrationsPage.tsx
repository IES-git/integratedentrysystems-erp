import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ExternalLink, CheckCircle2, XCircle } from 'lucide-react';

export default function AdminIntegrationsPage() {
  return (
    <div className="p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="font-display text-4xl tracking-wide">Integrations</h1>
        <p className="mt-1 text-muted-foreground">
          Connect external services to extend functionality
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#2CA01C]/10">
                  <span className="text-xl font-bold text-[#2CA01C]">QB</span>
                </div>
                <div>
                  <CardTitle>QuickBooks</CardTitle>
                  <CardDescription>Accounting & invoicing sync</CardDescription>
                </div>
              </div>
              <Badge variant="secondary" className="flex items-center gap-1">
                <XCircle className="h-3 w-3" />
                Not Connected
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              Sync orders and invoices with QuickBooks for seamless accounting.
              Automatically create invoices when orders are completed.
            </p>
            <div className="flex items-center justify-between">
              <Button>
                Connect QuickBooks
                <ExternalLink className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                  <span className="text-xl font-bold text-primary">OCR</span>
                </div>
                <div>
                  <CardTitle>PDF Parser</CardTitle>
                  <CardDescription>Ceco estimate extraction</CardDescription>
                </div>
              </div>
              <Badge variant="outline" className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-success" />
                Active
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              Built-in OCR engine for parsing Ceco PDF estimates. Extracts
              field/value pairs and canonical codes automatically.
            </p>
            <div className="flex items-center gap-3">
              <div className="flex items-center space-x-2">
                <Switch id="ocr-active" defaultChecked />
                <Label htmlFor="ocr-active">Enabled</Label>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent/10">
                  <span className="text-xl font-bold text-accent">AI</span>
                </div>
                <div>
                  <CardTitle>AI Layout Engine</CardTitle>
                  <CardDescription>Smart document arrangement</CardDescription>
                </div>
              </div>
              <Badge variant="outline" className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-success" />
                Active
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              AI-powered layout suggestions for quote documents. Automatically
              groups and orders fields based on context and best practices.
            </p>
            <div className="flex items-center gap-3">
              <div className="flex items-center space-x-2">
                <Switch id="ai-active" defaultChecked />
                <Label htmlFor="ai-active">Enabled</Label>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
                  <span className="text-xl font-bold text-muted-foreground">✉️</span>
                </div>
                <div>
                  <CardTitle>Email Service</CardTitle>
                  <CardDescription>Quote delivery & notifications</CardDescription>
                </div>
              </div>
              <Badge variant="secondary" className="flex items-center gap-1">
                <XCircle className="h-3 w-3" />
                Not Configured
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              Configure email service for sending quotes to customers and
              receiving notifications on quote status changes.
            </p>
            <Button variant="outline">Configure Email</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
