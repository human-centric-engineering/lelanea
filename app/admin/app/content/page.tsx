import type { Metadata } from 'next';
import Link from 'next/link';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CONTENT_COLLECTIONS, contentAdminPage } from '@/lib/app/content/admin/endpoint';
import { COLLECTION_COPY } from '@/components/app/admin/content/copy';

export const metadata: Metadata = {
  title: 'Content',
  description: 'The documents, the journey, the discovery questions and the resources',
};

/**
 * The content section's landing page (f-content-seeds t-91): one table, a
 * heading row per collection and a row per area inside it. Everything here is
 * stored in the database and edited without a deploy; `content/` only seeded
 * it.
 */
export default function ContentAdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Content</h2>
        <p className="text-muted-foreground max-w-3xl text-sm">
          The words every page, email and client reads. An edit here is live on the next request.
          Each collection can be exported in the shape its seed file has, and a file brought back
          with a preview first.
        </p>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-1/3">Area</TableHead>
              <TableHead>What it holds</TableHead>
            </TableRow>
          </TableHeader>
          {CONTENT_COLLECTIONS.map((collection) => {
            const copy = COLLECTION_COPY[collection];
            return (
              <TableBody key={collection}>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableCell className="font-medium">
                    <Link href={contentAdminPage(collection)} className="hover:underline">
                      {copy.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-normal">
                    {copy.description}
                  </TableCell>
                </TableRow>
                {copy.areas.map((area) => (
                  <TableRow key={area.name}>
                    <TableCell className="pl-8">{area.name}</TableCell>
                    <TableCell className="text-muted-foreground whitespace-normal">
                      {area.description}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            );
          })}
        </Table>
      </div>
    </div>
  );
}
