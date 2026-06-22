import {
  AlertTriangle,
  BookOpen,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  DollarSign,
  Factory,
  FileCheck,
  FileCode2,
  FileText,
  HelpCircle,
  Layers,
  LockKeyhole,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Table2,
  Upload,
  Users,
  Wrench,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type GuideSectionId =
  | 'start'
  | 'roles'
  | 'workflow'
  | 'app-map'
  | 'customers'
  | 'markup'
  | 'manufacturers'
  | 'estimates'
  | 'quotes'
  | 'pricing'
  | 'templates'
  | 'admin-users'
  | 'go-live';

interface NavSection {
  id: GuideSectionId;
  title: string;
  description: string;
  icon: typeof HelpCircle;
}

interface StepItem {
  title: string;
  body: string;
}

interface DefinitionItem {
  term: string;
  definition: string;
}

const sections: NavSection[] = [
  { id: 'start', title: 'Start Here', description: 'Login, orientation, and daily rhythm', icon: BookOpen },
  { id: 'roles', title: 'Access & Roles', description: 'Who can see and change what', icon: ShieldCheck },
  { id: 'workflow', title: 'Core Workflow', description: 'Estimate to quote operating path', icon: ClipboardList },
  { id: 'app-map', title: 'App Map', description: 'What each module is used for', icon: Layers },
  { id: 'customers', title: 'Customers', description: 'Accounts, contacts, and settings', icon: Users },
  { id: 'markup', title: 'Markup', description: 'Default and targeted multipliers', icon: SlidersHorizontal },
  { id: 'manufacturers', title: 'Manufacturers', description: 'Supplier records for pricing', icon: Factory },
  { id: 'estimates', title: 'Estimates', description: 'Build, reuse, review, and price openings', icon: FileText },
  { id: 'quotes', title: 'Quotes', description: 'Create, edit, preview, and send quotes', icon: FileCheck },
  { id: 'pricing', title: 'Pricing', description: 'Tables, price books, QA, and defaults', icon: DollarSign },
  { id: 'templates', title: 'Templates', description: 'Reusable quote document layouts', icon: FileCode2 },
  { id: 'admin-users', title: 'Users', description: 'Invitations and user management', icon: LockKeyhole },
  { id: 'go-live', title: 'Go-Live SOP', description: 'Training checklist for new employees', icon: ClipboardCheck },
];

const appMap: DefinitionItem[] = [
  {
    term: 'Dashboard',
    definition:
      'Role-aware overview of recent work, quick actions, and high-level counts for sales, operations, or admin users.',
  },
  {
    term: 'Customers',
    definition:
      'Customer company records, contacts, billing and shipping addresses, payment terms, and account-level markup settings.',
  },
  {
    term: 'Manufacturers',
    definition:
      'Supplier records used by estimates, pricing tables, and manufacturer RFQs. Keep this list clean before loading price books.',
  },
  {
    term: 'Estimates',
    definition:
      'The working area for uploaded estimates, manual estimates, openings, spec-built configurations, pricing review, and estimate totals.',
  },
  {
    term: 'Quotes',
    definition:
      'Customer quote and manufacturer RFQ creation, editing, PDF preview/download, email sending, and quote status tracking.',
  },
  {
    term: 'Templates',
    definition:
      'Reusable document layout defaults for customer quotes and manufacturer RFQs, including blocks, detail levels, copy, and visible lines.',
  },
  {
    term: 'Pricing',
    definition:
      'Admin and operations workspace for pricing tables, price book ingestion, price book QA, rule data, pricing defaults, freight, tax, and service scopes.',
  },
  {
    term: 'User Management',
    definition:
      'Admin-only area for inviting users, assigning roles, activating or deactivating access, and removing users.',
  },
  {
    term: 'Orders',
    definition:
      'Order tracking exists as an app route for approved and converted quotes. It may be hidden from the sidebar depending on rollout phase.',
  },
];

const roleRows: DefinitionItem[] = [
  {
    term: 'Sales',
    definition:
      'Core commercial workflow access: dashboard, customers, manufacturers, estimates, quotes, and templates. Sales users do not manage pricing defaults or user invitations.',
  },
  {
    term: 'Operations',
    definition:
      'Sales workflow access plus pricing operations such as pricing tables, price book ingestion, price book QA, and related operational setup. Operations users do not manage admin users or admin-only pricing defaults.',
  },
  {
    term: 'Admin',
    definition:
      'Full access, including user management, pricing defaults, pricing operations, and all standard sales workflows.',
  },
];

const pricingDefinitions: DefinitionItem[] = [
  {
    term: 'Pricing table',
    definition:
      'The base matrix or adder table used to look up cost from manufacturer, category, series, dimensions, and selected spec values.',
  },
  {
    term: 'Customer cost multiplier',
    definition:
      'The default markup multiplier on a customer account. A multiplier of 1.25 means the customer price is 25 percent above cost.',
  },
  {
    term: 'Bulk markup override',
    definition:
      'A targeted customer multiplier for a category, subcategory, or item. Blank override cells inherit the customer default multiplier.',
  },
  {
    term: 'Pricing defaults',
    definition:
      'Admin-managed defaults for hardware sell rules plus services, freight, packaging, tax, labor, wiring, glazing, commissioning, and field work.',
  },
  {
    term: 'Gross margin target',
    definition:
      'An alternate target used in pricing defaults when the business wants a rule to price toward a desired margin instead of a simple multiplier.',
  },
  {
    term: 'Manual quote',
    definition:
      'A price exception state used when the system cannot safely price a line automatically, such as contact-factory items, missing prices, or unresolved external scope.',
  },
  {
    term: 'Estimate adjustment',
    definition:
      'A final percentage markup or discount applied in Review & Pricing to the estimate sell total before saving.',
  },
  {
    term: 'Manufacturer RFQ',
    definition:
      'A supplier-facing request that emphasizes product details and cost/request information. It is not the customer-facing quote.',
  },
];

function PageSection({
  id,
  title,
  eyebrow,
  icon: Icon,
  children,
}: {
  id: GuideSectionId;
  title: string;
  eyebrow: string;
  icon: typeof HelpCircle;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 rounded-lg border bg-card shadow-sm">
      <div className="border-b px-5 py-4 sm:px-6">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-md bg-primary/10 p-2 text-primary">
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {eyebrow}
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-normal">{title}</h2>
          </div>
        </div>
      </div>
      <div className="space-y-5 px-5 py-5 sm:px-6">{children}</div>
    </section>
  );
}

function StepList({ items }: { items: StepItem[] }) {
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={item.title} className="grid gap-3 rounded-md border bg-background p-4 sm:grid-cols-[36px_1fr]">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            {index + 1}
          </div>
          <div>
            <h3 className="text-base font-semibold tracking-normal">{item.title}</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function DefinitionTable({ items }: { items: DefinitionItem[] }) {
  return (
    <div className="overflow-hidden rounded-md border">
      {items.map((item, index) => (
        <div
          key={item.term}
          className={`grid gap-2 px-4 py-3 text-sm md:grid-cols-[220px_1fr] ${
            index % 2 === 0 ? 'bg-background' : 'bg-muted/25'
          }`}
        >
          <div className="font-semibold text-foreground">{item.term}</div>
          <div className="leading-6 text-muted-foreground">{item.definition}</div>
        </div>
      ))}
    </div>
  );
}

function Checklist({ items }: { items: string[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item} className="flex items-start gap-2 rounded-md border bg-background px-3 py-2 text-sm">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <span className="leading-5 text-muted-foreground">{item}</span>
        </div>
      ))}
    </div>
  );
}

