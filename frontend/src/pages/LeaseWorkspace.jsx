import { useCallback, useEffect, useMemo, useState } from "react";

const emptyRoom = {
    newRoomName: "",
    newPropertyDetails: "",
    roomType: "commercial",
    newRoomValue: "",
};

const emptyLease = {
    newRenterName: "",
    newRenterRoom: "",
    newRenterActivity: "",
    newRenterValue: "",
    newRenterContractS: "",
    newRenterContractE: "",
};

function Icon({ name, size = 20 }) {
    const paths = {
        grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
        building: <><path d="M4 21V5.8a1 1 0 0 1 .7-1l7-2.3a1 1 0 0 1 1.3.95V21" /><path d="M13 8h6a1 1 0 0 1 1 1v12M8 8h1m-1 4h1m-1 4h1m4-8h1m-1 4h1m-1 4h1m4-4h.01M3 21h18" /></>,
        file: <><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M13 2v7h7M8 13h8m-8 4h8" /></>,
        wallet: <><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M3 8h18M16 14h.01M7 5V3h11" /></>,
        message: <><path d="M21 11.5a8.5 8.5 0 0 1-12.8 7.3L3 20l1.2-4.2A8.5 8.5 0 1 1 21 11.5Z" /><path d="M8 11h8m-8 3h5" /></>,
        search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></>,
        plus: <><path d="M12 5v14m-7-7h14" /></>,
        arrow: <><path d="M7 17 17 7M7 7h10v10" /></>,
        chevron: <path d="m9 18 6-6-6-6" />,
        home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1z" /></>,
        close: <><path d="m18 6-12 12M6 6l12 12" /></>,
        check: <><path d="m5 12 4 4L19 6" /></>,
    };

    return (
        <svg
            aria-hidden="true"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            {paths[name]}
        </svg>
    );
}

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

function isLeaseActive(lease, now = new Date()) {
    const startsAt = lease.renter_contract_start ? new Date(`${String(lease.renter_contract_start).slice(0, 10)}T00:00:00`) : null;
    const endsAt = lease.renter_contract_end ? new Date(`${String(lease.renter_contract_end).slice(0, 10)}T23:59:59`) : null;
    return (!startsAt || startsAt <= now) && (!endsAt || endsAt >= now);
}

async function readError(response) {
    try {
        const data = await response.json();
        return data.error || "That action could not be completed.";
    } catch {
        return "That action could not be completed. Please try again.";
    }
}

