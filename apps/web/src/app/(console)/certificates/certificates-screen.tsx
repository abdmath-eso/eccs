"use client";

import { can, type CertificateDto, type CertificateState } from "@eccs/shared";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { Button, Card, ErrorMessage, Field, Loading, ToggleGroup } from "@/components/ui";
import { api } from "@/lib/api";
import { describe, english, longDay as day, matchesSearch } from "@/lib/format";
import { useQuery, useQueryField } from "@/lib/query";
import { useSession } from "@/lib/session";

// The same words and outlines as on the Licences page. Each state has its own
// mark as well as its colour, so the table reads the same in black and white.
const STATE: Record<CertificateState, { label: string; mark: string; style: string }> = {
  VALID: { label: "Valid", mark: "✓", style: "border-primary text-primary" },
  EXPIRING: { label: "Expiring soon", mark: "▲", style: "border-amber-600 text-amber-700" },
  EXPIRED: { label: "Expired", mark: "!", style: "border-danger text-danger" },
};

type Show = "all" | CertificateState;
const SHOWS: readonly Show[] = ["all", "VALID", "EXPIRING", "EXPIRED"];

const countdown = (certificate: CertificateDto) =>
  certificate.daysLeft < 0
    ? `${-certificate.daysLeft} day${certificate.daysLeft === -1 ? "" : "s"} ago`
    : certificate.daysLeft === 0
      ? "last day today"
      : `${certificate.daysLeft} day${certificate.daysLeft === 1 ? "" : "s"} left`;

