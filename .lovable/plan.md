

## Login Page Cleanup

Two small changes to `src/pages/LoginPage.tsx`:

1. **Remove the "IES Internal Portal" title text** -- delete the `CardTitle` element that displays "IES Internal Portal"
2. **Increase logo size** -- change the logo `className` from `h-16` to `h-20` for a slightly larger presence
3. **Keep the subtitle** -- "Sign in to access the ERP + CRM system" remains as the `CardDescription`

### Build Error Fixes (bonus)

The build is currently broken due to missing `firstName`, `lastName`, and `jobTitle` fields on seed user objects. These will also be fixed:

- **`src/lib/storage.ts`** (lines ~386-409): Add `firstName`, `lastName`, and `jobTitle` to the 4 demo user seed objects
- **`src/pages/AdminUsersPage.tsx`** (line ~56): Add the same fields to the "add user" handler