export default function LeaseWorkspace() {
    const [data, setData] = useState({ landlordName: "Landlord", rooms: [], leases: [], renters: [] });
    const [csrfToken, setCsrfToken] = useState("");
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [query, setQuery] = useState("");
    const [modal, setModal] = useState("");
    const [roomForm, setRoomForm] = useState(emptyRoom);
    const [leaseForm, setLeaseForm] = useState(emptyLease);
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState(null);

    const loadWorkspace = useCallback(async () => {
        setLoading(true);
        setLoadError("");
        try {
            const [tokenResponse, dataResponse] = await Promise.all([
                fetch("/api/csrf-token", { credentials: "same-origin" }),
                fetch("/api/lease-data", { credentials: "same-origin" }),
            ]);

            if (tokenResponse.status === 401 || dataResponse.status === 401) {
                window.location.assign("/login");
                return;
            }
            if (!tokenResponse.ok || !dataResponse.ok) {
                throw new Error("We couldn’t load your workspace. Please refresh the page.");
            }

            const [tokenData, workspace] = await Promise.all([tokenResponse.json(), dataResponse.json()]);
            setCsrfToken(tokenData.csrfToken);
            setData(workspace);
        } catch (error) {
            setLoadError(error.message || "We couldn’t load your workspace. Please refresh the page.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        document.title = "Spaces & leases | BComplex";
        loadWorkspace();
    }, [loadWorkspace]);

    useEffect(() => {
        if (!notice) return undefined;
        const timeout = window.setTimeout(() => setNotice(null), 4200);
        return () => window.clearTimeout(timeout);
    }, [notice]);

    useEffect(() => {
        if (!modal) return undefined;
        const onKeyDown = (event) => {
            if (event.key === "Escape" && !saving) setModal("");
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [modal, saving]);

    const availableRooms = useMemo(() => data.rooms.filter((room) => room.is_available), [data.rooms]);
    const filteredLeases = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return data.leases;
        return data.leases.filter((lease) =>
            [lease.renter_name, lease.room_title, lease.renter_details]
                .filter(Boolean)
                .some((value) => value.toLowerCase().includes(normalized))
        );
    }, [data.leases, query]);

    const occupiedCount = data.rooms.length - availableRooms.length;
    const occupancy = data.rooms.length ? Math.round((occupiedCount / data.rooms.length) * 100) : 0;
    const activeLeases = data.leases.filter((lease) => isLeaseActive(lease));
    const monthlyRevenue = activeLeases.reduce((total, lease) => total + Number(lease.renter_value || 0), 0);

    function selectRenter(name) {
        const renter = data.renters.find((item) => item.full_name === name);
        setLeaseForm((current) => ({
            ...current,
            newRenterName: name,
            newRenterActivity: renter?.activity_desc || "",
            newRenterValue: renter?.budget ? String(Number(renter.budget)) : current.newRenterValue,
        }));
    }

    function selectRoom(title) {
        const room = availableRooms.find((item) => item.title === title);
        setLeaseForm((current) => ({
            ...current,
            newRenterRoom: title,
            newRenterValue: room?.room_price ? String(Number(room.room_price)) : current.newRenterValue,
        }));
    }

    async function submitForm(event, endpoint, values, successMessage, reset) {
        event.preventDefault();
        setSaving(true);
        setNotice(null);
        try {
            const body = new URLSearchParams({ ...values, _csrf: csrfToken });
            const response = await fetch(endpoint, {
                method: "POST",
                credentials: "same-origin",
                headers: { Accept: "application/json" },
                body,
            });

            if (response.status === 401 || response.status === 403) {
                if (response.status === 401) {
                    window.location.assign("/login");
                    return;
                }
                throw new Error("Your session expired. Refresh the page and try again.");
            }
            if (!response.ok) throw new Error(await readError(response));

            reset();
            setModal("");
            setNotice({ type: "success", message: successMessage });
            await loadWorkspace();
        } catch (error) {
            setNotice({ type: "error", message: error.message || "Something went wrong. Please try again." });
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="app-shell">
            <aside className="sidebar">
                <a className="brand" href="/react/dashboard" aria-label="BComplex dashboard">
                    <span className="brand-mark">b.</span>
                    <span>BComplex</span>
                </a>
                <div className="workspace-label">WORKSPACE</div>
                <nav className="side-nav" aria-label="Main navigation">
                    <a href="/react/dashboard"><Icon name="grid" />Overview</a>
                    <a className="active" href="/react/lease" aria-current="page"><Icon name="building" />Spaces & leases</a>
                    <a href="/contracts"><Icon name="file" />Contracts</a>
                    <a href="/payments"><Icon name="wallet" />Payments</a>
                    <a href="/messages"><Icon name="message" />Messages</a>
                </nav>
                <div className="sidebar-spacer" />
                <div className="sidebar-help">
                    <div className="help-orb"><Icon name="home" size={18} /></div>
                    <strong>Your workspace</strong>
                    <span>Keep every space and agreement in one place.</span>
                </div>
                <a className="profile-link" href="/profile">
                    <span className="avatar">{data.landlordName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</span>
                    <span><strong>{data.landlordName}</strong><small>Manage profile</small></span>
                    <Icon name="chevron" size={17} />
                </a>
                <form action="/logout" method="POST" className="sidebar-logout">
                    <input type="hidden" name="_csrf" value={csrfToken} />
                    <button type="submit" disabled={!csrfToken}>Sign out</button>
                </form>
                <a className="classic-link" href="/lease/classic">Open classic lease page</a>
            </aside>

            <main className="main-area">
                <header className="topbar">
                    <div className="breadcrumb"><span>Workspace</span><Icon name="chevron" size={14} /><strong>Spaces & leases</strong></div>
                    <div className="topbar-right"><span className="status-dot" />All changes are saved</div>
                </header>

                <div className="page-content">
                    <section className="page-heading">
                        <div>
                            <div className="eyebrow">PROPERTY MANAGEMENT</div>
                            <h1>Spaces & leases</h1>
                            <p>A clear view of your spaces, renters, and active agreements.</p>
                        </div>
                        <div className="heading-actions">
                            <button className="button button-secondary" onClick={() => setModal("room")} type="button">
                                <Icon name="plus" size={17} /> Add a space
                            </button>
                            <button className="button button-primary" onClick={() => setModal("lease")} type="button" disabled={!availableRooms.length || !data.renters.length}>
                                <Icon name="plus" size={17} /> Create lease
                            </button>
                        </div>
                    </section>

                    {notice && (
                        <div className={`toast toast-${notice.type}`} role="status">
                            <Icon name={notice.type === "success" ? "check" : "close"} size={18} />
                            {notice.message}
                            <button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)}><Icon name="close" size={16} /></button>
                        </div>
                    )}

                    <section className="stats-grid" aria-label="Portfolio summary">
                        <article className="stat-card">
                            <div className="stat-top"><span className="stat-icon green"><Icon name="building" /></span><span className="stat-trend"><Icon name="arrow" size={14} />Portfolio</span></div>
                            <div className="stat-value">{loading ? "—" : data.rooms.length}</div>
                            <div className="stat-label">Total spaces</div>
                        </article>
                        <article className="stat-card">
                            <div className="stat-top"><span className="stat-icon blue"><Icon name="home" /></span><span className="stat-trend">{occupancy}% occupied</span></div>
                            <div className="stat-value">{loading ? "—" : occupiedCount}</div>
                            <div className="stat-label">Occupied spaces</div>
                        </article>
                        <article className="stat-card">
                            <div className="stat-top"><span className="stat-icon violet"><Icon name="file" /></span><span className="stat-trend">Current leases</span></div>
                            <div className="stat-value">{loading ? "—" : activeLeases.length}</div>
                            <div className="stat-label">Renter agreements</div>
                        </article>
                        <article className="stat-card revenue-card">
                            <div className="stat-top"><span className="stat-icon gold"><Icon name="wallet" /></span><span className="stat-trend">Based on leases</span></div>
                            <div className="stat-value">{loading ? "—" : formatMoney(monthlyRevenue)}</div>
                            <div className="stat-label">Monthly rent value</div>
                        </article>
                    </section>

                    <section className="content-panel spaces-panel">
                        <div className="panel-heading">
                            <div><h2>Your spaces</h2><p>Availability and details across your portfolio.</p></div>
                            <span className="count-pill">{data.rooms.length} spaces</span>
                        </div>
                        {loadError ? <ErrorState message={loadError} onRetry={loadWorkspace} /> : loading ? <LoadingRows /> : (
                            data.rooms.length ? (
                                <div className="table-wrap">
                                    <table>
                                        <thead><tr><th>SPACE</th><th>TYPE</th><th>MONTHLY RENT</th><th>STATUS</th><th /></tr></thead>
                                        <tbody>{data.rooms.map((room) => (
                                            <tr key={room.id}>
                                                <td><div className="space-cell"><span className="space-thumb"><Icon name="building" size={19} /></span><span><strong>{room.title}</strong><small>{room.room_details}</small></span></div></td>
                                                <td><span className="type-label">{room.room_type || "Space"}</span></td>
                                                <td className="money-cell">{formatMoney(room.room_price)}<small> / month</small></td>
                                                <td><span className={`badge ${room.is_available ? "badge-available" : "badge-occupied"}`}><i />{room.is_available ? "Available" : "Occupied"}</span></td>
                                                <td><span className="row-arrow"><Icon name="chevron" size={17} /></span></td>
                                            </tr>
                                        ))}</tbody>
                                    </table>
                                </div>
                            ) : <EmptyState title="Add your first space" detail="Create a space to start organizing availability and leases." action="Add a space" onAction={() => setModal("room")} />
                        )}
                    </section>

                    <section className="content-panel leases-panel">
                        <div className="panel-heading lease-panel-heading">
                            <div><h2>Renter agreements</h2><p>Keep track of who is renting each space.</p></div>
                            <label className="search-box"><Icon name="search" size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search renters or spaces" aria-label="Search renters or spaces" /></label>
                        </div>
                        {loadError ? <ErrorState message={loadError} onRetry={loadWorkspace} /> : loading ? <LoadingRows /> : (
                            filteredLeases.length ? (
                                <div className="table-wrap">
                                    <table>
                                        <thead><tr><th>RENTER</th><th>SPACE</th><th>MONTHLY RENT</th><th>LEASE PERIOD</th><th>STATUS</th></tr></thead>
                                        <tbody>{filteredLeases.map((lease) => {
                                            const active = isLeaseActive(lease);
                                            return (
                                                <tr key={lease.id}>
                                                    <td><div className="renter-cell"><span className="avatar renter-avatar">{lease.renter_name?.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</span><span><strong>{lease.renter_name}</strong><small>{lease.renter_details || "Renter"}</small></span></div></td>
                                                    <td><span className="space-name"><Icon name="home" size={15} />{lease.room_title}</span></td>
                                                    <td className="money-cell">{formatMoney(lease.renter_value)}<small> / month</small></td>
                                                    <td className="period-cell">{formatDate(lease.renter_contract_start)}<span>to</span>{formatDate(lease.renter_contract_end)}</td>
                                                    <td><span className={`badge ${active ? "badge-available" : "badge-ended"}`}><i />{active ? "Active" : "Ended"}</span></td>
                                                </tr>
                                            );
                                        })}</tbody>
                                    </table>
                                </div>
                            ) : <EmptyState title={query ? "No matching agreements" : "No agreements yet"} detail={query ? "Try a different renter or space name." : "When you assign a renter to a space, their agreement will appear here."} action={query ? "" : "Create a lease"} onAction={() => setModal("lease")} />
                        )}
                    </section>

                    <footer className="page-footer"><span>Designed to make property management feel simpler.</span><a href="/lease/classic">Switch to classic view <Icon name="arrow" size={13} /></a></footer>
                </div>
            </main>

            {modal && (
                <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setModal(""); }}>
                    <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
                        <div className="modal-heading">
                            <div><span className="eyebrow">{modal === "room" ? "PORTFOLIO" : "AGREEMENT"}</span><h2 id="modal-title">{modal === "room" ? "Add a space" : "Create a lease"}</h2><p>{modal === "room" ? "Add the details for a space you manage." : "Pair an opted-in renter with one of your available spaces."}</p></div>
                            <button className="icon-button" type="button" aria-label="Close dialog" disabled={saving} onClick={() => setModal("")}><Icon name="close" /></button>
                        </div>
                        {modal === "room" ? (
                            <form className="modal-form" onSubmit={(event) => submitForm(event, "/newRoom", roomForm, "Your space has been added.", () => setRoomForm(emptyRoom))}>
                                <Field label="Space name"><input autoFocus required maxLength="100" value={roomForm.newRoomName} onChange={(event) => setRoomForm({ ...roomForm, newRoomName: event.target.value })} placeholder="e.g. Market Street Suite" /></Field>
                                <Field label="Space type"><select value={roomForm.roomType} onChange={(event) => setRoomForm({ ...roomForm, roomType: event.target.value })}><option value="commercial">Commercial</option><option value="residential">Residential</option><option value="other">Other</option></select></Field>
                                <Field label="Monthly rent"><div className="input-prefix"><span>$</span><input required type="number" min="1" max="1000000" step="0.01" value={roomForm.newRoomValue} onChange={(event) => setRoomForm({ ...roomForm, newRoomValue: event.target.value })} placeholder="1,500" /></div></Field>
                                <Field label="Details"><textarea required maxLength="2000" rows="3" value={roomForm.newPropertyDetails} onChange={(event) => setRoomForm({ ...roomForm, newPropertyDetails: event.target.value })} placeholder="Location, size, notable features..." /></Field>
                                <div className="modal-actions"><button className="button button-secondary" type="button" disabled={saving} onClick={() => setModal("")}>Cancel</button><button className="button button-primary" disabled={saving} type="submit">{saving ? "Saving..." : "Add space"}</button></div>
                            </form>
                        ) : (
                            <form className="modal-form" onSubmit={(event) => submitForm(event, "/newRenter", leaseForm, "Your lease has been created.", () => setLeaseForm(emptyLease))}>
                                {!data.renters.length && <div className="form-note">No renters have opted into discovery yet. A renter must enable profile discovery before you can create a lease with them.</div>}
                                {!availableRooms.length && <div className="form-note">You have no available spaces. Add a space or make one available before creating a lease.</div>}
                                <Field label="Renter"><select autoFocus required value={leaseForm.newRenterName} onChange={(event) => selectRenter(event.target.value)}><option value="">Choose a renter</option>{data.renters.map((renter, index) => <option key={`${renter.full_name}-${index}`} value={renter.full_name}>{renter.full_name} · {renter.preference}</option>)}</select></Field>
                                <Field label="Space"><select required value={leaseForm.newRenterRoom} onChange={(event) => selectRoom(event.target.value)}><option value="">Choose an available space</option>{availableRooms.map((room) => <option key={room.id} value={room.title}>{room.title} · {formatMoney(room.room_price)}/mo</option>)}</select></Field>
                                <Field label="Renter activity"><input required maxLength="1000" value={leaseForm.newRenterActivity} onChange={(event) => setLeaseForm({ ...leaseForm, newRenterActivity: event.target.value })} placeholder="Business or activity" /></Field>
                                <Field label="Monthly rent"><div className="input-prefix"><span>$</span><input required type="number" min="1" max="1000000" step="0.01" value={leaseForm.newRenterValue} onChange={(event) => setLeaseForm({ ...leaseForm, newRenterValue: event.target.value })} placeholder="1,500" /></div></Field>
                                <div className="field-row"><Field label="Lease starts"><input required type="date" value={leaseForm.newRenterContractS} onChange={(event) => setLeaseForm({ ...leaseForm, newRenterContractS: event.target.value })} /></Field><Field label="Lease ends"><input required type="date" min={leaseForm.newRenterContractS || undefined} value={leaseForm.newRenterContractE} onChange={(event) => setLeaseForm({ ...leaseForm, newRenterContractE: event.target.value })} /></Field></div>
                                <div className="modal-actions"><button className="button button-secondary" type="button" disabled={saving} onClick={() => setModal("")}>Cancel</button><button className="button button-primary" disabled={saving || !data.renters.length || !availableRooms.length} type="submit">{saving ? "Creating..." : "Create lease"}</button></div>
                            </form>
                        )}
                    </section>
                </div>
            )}
        </div>
    );
}

function Field({ label, children }) {
    return <label className="form-field"><span>{label}</span>{children}</label>;
}

function EmptyState({ title, detail, action, onAction }) {
    return <div className="empty-state"><span className="empty-icon"><Icon name="building" size={22} /></span><h3>{title}</h3><p>{detail}</p>{action && <button className="button button-secondary" type="button" onClick={onAction}>{action}<Icon name="arrow" size={15} /></button>}</div>;
}

function ErrorState({ message, onRetry }) {
    return <div className="error-state" role="alert"><span>{message}</span><button type="button" onClick={onRetry}>Try again</button></div>;
}

function LoadingRows() {
    return <div className="loading-state" aria-label="Loading workspace"><span /><span /><span /></div>;
}
