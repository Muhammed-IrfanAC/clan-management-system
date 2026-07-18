import { redirect } from 'next/navigation';

// The Warnings system has been replaced by Strikes (see src/lib/strikes/*). This route is kept only
// so old bookmarks/links land on the new page instead of 404-ing.
export default function WarningsRedirect() {
  redirect('/dashboard/strikes');
}
