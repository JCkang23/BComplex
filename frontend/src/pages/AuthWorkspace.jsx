import { useEffect, useState } from "react";

const initialRegistration = {
    full_name: "",
    email: "",
    password: "",
    rooms_owned: "1",
    looking_for: "",
    amount: "500",
    desc: "",
};

function Brand({ href = "/" }) {
    return (
        <a className="auth-brand" href={href} aria-label="BComplex home">
            <span className="brand-mark">b.</span>
            <span>BComplex</span>
        </a>
    );
}

function AuthShell({ children, mode }) {
    return (
        <main className="auth-page">
            <section className="auth-showcase">
                <Brand />
                <div className="auth-showcase-copy">
                    <span className="auth-kicker">A BETTER WAY TO RENT</span>
                    <h1>Make room for what’s next.</h1>
                    <p>One thoughtful place to manage spaces, agreements, and the people who make them matter.</p>
                    <div className="auth-benefits">
                        <span><i>✓</i> Your spaces and leases, organized</span>
                        <span><i>✓</i> Privacy choices that stay yours</span>
                        <span><i>✓</i> A simpler workspace for everyone</span>
                    </div>
                </div>
                <div className="auth-showcase-footer">A more considered rental experience.</div>
            </section>
            <section className="auth-panel">
                {mode !== "home" && <Brand />}
                {children}
            </section>
        </main>
    );
}

function Home({ onMode }) {
    return (
        <AuthShell mode="home">
            <div className="auth-card auth-home-card">
                <span className="auth-kicker">WELCOME TO BCOMPLEX</span>
                <h2>Space to do things differently.</h2>
                <p>Whether you manage a property or are looking for your next space, your workspace starts here.</p>
                <div className="auth-home-actions">
                    <button className="button button-primary auth-submit" type="button" onClick={() => onMode("register")}>Create your account</button>
                    <button className="button button-secondary auth-submit" type="button" onClick={() => onMode("login")}>Sign in</button>
                </div>
                <div className="auth-secure-note"><span aria-hidden="true">◆</span> Secure, private, and built around your needs</div>
            </div>
        </AuthShell>
    );
}

