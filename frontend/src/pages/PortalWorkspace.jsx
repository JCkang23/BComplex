import { useCallback, useEffect, useMemo, useState } from "react";

const samplePayments = [
    { tenant: "Michael Brown", amount: 1200, date: "Mar. 1" },
    { tenant: "Sara Davis", amount: 1300, date: "Feb. 26" },
    { tenant: "Emily Johnson", amount: 1250, date: "Feb. 25" },
    { tenant: "Sara Davis", amount: 1300, date: "Jan. 28" },
    { tenant: "Michael Brown", amount: 1200, date: "Jan. 4" },
];

const sampleMessages = [
    { from: "tenant", text: "Hello!" },
    { from: "agent", text: "Hi..." },
];

const sectionInfo = {
    contracts: { title: "Contracts", description: "A clear view of renter agreements across your portfolio." },
    payments: { title: "Payments", description: "Review the payment entries currently available in your workspace." },
    messages: { title: "Messages", description: "A preview of the messaging experience in your workspace." },
    profile: { title: "Profile & account", description: "Review your landlord account information." },
};

function initials(name = "") {
    return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

function formatMoney(value) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));
}

function formatDate(value) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })
        .format(new Date(`${String(value).slice(0, 10)}T12:00:00`));
}

export default function PortalWorkspace({ section }) {
    const [profile, setProfile] = useState(null);
    const [contracts, setContracts] = useState([]);
    const [csrfToken, setCsrfToken] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(section === "profile" || section === "contracts");
    const [sort, setSort] = useState({ field: "", direction: 1 });
    const info = sectionInfo[section] || sectionInfo.contracts;

    const loadData = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const endpoint = section === "profile" ? "/api/profile-data" : "/api/dashboard-data";
            const response = await fetch(endpoint, { credentials: "same-origin" });
            if (response.status === 401) {
                window.location.assign("/login");
                return;
            }
            if (!response.ok) throw new Error("We couldn’t load this page. Please try again.");
            const data = await response.json();
            if (section === "profile") setProfile(data);
            else setContracts(data.contracts || []);
        } catch (loadError) {
            setError(loadError.message || "We couldn’t load this page. Please try again.");
        } finally {
            setLoading(false);
        }
    }, [section]);

    useEffect(() => {
        document.title = `${info.title} | BComplex`;
        fetch("/api/csrf-token", { credentials: "same-origin" })
            .then(async (response) => {
                if (response.status === 401) {
                    window.location.assign("/login");
                    return null;
                }
                if (!response.ok) throw new Error("Could not prepare your secure session.");
                return response.json();
            })
            .then((token) => {
                if (token) setCsrfToken(token.csrfToken);
            })
            .catch((tokenError) => setError(tokenError.message || "Could not prepare your secure session."));
        if (section === "profile" || section === "contracts") loadData();
    }, [info.title, loadData, section]);

    const sortedPayments = useMemo(() => {
        if (!sort.field) return samplePayments;
        return [...samplePayments].sort((a, b) => {
            const comparison = sort.field === "amount" ? a.amount - b.amount : Date.parse(`${a.date} 2024`) - Date.parse(`${b.date} 2024`);
            return comparison * sort.direction;
        });
    }, [sort]);

    function toggleSort(field) {
        setSort((current) => ({
            field,
            direction: current.field === field ? -current.direction : 1,
        }));
    }

    return (
        <div className="app-shell">
            <aside className="sidebar">
                <a className="brand" href="/react/dashboard" aria-label="BComplex dashboard">
                    <span className="brand-mark">b.</span><span>BComplex</span>
                </a>
                <div className="workspace-label">WORKSPACE</div>
                <nav className="side-nav" aria-label="Main navigation">
                    <a href="/react/dashboard"><span aria-hidden="true">▦</span>Overview</a>
                    <a href="/react/lease"><span aria-hidden="true">⌂</span>Spaces &amp; leases</a>
                    <a className={section === "contracts" ? "active" : ""} href="/react/contracts"><span aria-hidden="true">▤</span>Contracts</a>
                    <a className={section === "payments" ? "active" : ""} href="/react/payments"><span aria-hidden="true">＄</span>Payments</a>
                    <a className={section === "messages" ? "active" : ""} href="/react/messages"><span aria-hidden="true">▱</span>Messages</a>
                </nav>
                <div className="sidebar-spacer" />
                <a className="profile-link" href="/react/profile">
                    <span className="avatar">{initials(profile?.full_name || "Landlord")}</span>
                    <span><strong>{profile?.full_name || "Landlord"}</strong><small>Manage profile</small></span>
                </a>
                <form action="/logout" method="POST" className="sidebar-logout">
                    <input type="hidden" name="_csrf" value={csrfToken} />
                    <button type="submit" disabled={!csrfToken}>Sign out</button>
                </form>
                <a className="classic-link" href={`/${section}/classic`}>Open classic {info.title.toLowerCase()} page</a>
            </aside>

            <main className="main-area">
                <header className="topbar">
                    <div className="breadcrumb"><span>Workspace</span><span aria-hidden="true">›</span><strong>{info.title}</strong></div>
                    <div className="topbar-right"><span className="status-dot" />Landlord workspace</div>
                </header>
                <div className="page-content">
                    <section className="page-heading">
                        <div><div className="eyebrow">PROPERTY MANAGEMENT</div><h1>{info.title}</h1><p>{info.description}</p></div>
                        {section === "contracts" && <a className="button button-primary" href="/react/lease">Manage leases</a>}
                    </section>

                    {error && <div className="error-state" role="alert"><span>{error}</span>                    <button type="button" onClick={() => window.location.reload()}>Try again</button></div>}

                    {section === "contracts" && (
                        <section className="content-panel">
                            <div className="panel-heading"><div><h2>Renter agreements</h2><p>Contract periods from your current lease records.</p></div><span className="count-pill">{contracts.length} agreements</span></div>
                            {loading ? <div className="loading-state" aria-label="Loading contracts"><span /><span /><span /></div> : contracts.length ? (
                                <div className="table-wrap"><table>
                                    <thead><tr><th>RENTER</th><th>SPACE</th><th>CONTRACT PERIOD</th><th>STATUS</th></tr></thead>
                                    <tbody>{contracts.map((contract, index) => (
                                        <tr key={`${contract.room_id}-${index}`}>
                                            <td><div className="renter-cell"><span className="avatar renter-avatar">{initials(contract.tenant_name)}</span><span><strong>{contract.tenant_name}</strong><small>Renter</small></span></div></td>
                                            <td>{contract.room_title || "Space"}</td>
                                            <td className="period-cell">{formatDate(contract.start_date)} <span>→</span> {formatDate(contract.end_date)}</td>
                                            <td><span className={`badge ${contract.status === "Active" ? "badge-active" : "badge-ended"}`}><i />{contract.status}</span></td>
                                        </tr>
                                    ))}</tbody>
                                </table></div>
                            ) : !error && <div className="empty-state"><span className="empty-icon" aria-hidden="true">▤</span><h3>No contracts yet</h3><p>Once you create a lease, its agreement will appear here.</p><a className="button button-primary" href="/react/lease">Go to spaces &amp; leases</a></div>}
                        </section>
                    )}

                    {section === "payments" && (
                        <section className="content-panel">
                            <div className="panel-heading"><div><h2>Payment entries</h2><p>These are the sample entries shown by the previous page; payment tracking is not connected to stored payment records yet.</p></div></div>
                            <div className="table-wrap"><table>
                                <thead><tr><th>RENTER</th><th><button className="table-sort" type="button" onClick={() => toggleSort("amount")}>AMOUNT {sort.field === "amount" ? (sort.direction > 0 ? "↑" : "↓") : "↕"}</button></th><th><button className="table-sort" type="button" onClick={() => toggleSort("date")}>DATE {sort.field === "date" ? (sort.direction > 0 ? "↑" : "↓") : "↕"}</button></th></tr></thead>
                                <tbody>{sortedPayments.map((payment, index) => <tr key={`${payment.tenant}-${payment.date}-${index}`}><td>{payment.tenant}</td><td className="money-cell">{formatMoney(payment.amount)}</td><td>{payment.date}</td></tr>)}</tbody>
                            </table></div>
                        </section>
                    )}

                    {section === "messages" && (
                        <section className="content-panel">
                            <div className="panel-heading"><div><h2>Message preview</h2><p>The previous message page used static sample content. Sending and receiving messages is not connected yet.</p></div></div>
                            <div className="message-preview">
                                <div className="message-contacts"><h3>Sample contacts</h3><div className="message-contact active"><span className="avatar renter-avatar">EJ</span><span><strong>Emily Johnson</strong><small>Sample conversation</small></span></div></div>
                                <div className="message-thread"><div className="message-thread-title">Emily Johnson <span>Preview only</span></div>{sampleMessages.map((message, index) => <div key={index} className={`message-bubble ${message.from === "agent" ? "sent" : ""}`}>{message.text}</div>)}</div>
                            </div>
                        </section>
                    )}

                    {section === "profile" && (
                        <section className="content-panel profile-panel">
                            <div className="panel-heading"><div><h2>Account details</h2><p>Basic information associated with your landlord account.</p></div></div>
                            {loading ? <div className="loading-state"><span /><span /></div> : profile && <dl className="profile-details">
                                <div><dt>Full name</dt><dd>{profile.full_name}</dd></div>
                                <div><dt>Email address</dt><dd>{profile.email}</dd></div>
                                <div><dt>Room allowance</dt><dd>{profile.rooms_owned}</dd></div>
                            </dl>}
                        </section>
                    )}
                    <footer className="page-footer"><span>Keep your property workspace close at hand.</span><a href="/react/dashboard">Back to overview</a></footer>
                </div>
            </main>
        </div>
    );
}
