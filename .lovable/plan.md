

## Mobile Responsiveness Update

The core issue is that on mobile screens, the sidebar is hidden (by design in shadcn's sidebar component) but there is no trigger button visible to open it. Additionally, page-level padding, typography, and stat card grids need responsive refinements.

### 1. Add a Mobile Header with Sidebar Trigger

**File: `src/components/layout/AppLayout.tsx`**

Add a sticky top header that only appears on mobile (`md:hidden`). It will contain:
- A `SidebarTrigger` (hamburger icon) on the left to open the sidebar sheet
- The IES logo icon in the center for branding

This is the most critical fix -- without it, mobile users are stuck with no navigation.

### 2. Responsive Page Padding

All main pages currently use `p-6 lg:p-8`. Update to `p-4 sm:p-6 lg:p-8` for tighter padding on small screens. Affected pages:
- `DashboardPage.tsx`
- `EstimatesListPage.tsx`
- `CustomersPage.tsx`
- `ManufacturersPage.tsx`
- `QuotesPage.tsx`
- `OrdersPage.tsx`
- `TemplatesPage.tsx`

### 3. Responsive Typography

Scale down the large `text-4xl` page headings to `text-2xl sm:text-3xl lg:text-4xl` across all pages so they don't dominate small screens.

### 4. Responsive Stat Card Grids

- **Dashboard**: `grid-cols-2 md:grid-cols-2 lg:grid-cols-4` (already partially done, just ensure 2-col on mobile)
- **Quotes page**: `grid-cols-2 md:grid-cols-4` (4 status cards -- stack 2x2 on mobile)
- **Orders page**: `grid-cols-2 sm:grid-cols-3 md:grid-cols-5` (5 status cards -- wrap gracefully)

### 5. Wizard Pages Responsive Refinements

- **EstimateWizardPage**: The header icon container (`h-10 w-10`) and title (`text-3xl`) will scale down on mobile to `h-8 w-8` and `text-xl sm:text-2xl lg:text-3xl`
- **QuoteWizardPage**: Same treatment

### 6. Sidebar Footer on Mobile

The sidebar already renders inside a Sheet on mobile via the shadcn component, so the footer user menu and collapse toggle will work naturally. No changes needed there.

---

### Technical Summary of File Changes

| File | Changes |
|------|---------|
| `src/components/layout/AppLayout.tsx` | Add mobile-only sticky header with `SidebarTrigger` and logo |
| `src/pages/DashboardPage.tsx` | Padding `p-4 sm:p-6 lg:p-8`, heading size responsive |
| `src/pages/EstimatesListPage.tsx` | Padding + heading size |
| `src/pages/CustomersPage.tsx` | Padding + heading size |
| `src/pages/ManufacturersPage.tsx` | Padding + heading size |
| `src/pages/QuotesPage.tsx` | Padding + heading size + stat grid `grid-cols-2` |
| `src/pages/OrdersPage.tsx` | Padding + heading size + stat grid `grid-cols-2 sm:grid-cols-3` |
| `src/pages/TemplatesPage.tsx` | Padding + heading size |
| `src/pages/EstimateWizardPage.tsx` | Responsive header icon + title sizing |
| `src/pages/QuoteWizardPage.tsx` | Responsive header icon + title sizing |

No new dependencies required. All changes use existing Tailwind breakpoint classes.

