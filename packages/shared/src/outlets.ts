/** One row of GET /outlets. */
export interface OutletSummaryDto {
  id: string;
  name: string;
  address: string;
  city: string;
  organization: { id: string; name: string };
}