function StateBadge({ state }: { state: CertificateState }) {
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${STATE[state].style}`}>
      <span aria-hidden>{STATE[state].mark} </span>
      {STATE[state].label}
    </span>
  );
}

/**
 * Certificates: every service certificate ECCS has issued, across all clients,
 * the newest first. One is issued by itself when a report is approved under
 * Visits, for the kinds of service set to carry one in the Catalogue, so
 * nothing is added here by hand. From here a certificate is found, opened as a
 * PDF, and (by Super Admins and Operations Managers) its PDF made again.
 *
 * The search and the filter are kept in the web address as `q=` and `show=`.
 */
export default function CertificatesScreen() {
  const { user } = useSession();
  const notify = useToast();
  const confirm = useConfirm();
  const query = useQuery();
  const [search, setSearch] = useQueryField("q");

  const [certificates, setCertificates] = useState<CertificateDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Which certificate has a PDF being fetched or made, and the one where that went wrong.
  const [busy, setBusy] = useState<{ id: string; doing: "open" | "remake" } | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  // Supervisors can look at the certificates of their own visits; only admins make a PDF again.
  const mayRemake = user ? can(user.memberships, "reports", "approve") : false;
  const asked = query.get("show") as Show;
  const show: Show = SHOWS.includes(asked) ? asked : "all";

  useEffect(() => {
    let cancelled = false;
    api.certificates
      .list()
      .then((list) => {
        if (cancelled) return;
        setCertificates(list);
        setError(null);
      })
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  /** Opens the certificate as a PDF in a new tab. The first time, the server makes it, which takes a few seconds. */
  async function openPdf(certificate: CertificateDto) {
    setBusy({ id: certificate.id, doing: "open" });
    setRowError(null);
    // Opened straight away, while the click still counts, so the browser does not block it as a pop-up.
    const tab = window.open("", "_blank");
    try {
      const { path } = await api.certificates.pdf(certificate.id);
      if (tab) tab.location.href = api.fileUrl(path);
      else window.location.assign(api.fileUrl(path));
      setCertificates((list) => list?.map((entry) => (entry.id === certificate.id ? { ...entry, pdfReady: true } : entry)) ?? null);
    } catch (e) {
      tab?.close();
      setRowError({ id: certificate.id, message: describe(e) });
    } finally {
      setBusy(null);
    }
  }

  async function remakePdf(certificate: CertificateDto) {
    const sure = await confirm({
      title: `Make the PDF of ${certificate.number} again?`,
      body: "A new PDF is made from what is on record now and takes the place of the old one, in the outlet's documents too. The certificate's number and dates stay the same. Copies already downloaded or printed are not changed.",
      confirmLabel: "Make it again",
      cancelLabel: "Keep the PDF as it is",
    });
    if (!sure) return;
    setBusy({ id: certificate.id, doing: "remake" });
    setRowError(null);
    try {
      await api.certificates.remakePdf(certificate.id);
      setCertificates((list) => list?.map((entry) => (entry.id === certificate.id ? { ...entry, pdfReady: true } : entry)) ?? null);
      notify(`PDF of ${certificate.number} made again`);
    } catch (e) {
      setRowError({ id: certificate.id, message: describe(e) });
    } finally {
      setBusy(null);
    }
  }

  const all = certificates ?? [];
  const found = all.filter((certificate) =>
    matchesSearch(search, [
      certificate.number,
      certificate.outletName,
      certificate.organizationName,
      english(certificate.serviceName),
      certificate.reportNumber,
    ]),
  );
  const shown = found.filter((certificate) => show === "all" || certificate.state === show);
  const counted = (state: CertificateState) => found.filter((certificate) => certificate.state === state).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Certificates</h1>
        <p className="text-muted">
          The certificates of service ECCS has issued. One is issued by itself when you approve a report under Visits, for the
          kinds of service set to carry a certificate in the Catalogue. The restaurant&apos;s Owner and Manager see theirs in the
          app and in their documents.
        </p>
      </div>

      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Field
            label="Search"
            plainLabel
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Number, client, outlet or service"
            wrapperClassName="w-full sm:max-w-sm"
          />
          <ToggleGroup
            label="Show"
            value={show}
            onChange={(value) => query.set({ show: value === "all" ? null : value }, "replace")}
            options={[
              { value: "all", label: "All", count: found.length },
              { value: "VALID", label: STATE.VALID.label, count: counted("VALID") },
              { value: "EXPIRING", label: STATE.EXPIRING.label, count: counted("EXPIRING") },
              { value: "EXPIRED", label: STATE.EXPIRED.label, count: counted("EXPIRED") },
            ]}
          />
        </div>

        {error && (
          <div className="flex flex-col items-start gap-3">
            <ErrorMessage message={error} />
            <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </Button>
          </div>
        )}
        {certificates === null && !error && <Loading />}

        {certificates !== null && all.length === 0 && (
          <p className="text-muted">
            No certificates have been issued yet. The first appears here when you approve the report of a visit whose kind of
            service carries a certificate.
          </p>
        )}
        {all.length > 0 && shown.length === 0 && (
          <div className="flex flex-col items-start gap-2">
            <p className="text-muted">No certificates match.</p>
            <Button
              variant="link"
              className="-ml-2"
              onClick={() => {
                setSearch("");
                query.set({ show: null }, "replace");
              }}
            >
              Clear the search and the filter
            </Button>
          </div>
        )}

        {/* Read out when the search or filter changes what is listed. */}
        <p role="status" className="sr-only">
          {certificates !== null ? `${shown.length} certificate${shown.length === 1 ? "" : "s"} listed` : ""}
        </p>

        {shown.length > 0 && (
          // The side padding keeps the focus ring of the first and last columns from being cut off by the scrolling box.
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr className="border-b border-border">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Certificate
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Client and outlet
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Service
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Valid
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Status
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((certificate) => {
                  const working = busy?.id === certificate.id ? busy.doing : null;
                  return (
                    <tr key={certificate.id} className="border-b border-border align-top last:border-0">
                      <th scope="row" className="py-2.5 pr-4 font-semibold whitespace-nowrap">
                        {certificate.number}
                        {certificate.visitId && (
                          <div className="font-normal">
                            <Link
                              href={`/visits?state=closed&visit=${encodeURIComponent(certificate.visitId)}`}
                              className="inline-block py-0.5 font-medium text-primary hover:underline"
                            >
                              {certificate.reportNumber ? `Report ${certificate.reportNumber}` : "The visit"}
                              <span className="sr-only"> of certificate {certificate.number}</span>
                            </Link>
                          </div>
                        )}
                      </th>
                      <td className="py-2.5 pr-4">
                        {certificate.outletName}
                        <div className="text-muted">{certificate.organizationName}</div>
                      </td>
                      <td className="py-2.5 pr-4">{english(certificate.serviceName)}</td>
                      <td className="py-2.5 pr-4">
                        {day(certificate.validFrom)} to {day(certificate.validUntil)}
                        <div className="text-muted">
                          {certificate.state === "EXPIRED" ? "expired " : ""}
                          {countdown(certificate)}
                        </div>
                      </td>
                      <td className="py-2.5 pr-4">
                        <StateBadge state={certificate.state} />
                      </td>
                      <td className="py-2.5">
                        <div className="flex flex-wrap items-center justify-end gap-x-1 gap-y-2">
                          <Button
                            variant="secondary"
                            className="py-1.5 whitespace-nowrap"
                            loading={working === "open"}
                            disabled={busy !== null}
                            onClick={() => void openPdf(certificate)}
                          >
                            Open the PDF
                            <span className="sr-only"> of {certificate.number}</span>
                          </Button>
                          {mayRemake && (
                            <Button
                              variant="link"
                              className="whitespace-nowrap"
                              loading={working === "remake"}
                              disabled={busy !== null}
                              onClick={() => void remakePdf(certificate)}
                            >
                              Make the PDF again
                              <span className="sr-only"> for {certificate.number}</span>
                            </Button>
                          )}
                        </div>
                        {!certificate.pdfReady && working === null && (
                          <p className="mt-1 text-right text-muted">Not made yet. It is made when first opened.</p>
                        )}
                        {rowError?.id === certificate.id && (
                          <div className="mt-2">
                            <ErrorMessage message={rowError.message} />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-sm text-muted">
        A certificate is ECCS&apos;s own record that a service was done; it is not a government document, and says so. It is
        valid from the day of the visit for the number of days set for that kind of service in the{" "}
        <Link href="/catalogue" className="font-medium text-primary hover:underline">
          Catalogue
        </Link>
        , and counts as expiring soon over the last fifth of that time (at least 3 days, at most 30).
      </p>
    </div>
  );
}
