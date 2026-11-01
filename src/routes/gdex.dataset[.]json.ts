import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /gdex/dataset.json: the dataset in the words the GDEX submission form asks for, plus the
 * vocabulary (standard names and units) every variable in a release uses.
 */
export const Route = createFileRoute("/gdex/dataset.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getSettings, SUBMIT_URL } = await import("@/lib/gdex/gdex.server");
        const { cfCatalog } = await import("@/lib/gdex/cf");
        const s = await getSettings();
        const origin = new URL(request.url).origin;
        return Response.json(
          {
            schema: "openiotwx-gdex-dataset/1",
            title: s.title,
            abstract: s.summary,
            keywords: s.keywords,
            license: s.license,
            institution: s.institution,
            creator: { name: s.creatorName, email: s.creatorEmail, url: s.creatorUrl },
            contact: { name: s.contactName, email: s.contactEmail },
            update_frequency: s.cadence,
            data_format: "NetCDF (CF-1.8, ACDD-1.3); CSV copies; JSON metadata",
            data_location: `${origin}/gdex/manifest.json`,
            submission_form: SUBMIT_URL,
            conventions: {
              cf: "https://cfconventions.org/",
              time: "seconds since 1970-01-01 00:00:00 UTC (numeric)",
              coordinates: `latitude and longitude on every station, rounded to ${s.coordinateDecimals} decimals`,
            },
            variable_catalog: cfCatalog(),
          },
          { headers: { "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" } },
        );
      },
    },
  },
});