export default function AuthWorkspace({ mode }) {
    const [screen, setScreen] = useState(mode);
    const [role, setRole] = useState(new URLSearchParams(window.location.search).get("role") || "");
    const [loginRole, setLoginRole] = useState("");
    const [csrfToken, setCsrfToken] = useState("");
    const [formValues, setFormValues] = useState(initialRegistration);
    const [error, setError] = useState("");
    const [loadingToken, setLoadingToken] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        document.title = screen === "register" ? "Create account | BComplex" : screen === "login" ? "Sign in | BComplex" : "BComplex | A better way to rent";
        if (screen === "home") {
            setLoadingToken(false);
            return undefined;
        }
        let active = true;
        fetch("/api/csrf-token", { credentials: "same-origin" })
            .then(async (response) => {
                if (!response.ok) throw new Error("We couldn’t prepare a secure form. Please refresh and try again.");
                return response.json();
            })
            .then((data) => {
                if (active) setCsrfToken(data.csrfToken);
            })
            .catch((requestError) => {
                if (active) setError(requestError.message || "We couldn’t prepare a secure form. Please refresh and try again.");
            })
            .finally(() => {
                if (active) setLoadingToken(false);
            });
        return () => { active = false; };
    }, [screen]);

    function navigate(nextScreen, nextRole = role) {
        setScreen(nextScreen);
        setError("");
        if (nextScreen === "register") {
            setRole(nextRole);
            const query = nextRole ? `?role=${encodeURIComponent(nextRole)}` : "";
            window.history.pushState({}, "", `/react/register${query}`);
        } else if (nextScreen === "login") {
            window.history.pushState({}, "", "/react/login");
        } else {
            window.history.pushState({}, "", "/react/");
        }
    }

    useEffect(() => {
        const syncLocation = () => {
            const path = window.location.pathname.split("/").pop();
            setScreen(path === "register" ? "register" : path === "login" ? "login" : "home");
            setRole(new URLSearchParams(window.location.search).get("role") || "");
            setError("");
        };
        window.addEventListener("popstate", syncLocation);
        return () => window.removeEventListener("popstate", syncLocation);
    }, []);

    function updateField(event) {
        const { name, value, checked, type } = event.currentTarget;
        setFormValues((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
    }

    async function submit(event) {
        event.preventDefault();
        setError("");
        setSubmitting(true);
        try {
            const formData = new FormData(event.currentTarget);
            const body = new URLSearchParams();
            for (const [key, value] of formData.entries()) body.append(key, String(value));
            body.set("_csrf", csrfToken);

            const response = await fetch(screen === "login" ? "/login" : "/register", {
                method: "POST",
                credentials: "same-origin",
                headers: { Accept: "application/json" },
                body,
            });
            let result;
            try {
                result = await response.json();
            } catch {
                throw new Error("We couldn’t complete your request. Please try again.");
            }
            if (!response.ok) throw new Error(result.error || "We couldn’t complete your request. Please try again.");
            window.location.assign(result.redirect);
        } catch (submitError) {
            setError(submitError.message || "We couldn’t complete your request. Please try again.");
        } finally {
            setSubmitting(false);
        }
    }

    if (screen === "home") return <Home onMode={navigate} />;

    const isRegister = screen === "register";
    const roleRequired = isRegister && !["landlord", "renter"].includes(role);

    return (
        <AuthShell mode={screen}>
            <div className="auth-card">
                <span className="auth-kicker">{isRegister ? "GET STARTED" : "WELCOME BACK"}</span>
                <h2>{isRegister ? "Create your account" : "Sign in to your space"}</h2>
                <p className="auth-intro">{isRegister ? "A few details are all it takes to get your BComplex workspace ready." : "Pick up right where you left off."}</p>

                <div className="auth-tabs" role="tablist" aria-label="Account access">
                    <button type="button" role="tab" aria-selected={!isRegister} className={!isRegister ? "selected" : ""} onClick={() => navigate("login")}>Sign in</button>
                    <button type="button" role="tab" aria-selected={isRegister} className={isRegister ? "selected" : ""} onClick={() => navigate("register")}>Create account</button>
                </div>

                {error && <div className="auth-error" role="alert">{error}</div>}

                {roleRequired ? (
                    <div className="auth-role-picker">
                        <label className="auth-field-label">I’m here as a</label>
                        <button type="button" className="role-card" onClick={() => navigate("register", "landlord")}><span className="role-card-icon">⌂</span><span><strong>Landlord</strong><small>Manage rental spaces and renter agreements</small></span><span aria-hidden="true">›</span></button>
                        <button type="button" className="role-card" onClick={() => navigate("register", "renter")}><span className="role-card-icon">▤</span><span><strong>Renter</strong><small>Keep your space and rental information together</small></span><span aria-hidden="true">›</span></button>
                    </div>
                ) : (
                    <form className="auth-form" onSubmit={submit}>
                        {isRegister && (
                            <>
                                <div className="auth-role-heading">
                                    <span>Creating a {role} account</span>
                                    <button type="button" onClick={() => navigate("register", "")}>Change</button>
                                </div>
                                <input type="hidden" name="role" value={role} />
                                <label className="auth-field">
                                    <span>Full name</span>
                                    <input autoComplete="name" name="full_name" value={formValues.full_name} onChange={updateField} placeholder="Your name" maxLength={100} required />
                                </label>
                            </>
                        )}

                        {isRegister && role === "renter" && (
                            <label className="auth-field">
                                <span>What kind of space are you looking for?</span>
                                <select name="looking_for" value={formValues.looking_for} onChange={updateField} required>
                                    <option value="" disabled>Select a space type</option>
                                    <option value="commercial">Commercial</option>
                                    <option value="residential">Residential</option>
                                    <option value="other">Other</option>
                                </select>
                            </label>
                        )}

                        {!isRegister && (
                            <label className="auth-field">
                                <span>I’m signing in as</span>
                                <select name="role" value={loginRole} onChange={(event) => setLoginRole(event.target.value)} required>
                                    <option value="" disabled>Select your role</option>
                                    <option value="landlord">Landlord</option>
                                    <option value="renter">Renter</option>
                                </select>
                            </label>
                        )}

                        <label className="auth-field">
                            <span>Email address</span>
                            <input autoComplete="email" name="email" type="email" value={formValues.email} onChange={updateField} placeholder="you@example.com" maxLength={100} required />
                        </label>
                        <label className="auth-field">
                            <span>Password</span>
                            <input autoComplete={isRegister ? "new-password" : "current-password"} name="password" type="password" value={formValues.password} onChange={updateField} placeholder={isRegister ? "At least 8 characters" : "Your password"} minLength={8} required />
                            {isRegister && <small>Use at least 8 characters. Passwords longer than 72 UTF-8 bytes are not accepted.</small>}
                        </label>

                        {isRegister && role === "landlord" && (
                            <label className="auth-field">
                                <span>How many spaces do you manage?</span>
                                <select name="rooms_owned" value={formValues.rooms_owned} onChange={updateField} required>
                                    {Array.from({ length: 50 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} {index === 0 ? "space" : "spaces"}</option>)}
                                </select>
                            </label>
                        )}

                        {isRegister && role === "renter" && (
                            <>
                                <label className="auth-field">
                                    <span>Monthly budget <strong className="range-value">${formValues.amount}</strong></span>
                                    <input type="range" name="amount" min="0" max="1000" step="50" value={formValues.amount} onChange={updateField} />
                                </label>
                                <label className="auth-field">
                                    <span>Tell us what you’re looking for <small>(optional)</small></span>
                                    <textarea name="desc" value={formValues.desc} onChange={updateField} maxLength={1000} rows={3} placeholder="A little about your business or intended use" />
                                </label>
                                <label className="auth-consent">
                                    <input type="checkbox" name="discoverable" checked={Boolean(formValues.discoverable)} onChange={updateField} />
                                    <span>I agree to let landlords find my profile, including my name, space preference, budget, and activity description. This is optional and can be changed later.</span>
                                </label>
                            </>
                        )}

                        <button className="button button-primary auth-submit" type="submit" disabled={submitting || loadingToken || !csrfToken}>
                            {submitting ? "Please wait..." : isRegister ? "Create account" : "Sign in"}
                        </button>
                        <p className="auth-secure-note"><span aria-hidden="true">◆</span> Your account is protected with secure sign-in.</p>
                    </form>
                )}

                <p className="auth-legal">By continuing, you agree to use BComplex responsibly and respect renter privacy.</p>
                <a className="auth-classic-link" href={isRegister ? `/register/classic${role ? `?role=${encodeURIComponent(role)}` : ""}` : "/login/classic"}>Use the classic {isRegister ? "registration" : "sign-in"} page</a>
            </div>
        </AuthShell>
    );
}