function Callout({
  title,
  children,
  tone = 'info',
}: {
  title: string;
  children: React.ReactNode;
  tone?: 'info' | 'warning' | 'success';
}) {
  const toneClass =
    tone === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-900 dark:bg-amber-950/20 dark:text-amber-200'
      : tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200'
      : 'border-primary/20 bg-primary/5 text-foreground';
  const Icon = tone === 'warning' ? AlertTriangle : tone === 'success' ? CheckCircle2 : HelpCircle;

  return (
    <div className={`rounded-md border px-4 py-3 ${toneClass}`}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <div className="mt-1 text-sm leading-6 text-muted-foreground">{children}</div>
        </div>
      </div>
    </div>
  );
}

function MiniGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>;
}

function MiniCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof HelpCircle;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-md border bg-background p-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="rounded-md bg-primary/10 p-2 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <h3 className="text-base font-semibold tracking-normal">{title}</h3>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}

export default function HelpGuidePage() {
  return (
    <div className="min-h-full p-4 sm:p-6 lg:p-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <div className="rounded-lg border bg-card px-5 py-5 shadow-sm sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                  SOP
                </Badge>
                <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                  User Training
                </Badge>
                <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                  Go-Live
                </Badge>
              </div>
              <h1 className="font-display text-3xl tracking-wide sm:text-4xl">IES App Help Guide</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground sm:text-base">
                A practical operating manual for using the app day to day: customer setup, markup,
                manufacturers, estimate creation, quote preparation, pricing administration, and user access.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <a href="#workflow">
                  <ClipboardList className="h-4 w-4" />
                  Start Workflow
                </a>
              </Button>
              <Button asChild size="sm">
                <a href="#go-live">
                  <ClipboardCheck className="h-4 w-4" />
                  Training SOP
                </a>
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[290px_minmax(0,1fr)]">
          <aside className="xl:sticky xl:top-6 xl:self-start">
            <Card>
              <CardContent className="p-3">
                <div className="mb-2 flex items-center gap-2 px-2 py-1.5 text-sm font-semibold">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  Guide Navigation
                </div>
                <nav className="space-y-1">
                  {sections.map((section) => {
                    const Icon = section.icon;
                    return (
                      <a
                        key={section.id}
                        href={`#${section.id}`}
                        className="group flex items-start gap-2 rounded-md px-2 py-2 text-sm transition-colors hover:bg-primary/10 hover:text-primary"
                      >
                        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
                        <span>
                          <span className="block font-medium leading-5">{section.title}</span>
                          <span className="block text-xs leading-4 text-muted-foreground">
                            {section.description}
                          </span>
                        </span>
                      </a>
                    );
                  })}
                </nav>
              </CardContent>
            </Card>
          </aside>

          <main className="space-y-6">
            <PageSection id="start" eyebrow="Orientation" title="Start Here" icon={BookOpen}>
              <p className="text-sm leading-6 text-muted-foreground">
                The app is designed around a single commercial path: set up accurate master data,
                create and price estimates, convert approved estimates into polished quotes, then manage
                the commercial record through quote status and downstream order activity.
              </p>
              <StepList
                items={[
                  {
                    title: 'Sign in',
                    body:
                      'Go to the login page, enter your email and password, then select Sign In. Access is by invitation only, so a new user must be invited by an admin before logging in.',
                  },
                  {
                    title: 'Accept an invitation',
                    body:
                      'Open the invitation email, follow the accept-invite link, create a password with at least 8 characters, then continue into the app.',
                  },
                  {
                    title: 'Use the left navigation',
                    body:
                      'The sidebar is the main map of the app. Standard users see core workflow areas, while ops and admins see additional pricing or user management tools.',
                  },
                  {
                    title: 'Use the user menu',
                    body:
                      'Select your initials at the bottom of the sidebar to change theme, confirm your role, or log out. The sidebar can also collapse for more workspace.',
                  },
                ]}
              />
            </PageSection>

            <PageSection id="roles" eyebrow="Security" title="User Access and Roles" icon={ShieldCheck}>
              <DefinitionTable items={roleRows} />
              <Callout title="Role guard behavior">
                If a user opens a restricted URL directly and their role does not allow it, the app redirects
                them back to the dashboard. If a menu item is missing, check the user's assigned role first.
              </Callout>
            </PageSection>

            <PageSection id="workflow" eyebrow="Recommended Workflow" title="Estimate to Quote SOP" icon={ClipboardList}>
              <StepList
                items={[
                  {
                    title: 'Confirm setup before quoting',
                    body:
                      'Make sure the customer exists, the manufacturer exists, customer markup is correct, and pricing tables or price books are current. Bad setup creates avoidable quote corrections later.',
                  },
                  {
                    title: 'Create or upload the estimate',
                    body:
                      'Use Estimates > Create New for a manual estimate, or Upload New to process a PDF or image through extraction. Uploaded estimates should always be reviewed against the source document.',
                  },
                  {
                    title: 'Assign the customer',
                    body:
                      'Use the extracted customer, select an existing customer, create a new customer inline, or proceed with no customer if the estimate is not yet assigned.',
                  },
                  {
                    title: 'Build or reuse openings',
                    body:
                      'Use Build Opening to create a new spec-driven opening, or Choose Existing Opening to copy a past opening into the current estimate. Review quantities after copying.',
                  },
                  {
                    title: 'Review pricing',
                    body:
                      'Use Review & Pricing to refresh prices, resolve warnings, inspect the auditable quote, enter manual overrides only when needed, and apply any final estimate adjustment.',
                  },
                  {
                    title: 'Create the quote',
                    body:
                      'From the Estimates list, choose Customer Quote, Manufacturer Quote, or Multiple Quotes. Confirm recipients, template or layout mode, and create the quote builder draft.',
                  },
                  {
                    title: 'Preview, save, and send',
                    body:
                      'Refresh from pricing tables in the quote builder, review markup, confirm the PDF preview, save the quote, then send or download the appropriate customer quote and manufacturer RFQ.',
                  },
                ]}
              />
              <Checklist
                items={[
                  'Do not quote from an estimate with unresolved blocking pricing exceptions unless the business intentionally accepts a manual quote path.',
                  'Refresh pricing before saving the quote if pricing tables have changed since the estimate was created.',
                  'Use customer quote PDFs for customer distribution and manufacturer RFQs for supplier communication.',
                  'Save the quote after presentation changes so the layout, copy, and line visibility are preserved.',
                ]}
              />
            </PageSection>

            <PageSection id="app-map" eyebrow="Navigation" title="Different Functionalities Within the App" icon={Layers}>
              <DefinitionTable items={appMap} />
            </PageSection>

            <PageSection id="customers" eyebrow="CRM" title="Adding and Managing Customers" icon={Users}>
              <StepList
                items={[
                  {
                    title: 'Open Customers',
                    body:
                      'Select Customers in the sidebar. Use the search field to check whether the company already exists before creating a duplicate.',
                  },
                  {
                    title: 'Add a new customer',
                    body:
                      'Select Add > New Customer. Enter the company name, billing address, shipping address, and any notes. Company name is required.',
                  },
                  {
                    title: 'Add the primary contact',
                    body:
                      'When creating a customer, keep Add a primary contact enabled if you have the contact name. Enter first name, last name, email, phone, and title. First and last name are required when adding a primary contact.',
                  },
                  {
                    title: 'Open the customer detail page',
                    body:
                      'Click the customer row to view details. From there you can edit company information, add or edit contacts, mark a contact as primary, and manage account settings.',
                  },
                  {
                    title: 'Maintain active status',
                    body:
                      'Use Edit Company to make a customer inactive if they should remain in history but should no longer be used for new work.',
                  },
                ]}
              />
              <Callout title="Customer deletion warning" tone="warning">
                Deleting a customer removes its contacts and can unset customer references on related records.
                Prefer marking a company inactive when preserving history matters.
              </Callout>
            </PageSection>

            <PageSection id="markup" eyebrow="Pricing Control" title="Adjusting Markup" icon={SlidersHorizontal}>
              <MiniGrid>
                <MiniCard
                  icon={Building2}
                  title="Single customer default"
                  body="Open a customer detail page, find Account Settings, update Cost Multiplier, and save settings. This default applies to all quote line items for that company unless an override applies."
                />
                <MiniCard
                  icon={Table2}
                  title="Bulk markup manager"
                  body="Open Customers, select Bulk Markup, and edit default multipliers across many customers in one table."
                />
                <MiniCard
                  icon={SlidersHorizontal}
                  title="Targeted overrides"
                  body="In Bulk Markup, add category, subcategory, or item columns. Enter a multiplier only where that target should override the customer's default."
                />
              </MiniGrid>
              <DefinitionTable
                items={[
                  { term: '1.00', definition: 'No markup. Customer price equals the underlying cost.' },
                  { term: '1.25', definition: '25 percent markup over cost.' },
                  { term: '1.50', definition: '50 percent markup over cost.' },
                  { term: '2.00', definition: '100 percent markup over cost. The sell price is double cost.' },
                  {
                    term: 'Blank override cell',
                    definition: 'No override. The item inherits the customer default multiplier.',
                  },
                ]}
              />
              <Checklist
                items={[
                  'Change customer defaults for broad account-level pricing strategy.',
                  'Use category overrides when a whole product family needs different margin.',
                  'Use item overrides sparingly for specific known exceptions.',
                  'Review quote line multipliers before saving if the customer has special markup rules.',
                ]}
              />
            </PageSection>

            <PageSection id="manufacturers" eyebrow="Master Data" title="Adding Manufacturers" icon={Factory}>
              <StepList
                items={[
                  {
                    title: 'Open Manufacturers',
                    body:
                      'Select Manufacturers in the sidebar. This page lists supplier companies used by estimates, price books, pricing tables, and RFQs.',
                  },
                  {
                    title: 'Select Add Manufacturer',
                    body:
                      'Enter the company name, address, and notes. Use notes for preferred product lines, lead-time notes, rep contact context, or source book details.',
                  },
                  {
                    title: 'Use manufacturers consistently',
                    body:
                      'Before ingesting a price book or assigning a table vendor, make sure the manufacturer record uses the same name the team expects to see in quotes and pricing filters.',
                  },
                ]}
              />
              <Callout title="Manufacturer deletion warning" tone="warning">
                Deleting a manufacturer also removes contacts and unassigns linked estimate items. Use this only for true duplicates or bad records.
              </Callout>
            </PageSection>

            <PageSection id="estimates" eyebrow="CPQ Workflow" title="Creating Estimates With Build, Open, and Spec Builder" icon={FileText}>
              <MiniGrid>
                <MiniCard
                  icon={Upload}
                  title="Upload New"
                  body="Drag a PDF or image into the upload modal. The app uploads the file, processes it, extracts items and customer data, then opens the review wizard."
                />
                <MiniCard
                  icon={ClipboardList}
                  title="Create New"
                  body="Start a manual estimate. Pick a customer, add openings, review pricing, and save the completed estimate."
                />
                <MiniCard
                  icon={Layers}
                  title="Build Opening"
                  body="Launches the current spec-driven opening builder for a new door, frame, hardware, lite, panel, and construction configuration."
                />
                <MiniCard
                  icon={FileText}
                  title="Choose Existing Opening"
                  body="Search and copy a past opening into the current estimate. This is the fastest path for repeated opening types."
                />
                <MiniCard
                  icon={Wrench}
                  title="Spec Builder"
                  body="Guided builder for Opening, Door construction, Frame and wall, Hardware, Panels, Lites/Glass, Glass/Louvers, Preparations, Keying, Access Control, Construction, and Review."
                />
                <MiniCard
                  icon={RefreshCw}
                  title="Review & Pricing"
                  body="Refresh prices, inspect exceptions, compare vendors, override individual sell prices when needed, add estimate notes, and save the final estimate total."
                />
              </MiniGrid>
              <StepList
                items={[
                  {
                    title: 'Create or upload',
                    body:
                      'From Estimates, select Create New for manual entry or Upload New for PDF/image extraction. Uploaded files support PDF, JPG, PNG, and GIF.',
                  },
                  {
                    title: 'Confirm the customer',
                    body:
                      'Use Extracted Customer when OCR finds a reliable match, Select Existing Customer for known accounts, Create New Customer for new accounts, or No Customer when assignment will happen later.',
                  },
                  {
                    title: 'Build or copy openings',
                    body:
                      'Use Build Opening for a new spec and Choose Existing Opening for a reusable past opening. After copying, confirm quantity and edit any details that changed.',
                  },
                  {
                    title: 'Complete the spec builder',
                    body:
                      'Move through each visible builder step. The builder auto-generates hardware requirements from the opening context and validates dependencies before save.',
                  },
                  {
                    title: 'Resolve pricing exceptions',
                    body:
                      'On Review & Pricing, use Refresh Prices and read exception panels. Blocking configuration errors must be fixed before saving. Some unresolved pricing can be acknowledged for manual quote handling.',
                  },
                  {
                    title: 'Apply estimate-level adjustments',
                    body:
                      'Use Markup / Discount (%) for final sell total adjustments. Positive numbers increase the sell total; negative numbers discount the sell total.',
                  },
                ]}
              />
              <Checklist
                items={[
                  'Use Remix from the estimate list when an existing estimate is close to the new job.',
                  'Use Review Source Items for uploaded estimates when extracted items need to be corrected against the source document.',
                  'Use Edit Estimate when opening specs or customer assignment need to change.',
                  'Use Review Pricing when pricing should be refreshed or manually checked before quote creation.',
                ]}
              />
            </PageSection>

            <PageSection id="quotes" eyebrow="Commercial Output" title="Best Practices for Quotes From Estimates" icon={FileCheck}>
              <StepList
                items={[
                  {
                    title: 'Start from a completed estimate',
                    body:
                      'From Estimates, select Quote and choose Customer Quote, Manufacturer Quote, or Multiple Quotes. A quote should start only after the estimate has been reviewed and priced.',
                  },
                  {
                    title: 'Use previous quote details when helpful',
                    body:
                      'The quote wizard shows previous quotes for the same estimate. Select one to reuse known details, or skip it to start fresh.',
                  },
                  {
                    title: 'Confirm recipients',
                    body:
                      'Use the estimate customer when correct, or select different recipients. You can create a new customer or manufacturer inline if needed.',
                  },
                  {
                    title: 'Choose the output approach',
                    body:
                      'Select a template with AI matching, choose AI Suggestion, or choose Custom to manually configure the layout in the quote builder.',
                  },
                  {
                    title: 'Refresh pricing in the builder',
                    body:
                      'Use Refresh from Pricing Tables before saving when table data may have changed. This protects against quoting stale table values.',
                  },
                  {
                    title: 'Review markup and line totals',
                    body:
                      'For customer quotes, review the markup banner, per-line multipliers, cost subtotal, markup amount, and total. Adjust multipliers only when the business case is clear.',
                  },
                  {
                    title: 'Set document presentation',
                    body:
                      'Use Document Layout to enable or disable blocks, choose summary/standard/detailed line detail, edit overview/scope/terms/custom copy, and hide or rename visible lines.',
                  },
                  {
                    title: 'Preview before distribution',
                    body:
                      'Use the eye button to preview the customer quote or manufacturer RFQ. Download the PDF only after confirming pricing, copy, and line display are correct.',
                  },
                  {
                    title: 'Save the quote',
                    body:
                      'Select Save Quote or Update Quote. Saving preserves line prices, markup, notes, document layout, and generated copy.',
                  },
                ]}
              />
              <Callout title="Customer quote vs manufacturer RFQ" tone="warning">
                Customer Quote is the customer-facing commercial document. Manufacturer RFQ is supplier-facing and should be treated as internal/supplier communication, not customer distribution.
              </Callout>
              <Checklist
                items={[
                  'Confirm the quote type before saving: customer, manufacturer, or both.',
                  'Use quote notes for special instructions and internal context that should be preserved with the quote.',
                  'Preview PDFs after changing document layout controls.',
                  'After sending, keep quote status current: Draft, Sent, Approved, Rejected, or Converted.',
                ]}
              />
            </PageSection>

            <PageSection id="pricing" eyebrow="Administration" title="Pricing Details" icon={DollarSign}>
              <DefinitionTable items={pricingDefinitions} />
              <MiniGrid>
                <MiniCard
                  icon={Table2}
                  title="Pricing Tables"
                  body="Browse by manufacturer, category, and series. Open table cards to edit manufacturers, base pricing, rows, columns, criteria, cells, and adders."
                />
                <MiniCard
                  icon={Upload}
                  title="Price Book Ingestion"
                  body="Upload source price books, assign manufacturer/category/effective date, extract tables, review grids or compiled rules, approve, and publish through QA controls."
                />
                <MiniCard
                  icon={ClipboardCheck}
                  title="Price Book QA"
                  body="Review blocking issues and warnings. Resolve blocking issues before publishing unless an authorized override is intentionally used."
                />
                <MiniCard
                  icon={Settings}
                  title="Pricing Defaults"
                  body="Admin-only defaults for markup rules and service scopes such as freight, tax, labor, wiring, glazing, packaging, commissioning, and field work."
                />
              </MiniGrid>
              <StepList
                items={[
                  {
                    title: 'Maintain manufacturers first',
                    body:
                      'Price books and pricing tables depend on manufacturer records. Add the manufacturer before uploading or assigning tables.',
                  },
                  {
                    title: 'Use table maintenance for known corrections',
                    body:
                      'In Pricing Tables, search or filter to the relevant manufacturer and series. Edit cells, rows, columns, and adders carefully because these values feed estimate and quote pricing.',
                  },
                  {
                    title: 'Use ingestion for source book updates',
                    body:
                      'In Price Book Ingestion, upload the book, choose manufacturer/category, set effective date and superseded book when applicable, then run extraction and review.',
                  },
                  {
                    title: 'Publish only after QA',
                    body:
                      'Use Price Book QA to check errors, warnings, and coverage. A price book should not become the live source for quoting until blocking issues are resolved or deliberately overridden.',
                  },
                  {
                    title: 'Use defaults for broad pricing policy',
                    body:
                      'Pricing Defaults control sell rules, basis, multipliers, gross margin targets, rounding, customer class, category, priority, and service scope calculations.',
                  },
                ]}
              />
            </PageSection>

            <PageSection id="templates" eyebrow="Documents" title="Templates and Quote Presentation" icon={FileCode2}>
              <StepList
                items={[
                  {
                    title: 'Create a template',
                    body:
                      'Open Templates, select New Template, enter a name, choose Customer or Manufacturer audience, add a description, and create the template.',
                  },
                  {
                    title: 'Edit layout defaults',
                    body:
                      'Open Edit Template to configure document blocks, detail level, visible fields, copy sections, and line display defaults using sample quote lines.',
                  },
                  {
                    title: 'Use templates in quote creation',
                    body:
                      'During Create Quote, templates are ranked for the selected quote type. Choose the best template or use Custom for one-off layout control.',
                  },
                ]}
              />
            </PageSection>

            <PageSection id="admin-users" eyebrow="Administration" title="Inviting New Users as an Admin" icon={LockKeyhole}>
              <StepList
                items={[
                  {
                    title: 'Open User Management',
                    body:
                      'Admins can open Admin > Users from the sidebar. Operations and sales users do not have access to this page.',
                  },
                  {
                    title: 'Select Invite User',
                    body:
                      'Enter first name, last name, email, optional job title, and role. Role choices are Sales, Operations, and Admin.',
                  },
                  {
                    title: 'Send the invite',
                    body:
                      'Select Send Invite. The app sends an invitation email and creates the user profile. The user sets their own password from the invite link.',
                  },
                  {
                    title: 'Manage access after invite',
                    body:
                      'Use the active switch to deactivate or reactivate a user. Use the row action menu to change roles or delete a user. You cannot deactivate or delete your own current account from the table.',
                  },
                ]}
              />
              <Callout title="Recommended access practice" tone="success">
                Start most new team members as Sales unless they are responsible for pricing operations or administration.
                Promote to Operations or Admin only when the workflow requires it.
              </Callout>
            </PageSection>

            <PageSection id="go-live" eyebrow="Training" title="Go-Live SOP for New Employees" icon={ClipboardCheck}>
              <Checklist
                items={[
                  'User has accepted invite, created password, and logged in successfully.',
                  'User knows their assigned role and which menu items they should see.',
                  'User can add a customer and contact without creating duplicates.',
                  'User can explain the difference between customer markup, pricing tables, and pricing defaults.',
                  'User can add a manufacturer before using it in pricing or RFQ workflows.',
                  'User can create a manual estimate and build an opening with the spec builder.',
                  'User can copy an existing opening and verify quantity/spec differences.',
                  'User can upload a PDF/image estimate and review extracted source items.',
                  'User can refresh prices, resolve exceptions, and save an estimate.',
                  'User can create a customer quote and manufacturer RFQ from an estimate.',
                  'User can edit quote markup, notes, document layout, and line visibility.',
                  'User can preview and download the correct PDF before sending.',
                  'Admin user can invite, deactivate, and update roles for users.',
                ]}
              />
              <Callout title="Training recommendation">
                For hands-on onboarding, have the new employee complete one practice customer,
                one practice manufacturer, one practice estimate with a copied opening, one estimate
                built from scratch, and one customer quote PDF preview before working on live jobs.
              </Callout>
            </PageSection>
          </main>
        </div>
      </div>
    </div>
  );
}
