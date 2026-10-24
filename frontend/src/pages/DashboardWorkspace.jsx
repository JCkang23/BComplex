import { useCallback, useEffect, useState } from "react";

function formatMoney(value) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
    }).format(Number(value || 0));
}

function formatDate(value) {
    if (!value) return "—";
    const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function initials(name = "") {
    return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

export default function DashboardWorkspace() {
    const [data, setData] = useState({ landlordName: "Landlord", tenantsCount: 0, totalPayments: 0, contracts: [] });
    const [csrfToken, setCsrfToken] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const loadDashboard = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const [tokenResponse, response] = await Promise.all([
                fetch("/api/csrf-token", { credentials: "same-origin" }),
                fetch("/api/dashboard-data", { credentials: "same-origin" }),
            ]);
            if (tokenResponse.status === 401 || response.status === 401) {
                window.location.assign("/login");
                return;
            }
            if (!tokenResponse.ok || !response.ok) throw new Error("We couldn’t load your dashboard. Please try again.");
            const token = await tokenResponse.json();
            setCsrfToken(token.csrfToken);
            setData(await response.json());
        } catch (loadError) {
            setError(loadError.message || "We couldn’t load your dashboard. Please try again.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        document.title = "Dashboard | BComplex";
        loadDashboard();
    }, [loadDashboard]);

    const activeCount = data.contracts.filter((contract) => contract.status === "Active").length;

    return (
        <div className="app-shell">
            <aside className="sidebar">
                <a className="brand" href="/react/dashboard" aria-label="BComplex dashboard">
                    <span className="brand-mark">b.</span>
                    <span>BComplex</span>
                </a>
                <div className="workspace-label">WORKSPACE</div>
                <nav className="side-nav" aria-label="Main navigation">
                    <a className="active" href="/react/dashboard" aria-current="page"><span aria-hidden="true">▦</span>Overview</a>
                    <a href="/react/lease"><span aria-hidden="true">⌂</span>Spaces &amp; leases</a>
                    <a href="/contracts"><span aria-hidden="true">▤</span>Contracts</a>
                    <a href="/payments"><span aria-hidden="true">＄</span>Payments</a>
                    <a href="/messages"><span aria-hidden="true">▱</span>Messages</a>
                </nav>
                <div className="sidebar-spacer" />
                <div className="sidebar-help">
                    <strong>Your workspace</strong>
                    <span>A calm overview of your renters and agreements.</span>
                </div>
                <a className="profile-link" href="/profile">
                    <span className="avatar">{initials(data.landlordName)}</span>
                    <span><strong>{data.landlordName}</strong><small>Manage profile</small></span>
                </a>
                <form action="/logout" method="POST" className="sidebar-logout">
                    <input type="hidden" name="_csrf" value={csrfToken} />
                    <button type="submit" disabled={!csrfToken}>Sign out</button>
                </form>
                <a className="classic-link" href="/dashboard/classic">Open classic dashboard</a>
            </aside>

            <main className="main-area">
                <header className="topbar">
                    <div className="breadcrumb"><span>Workspace</span><span aria-hidden="true">›</span><strong>Overview</strong></div>
                    <div className="topbar-right"><span className="status-dot" />Your portfolio at a glance</div>
                </header>

                <div className="page-content dashboard-content">
                    <section className="page-heading">
                        <div>
                            <div className="eyebrow">YOUR OVERVIEW</div>
                            <h1>Welcome, {data.landlordName}</h1>
                            <p>A clear picture of your renters and agreements, all in one place.</p>
                        </div>
                        <div className="heading-actions">
                            <a className="button button-secondary" href="/react/lease">Manage spaces &amp; leases <span aria-hidden="true">↗</span></a>
                        </div>
                    </section>

                    <section className="stats-grid dashboard-stats" aria-label="Portfolio summary">
                        <article className="stat-card">
                            <div className="stat-top"><span className="stat-icon green"><span aria-hidden="true">♙</span></span><span className="stat-trend">Current agreements</span></div>
                            <div className="stat-value">{loading ? "—" : activeCount}</div>
                            <div className="stat-label">Active renters</div>
                        </article>
                        <article className="stat-card">
                            <div className="stat-top"><span className="stat-icon violet"><span aria-hidden="true">▤</span></span><span className="stat-trend">All agreements</span></div>
                            <div className="stat-value">{loading ? "—" : data.contracts.length}</div>
                            <div className="stat-label">Lease agreements</div>
                        </article>
                        <article className="stat-card">
                            <div className="stat-top"><span className="stat-icon gold"><span aria-hidden="true">$</span></span><span className="stat-trend">From lease records</span></div>
                            <div className="stat-value">{loading ? "—" : formatMoney(data.totalPayments)}</div>
                            <div className="stat-label">Recorded rent value</div>
                        </article>
                    </section>

                    <section className="content-panel dashboard-contracts">
                        <div className="panel-heading">
                            <div><h2>Renter agreements</h2><p>Review the renters and contract periods associated with your spaces.</p></div>
                            <a className="count-pill" href="/react/lease">View spaces &amp; leases <span aria-hidden="true">↗</span></a>
                        </div>
                        {error ? (
                            <div className="error-state" role="alert">
                                <span>{error}</span>
                                <button type="button" onClick={loadDashboard}>Try again</button>
                            </div>
                        ) : loading ? (
                            <div className="loading-state" aria-label="Loading agreements"><span /><span /><span /></div>
                        ) : data.contracts.length ? (
                            <div className="table-wrap">
                                <table>
                                    <thead><tr><th>RENTER</th><th>CONTRACT PERIOD</th><th>STATUS</th></tr></thead>
                                    <tbody>{data.contracts.map((contract, index) => (
                                        <tr key={`${contract.room_id}-${contract.tenant_name}-${index}`}>
                                            <td>
                                                <div className="renter-cell">
                                                    <span className="avatar renter-avatar">{initials(contract.tenant_name)}</span>
                                                    <span><strong>{contract.tenant_name}</strong><small>Renter</small></span>
                                                </div>
                                            </td>
                                            <td className="period-cell">{formatDate(contract.start_date)} <span>→</span> {formatDate(contract.end_date)}</td>
                                            <td><span className={`badge ${contract.status === "Active" ? "badge-active" : "badge-ended"}`}><i />{contract.status}</span></td>
                                        </tr>
                                    ))}</tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="empty-state">
                                <span className="empty-icon" aria-hidden="true">▤</span>
                                <h3>No agreements yet</h3>
                                <p>Create a lease to see renter agreements and contract periods in your dashboard.</p>
                                <a className="button button-primary" href="/react/lease">Go to spaces &amp; leases</a>
                            </div>
                        )}
                    </section>

                    <footer className="page-footer">
                        <span>A simpler view of your property portfolio.</span>
                        <a href="/dashboard/classic">Switch to classic dashboard</a>
                    </footer>
                </div>
            </main>
        </div>
    );
}
