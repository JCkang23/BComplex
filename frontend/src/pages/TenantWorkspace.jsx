import { useCallback, useEffect, useMemo, useState } from "react";

const sections = {
    tDashboard: { title: "Overview", description: "Your rental profile and agreements." },
    tLease: { title: "My lease", description: "Review the lease agreements linked to your renter account." },
    tPayments: { title: "Payments", description: "Payment tracking will appear here when it is connected to your account." },
    tMessages: { title: "Messages", description: "Your renter messaging space." },
};

function formatMoney(value) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));
}

function formatDate(value) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })
        .format(new Date(`${String(value).slice(0, 10)}T12:00:00`));
}

function activeLease(lease) {
    const today = new Date().toISOString().slice(0, 10);
    return lease.renter_contract_start <= today && lease.renter_contract_end >= today;
}

export default function TenantWorkspace({ section }) {
    const [data, setData] = useState({ renter: null, leases: [] });
    const [csrfToken, setCsrfToken] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState("");
    const current = sections[section] || sections.tDashboard;

    const loadData = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const [tokenResponse, dataResponse] = await Promise.all([
                fetch("/api/csrf-token", { credentials: "same-origin" }),
                fetch("/api/renter-dashboard-data", { credentials: "same-origin" }),
            ]);
            if (tokenResponse.status === 401 || dataResponse.status === 401) {
                window.location.assign("/login");
                return;
            }
            if (!tokenResponse.ok || !dataResponse.ok) throw new Error("We couldn’t load your renter workspace. Please try again.");
            const [token, workspace] = await Promise.all([tokenResponse.json(), dataResponse.json()]);
            setCsrfToken(token.csrfToken);
            setData(workspace);
        } catch (loadError) {
            setError(loadError.message || "We couldn’t load your renter workspace. Please try again.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        document.title = `${current.title} | BComplex`;
        loadData();
    }, [current.title, loadData]);

    const activeLeases = useMemo(() => data.leases.filter(activeLease), [data.leases]);

    async function saveDiscoverability(event) {
        event.preventDefault();
        setSaving(true);
        setNotice("");
        const formData = new FormData(event.currentTarget);
        try {
            const response = await fetch("/renter/discoverability", {
                method: "POST",
                credentials: "same-origin",
                headers: { Accept: "application/json" },
                body: new URLSearchParams({
                    _csrf: csrfToken,
                    ...(formData.has("discoverable") ? { discoverable: "on" } : {}),
                }),
            });
            if (response.status === 401) {
                window.location.assign("/login");
                return;
            }
            if (!response.ok) throw new Error("Your privacy setting could not be saved. Please try again.");
            const result = await response.json();
            setData((value) => ({ ...value, renter: { ...value.renter, discoverable: result.discoverable } }));
            setNotice(result.message);
        } catch (saveError) {
            setNotice(saveError.message || "Your privacy setting could not be saved.");
        } finally {
            setSaving(false);
        }
    }

    const renter = data.renter;
    const renterName = renter?.full_name || "Renter";

    return (
        <div className="app-shell">
            <aside className="sidebar tenant-sidebar">
                <a className="brand" href="/react/tDashboard" aria-label="BComplex renter dashboard">
                    <span className="brand-mark">b.</span><span>BComplex</span>
                </a>
                <div className="workspace-label">RENTER SPACE</div>
                <nav className="side-nav" aria-label="Renter navigation">
                    <a className={section === "tDashboard" ? "active" : ""} href="/react/tDashboard"><span aria-hidden="true">▦</span>Overview</a>
                    <a className={section === "tLease" ? "active" : ""} href="/react/tLease"><span aria-hidden="true">▤</span>My lease</a>
                    <a className={section === "tPayments" ? "active" : ""} href="/react/tPayments"><span aria-hidden="true">＄</span>Payments</a>
                    <a className={section === "tMessages" ? "active" : ""} href="/react/tMessages"><span aria-hidden="true">▱</span>Messages</a>
                </nav>
                <div className="sidebar-spacer" />
                <div className="sidebar-help"><strong>Your renter space</strong><span>Keep your lease information and privacy choices together.</span></div>
                <div className="profile-link"><span className="avatar">{renterName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</span><span><strong>{renterName}</strong><small>Renter account</small></span></div>
                <form action="/logout" method="POST" className="sidebar-logout">
                    <input type="hidden" name="_csrf" value={csrfToken} />
                    <button type="submit" disabled={!csrfToken}>Sign out</button>
                </form>
            </aside>
            <main className="main-area">
                <header className="topbar"><div className="breadcrumb"><span>Renter space</span><span aria-hidden="true">›</span><strong>{current.title}</strong></div><div className="topbar-right"><span className="status-dot" />Private account</div></header>
                <div className="page-content tenant-content">
                    <section className="page-heading"><div><div className="eyebrow">RENTER WORKSPACE</div><h1>{section === "tDashboard" ? `Welcome, ${renterName}` : current.title}</h1><p>{current.description}</p></div></section>
                    {error && <div className="error-state" role="alert"><span>{error}</span><button type="button" onClick={loadData}>Try again</button></div>}

                    {section === "tDashboard" && (
                        <>
                            <section className="stats-grid tenant-stats" aria-label="Lease summary">
                                <article className="stat-card"><div className="stat-top"><span className="stat-icon green">▤</span><span className="stat-trend">Your agreements</span></div><div className="stat-value">{loading ? "—" : activeLeases.length}</div><div className="stat-label">Active leases</div></article>
                                <article className="stat-card"><div className="stat-top"><span className="stat-icon blue">⌂</span><span className="stat-trend">Monthly rent</span></div><div className="stat-value">{loading ? "—" : formatMoney(activeLeases.reduce((sum, lease) => sum + Number(lease.renter_value || 0), 0))}</div><div className="stat-label">Based on active leases</div></article>
                            </section>
                            <section className="content-panel privacy-panel">
                                <div className="panel-heading"><div><h2>Profile discovery</h2><p>Choose whether landlords may find your profile. When enabled, they can see your name, preference, budget, and activity description.</p></div></div>
                                <form className="privacy-form" onSubmit={saveDiscoverability}>
                                    <label className="privacy-toggle"><input type="checkbox" name="discoverable" checked={Boolean(renter?.discoverable)} onChange={(event) => setData((value) => ({ ...value, renter: { ...value.renter, discoverable: event.target.checked } }))} disabled={loading || saving} /><span>Allow landlords to discover my profile</span></label>
                                    <button className="button button-primary" type="submit" disabled={loading || saving}>{saving ? "Saving..." : "Save privacy setting"}</button>
                                    {notice && <p className="privacy-notice" role="status">{notice}</p>}
                                </form>
                            </section>
                        </>
                    )}

                    {(section === "tDashboard" || section === "tLease") && (
                        <section className="content-panel">
                            <div className="panel-heading"><div><h2>{section === "tDashboard" ? "Your lease" : "Lease agreements"}</h2><p>Lease details currently associated with your account.</p></div><span className="count-pill">{data.leases.length} leases</span></div>
                            {loading ? <div className="loading-state"><span /><span /><span /></div> : data.leases.length ? <div className="table-wrap"><table><thead><tr><th>SPACE</th><th>PERIOD</th><th>MONTHLY RENT</th><th>STATUS</th></tr></thead><tbody>{data.leases.map((lease) => <tr key={lease.id}><td><div className="space-cell"><span className="space-thumb">⌂</span><span><strong>{lease.room_title}</strong><small>{lease.room_details}</small></span></div></td><td className="period-cell">{formatDate(lease.renter_contract_start)} <span>→</span> {formatDate(lease.renter_contract_end)}</td><td className="money-cell">{formatMoney(lease.renter_value)}<small> / month</small></td><td><span className={`badge ${activeLease(lease) ? "badge-active" : "badge-ended"}`}><i />{activeLease(lease) ? "Active" : "Ended"}</span></td></tr>)}</tbody></table></div> : !error && <div className="empty-state"><span className="empty-icon" aria-hidden="true">▤</span><h3>No lease is linked yet</h3><p>Your landlord can create a lease after you choose to make your renter profile discoverable.</p></div>}
                        </section>
                    )}

                    {section === "tPayments" && <section className="content-panel"><div className="empty-state"><span className="empty-icon" aria-hidden="true">＄</span><h3>Payments are not connected yet</h3><p>Your account does not have payment records available in BComplex yet.</p></div></section>}
                    {section === "tMessages" && <section className="content-panel"><div className="empty-state"><span className="empty-icon" aria-hidden="true">▱</span><h3>Messaging is not connected yet</h3><p>There are no renter messages available in BComplex yet.</p></div></section>}
                    <footer className="page-footer"><span>Your account and privacy choices stay under your control.</span>{section !== "tDashboard" && <a href="/react/tDashboard">Back to overview</a>}</footer>
                </div>
            </main>
        </div>
    );
}
