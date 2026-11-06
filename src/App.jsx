import React, { useEffect, useMemo, useState } from "react";

import {
  Routes,
  Route,
  Link,
  NavLink,
  Navigate,
  useNavigate,
  useParams,
  useLocation,
} from "react-router-dom";
import * as Lucide from "lucide-react";
import { useAuth, Guard, homeFor, request as authRequest } from "./auth";
import {
  BRAND,
  services,
  steps,
  stages,
  counties,
  money,
  dateString,
  roleLabel,
  roleMenus,
  posts,
  permissions,
} from "./data";
import {
  getItem as storeGetItem,
  addItem as storeAddItem,
  setItem as storeSetItem,
  updateItem as storeUpdateItem,
  audit,
  exportCSV,
} from "./store";
const Icon = ({ name, size = 19, ...props }) => {
  const C = Lucide[name] || Lucide.Circle;
  return <C size={size} strokeWidth={1.85} {...props} />;
};
const today = () => new Date().toISOString().slice(0, 10);

// The original store handles existing collections. These extra demo collections
// are self-contained until the store.js seed/schema is expanded.
const NEW_COLLECTIONS = new Set([
  "properties",
  "tenants",
  "rentPayments",
  "contractorApplications",
  "invitations",
]);
const localKey = (name) => `bautek-extension-${name}`;
const localRead = (name) => {
  try {
    const rows = JSON.parse(
      window.localStorage.getItem(localKey(name)) || "[]",
    );
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
};
const localWrite = (name, rows) => {
  try {
    window.localStorage.setItem(localKey(name), JSON.stringify(rows));
  } catch (error) {
    console.warn("Local preview storage unavailable:", error);
  }
  window.dispatchEvent(new Event("bautek-store-change"));
};
const getItem = (name) =>
  NEW_COLLECTIONS.has(name) ? localRead(name) : storeGetItem(name);
const setItem = (name, rows) =>
  NEW_COLLECTIONS.has(name) ? localWrite(name, rows) : storeSetItem(name, rows);
const addItem = (name, item) =>
  NEW_COLLECTIONS.has(name)
    ? localWrite(name, [...getItem(name), item])
    : storeAddItem(name, item);
const updateItem = (name, id, patch) =>
  NEW_COLLECTIONS.has(name)
    ? localWrite(
        name,
        getItem(name).map((record) =>
          String(record.id) === String(id) ? { ...record, ...patch } : record,
        ),
      )
    : storeUpdateItem(name, id, patch);

// Contractor applications and invitations have UI hooks, but require new backend
// routes: POST /contractor-applications and POST /invitations.
// Optional backend adapter. The URL in .env is the API root, e.g.
// VITE_API_URL=http://localhost:5000/api/v1 (matching auth.jsx).
// When VITE_API_URL is unset the entire application continues using demo data.
// With the URL set, read operations prefer server data and fall back to local
// data on network / HTTP errors. Write failures retain a *preview-only* local
// copy; they are not confirmed server mutations.
const API_BASE = String(import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
const API_TIMEOUT_MS = 9000;
const apiPath = (collection, id = "") => {
  const collectionPath =
    collection === "contractorApplications"
      ? "contractor-applications"
      : collection;
  return `/${encodeURIComponent(collectionPath)}${id ? `/${encodeURIComponent(id)}` : ""}`;
};
const apiRequest = async (path, options = {}) => {
  if (!API_BASE) throw new Error("Backend API is not configured.");
  return authRequest(path, options);
};

const notifyAction = (message, kind = "success") =>
  window.dispatchEvent(
    new CustomEvent("bautek-action-feedback", {
      detail: { message, kind, key: Date.now() },
    }),
  );
const notifyCollections = () =>
  window.dispatchEvent(new Event("bautek-remote-change"));

// Writes must only display success after a confirmed backend response.
const writeRecord = async (collection, record) => {
  try {
    if (liveWriteEnabled()) {
      const response = await apiRequest(apiPath(collection), {
        method: "POST",
        body: JSON.stringify(record),
      });
      if (!response) throw new Error("No confirmation from backend.");
      notifyCollections();
      notifyAction(`${collection}: saved successfully.`);
      return response?.data || response?.item || response;
    }
    addItem(collection, record);
    notifyAction(`${collection}: saved in demo mode only.`);
    return record;
  } catch (error) {
    notifyAction(`${collection}: save failed. ${error.message}`, "error");
    return null;
  }
};
const patchRecord = async (collection, id, patch) => {
  try {
    if (liveWriteEnabled()) {
      const response = await apiRequest(apiPath(collection, id), {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      if (!response) throw new Error("No confirmation from backend.");
      notifyCollections();
      notifyAction(`${collection}: updated successfully.`);
      return response?.data || response?.item || response;
    }
    updateItem(collection, id, patch);
    notifyAction(`${collection}: demo update saved locally.`);
    return patch;
  } catch (error) {
    notifyAction(`${collection}: update failed. ${error.message}`, "error");
    return null;
  }
};

const recordsFromResponse = (result) => {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.items)) return result.items;
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.data?.items)) return result.data.items;
  if (Array.isArray(result?.results)) return result.results;
  return null;
};
const liveWriteEnabled = () =>
  Boolean(API_BASE) && sessionStorage.getItem("bautek_auth_mode") === "api";
const replaceRecord = (collection, rows) => setItem(collection, rows);
const SPECIALTIES = [
  "Land survey",
  "Quantity survey",
  "Architecture",
  "Construction management",
  "Physical planning",
  "Interior design",
  "Procurement",
  "Civil engineering",
  "Structural engineering",
  "Mechanical engineering",
  "Electrical engineering",
  "Welding",
  "Property management",
  "Land acquisition",
  "Legal conveyancing",
  "Valuation",
  "Project management",
  "Environmental assessment",
];
const assignmentsFor = (project, id) =>
  (project.adminAssignments || []).filter(
    (a) => String(a.adminId) === String(id),
  );
const belongsToAdmin = (project, id) =>
  assignmentsFor(project, id).length > 0 ||
  String(project.assignedAdminId || "") === String(id);
const propertyForTenant = (tenant, properties) =>
  properties.find((p) => String(p.id) === String(tenant.propertyId));
const amount = (x) => Number(x || 0);
const sumAmounts = (rows) =>
  rows.reduce((total, item) => total + amount(item.amount), 0);
const monthsDue = (start, date = today()) => {
  if (!start) return 0;
  const s = new Date(`${start.slice(0, 7)}-01T00:00:00`);
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00`);
  return Math.max(
    0,
    (d.getFullYear() - s.getFullYear()) * 12 + d.getMonth() - s.getMonth() + 1,
  );
};
const rentStats = (tenant, payments) => {
  const received = sumAmounts(
    payments.filter(
      (p) =>
        String(p.tenantId) === String(tenant.id) &&
        ["Confirmed", "Recorded", "Paid"].includes(p.status),
    ),
  );
  const expected = monthsDue(tenant.leaseStart) * amount(tenant.monthlyRent);
  const arrears = Math.max(
    0,
    expected - received - amount(tenant.openingCredit),
  );
  const credited = Math.max(
    0,
    received + amount(tenant.openingCredit) - expected,
  );
  const score = expected
    ? Math.min(
        100,
        Math.round(
          100 *
            Math.min(1, (received + amount(tenant.openingCredit)) / expected),
        ),
      )
    : 100;
  return { received, expected, arrears, credited, score };
};
const canSeeProperty = (p, user, projects) =>
  user.role === "super_admin" ||
  (user.role === "client" && String(p.ownerId) === String(user.id)) ||
  (user.role === "admin" &&
    (p.adminIds || []).some(
      (id) =>
        String(id) === String(user.id) ||
        projects.some(
          (project) =>
            String(project.id) === String(p.projectId) &&
            belongsToAdmin(project, user.id),
        ),
    ));

function useCollection(key) {
  const { user, demo } = useAuth();
  const [items, setItems] = useState(() => (demo ? getItem(key) || [] : []));
  useEffect(() => {
    let live = true;
    const updateLocal = () => {
      if (live && demo) setItems(getItem(key) || []);
    };
    window.addEventListener("bautek-store-change", updateLocal);
    const loadRemote = async () => {
      if (!live || demo || !API_BASE || !user) return;
      try {
        const result = await apiRequest(apiPath(key));
        const rows = recordsFromResponse(result);
        if (live && rows !== null) {
          setItems(rows);
          replaceRecord(key, rows);
        }
      } catch (error) {
        if (live)
          notifyAction(`${key}: unable to refresh. ${error.message}`, "error");
      }
    };
    window.addEventListener("bautek-remote-change", loadRemote);
    if (demo) {
      setItems(getItem(key) || []);
    } else if (API_BASE && user) {
      // Never present a demo user's cached data as real account data.
      setItems([]);
      void apiRequest(apiPath(key))
        .then((result) => {
          const rows = recordsFromResponse(result);
          if (!live) return;
          if (rows !== null) {
            setItems(rows);
            replaceRecord(key, rows);
          } else setItems([]);
        })
        .catch((error) => {
          if (live) {
            setItems([]);
            console.warn(`${key}: live API read failed:`, error.message);
          }
        });
    } else setItems([]);
    return () => {
      live = false;
      window.removeEventListener("bautek-store-change", updateLocal);
      window.removeEventListener("bautek-remote-change", loadRemote);
    };
  }, [key, demo, user?.id]);
  return items;
}
function Button({
  children,
  icon,
  onClick,
  to,
  variant = "primary",
  type = "button",
  disabled = false,
  className = "",
}) {
  const cls = `btn btn-${variant} ${className}`;
  return to ? (
    <Link className={cls} to={to}>
      {icon && <Icon name={icon} size={17} />} {children}
    </Link>
  ) : (
    <button type={type} onClick={onClick} disabled={disabled} className={cls}>
      {icon && <Icon name={icon} size={17} />} {children}
    </button>
  );
}
function Tag({ children, tone = "neutral" }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}
const statusTone = (s) =>
  s === "Completed" ||
  s === "Active" ||
  s === "Published" ||
  s === "Accepted" ||
  s === "Approved" ||
  s === "Confirmed" ||
  s === "Recorded"
    ? "green"
    : s === "Cancelled" || s === "Rejected"
      ? "red"
      : s === "Under review" || s === "Pending" || s === "Removal requested"
        ? "amber"
        : "neutral";
function Empty({
  title = "Nothing here yet",
  description = "New records will appear here as they are created.",
  action,
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name="Inbox" size={27} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
function ActionNotice({ message, error = false }) {
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={error ? "error-box" : "notice"}
    >
      <Icon name={error ? "AlertCircle" : "CheckCircle2"} size={18} /> {message}
    </div>
  );
}

function SectionHead({ eyebrow, title, desc, action }) {
  return (
    <div className="section-head">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
        {desc && <p>{desc}</p>}
      </div>
      {action}
    </div>
  );
}
function InfoCard({ icon, title, desc }) {
  return (
    <div className="info-card">
      <span className="info-icon">
        <Icon name={icon} size={24} />
      </span>
      <h3>{title}</h3>
      <p>{desc}</p>
    </div>
  );
}
function PublicHeader() {
  const { user } = useAuth();
  return (
    <header className="public-header">
      <div className="container header-inner">
        <Link className="brand" to="/">
          <span className="brand-mark">
            <Icon name="Landmark" size={23} />
          </span>
          <span>
            BAUTEK <strong>FLINK</strong>
            <small>WE BUILD THAT LAST</small>
          </span>
        </Link>
        <nav className="public-nav">
          <NavLink to="/services">Services</NavLink>
          <NavLink to="/marketplace">Marketplace</NavLink>
          <NavLink to="/insights">Insights</NavLink>
          <NavLink to="/about">About us</NavLink>
        </nav>
        <div className="header-actions">
          <Link
            className="plain-link"
            to={
              user
                ? user.role === "tenant"
                  ? "/app/tenant"
                  : homeFor(user.role)
                : "/login"
            }
          >
            {user ? "Dashboard" : "Sign in"}
          </Link>
          <Button
            to={
              user
                ? user.role === "tenant"
                  ? "/app/tenant"
                  : homeFor(user.role)
                : "/register"
            }
          >
            Get started <Icon name="ArrowUpRight" size={16} />
          </Button>
        </div>
      </div>
    </header>
  );
}
function PublicLayout({ children }) {
  return (
    <div className="public-site">
      <PublicHeader />
      {children}
      <footer className="footer">
        <div className="container footer-grid">
          <div>
            <div className="brand footer-brand">
              <span className="brand-mark">
                <Icon name="Landmark" />
              </span>
              <span>
                BAUTEK <strong>FLINK</strong>
              </span>
            </div>
            <p>
              Trusted project delivery, land verification and property
              management in Kenya, wherever you call home.
            </p>
          </div>
          <div>
            <strong>Explore</strong>
            <Link to="/services">Our services</Link>
            <Link to="/marketplace">Marketplace</Link>
            <Link to="/insights">Insights</Link>
          </div>
          <div>
            <strong>Company</strong>
            <Link to="/about">About Bautek</Link>
            <Link to="/register">Join Bautek</Link>
            <Link to="/login">Client portal</Link>
          </div>
          <div>
            <strong>Built for trust</strong>
            <span>Transparent reporting</span>
            <span>Verified milestones</span>
            <span>Independent oversight</span>
          </div>
        </div>
        <div className="container footer-bottom">
          © {new Date().getFullYear()} Bautek Flink Ltd. All rights reserved.{" "}
          <span>We Build That Last. To Feel at Home.</span>
        </div>
      </footer>
    </div>
  );
}
function Home() {
  return (
    <PublicLayout>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <span className="hero-pill">
              <span className="pulse" /> Building trust across borders
            </span>
            <h1>
              Your dreams in Kenya.
              <br />
              <em>Our commitment</em>
              <br />
              on the ground.
            </h1>
            <p>
              From your first plot of land to the keys to your new home, Bautek
              brings clarity, accountability and professional oversight to every
              step.
            </p>
            <div className="hero-buttons">
              <Button to="/register" icon="ArrowUpRight">
                Start your project
              </Button>
              <Button to="/services" variant="outline" icon="PlayCircle">
                Explore our services
              </Button>
            </div>
            <div className="hero-proofs">
              <span>
                <Icon name="ShieldCheck" /> Independently verified
              </span>
              <span>
                <Icon name="Camera" /> Evidence-based updates
              </span>
              <span>
                <Icon name="FileCheck2" /> Documented decisions
              </span>
            </div>
          </div>
          <div className="hero-visual">
            <div className="hero-photo">
              <div className="photo-label">
                <Icon name="MapPin" size={17} /> Building confidence in Kenya
              </div>
            </div>
            <div className="floating-card">
              <span className="float-icon">
                <Icon name="ClipboardCheck" />
              </span>
              <span>
                <strong>Every milestone matters</strong>
                <small>Progress. Proof. Peace of mind.</small>
              </span>
              <Icon name="CheckCircle2" className="green-text" />
            </div>
          </div>
        </div>
      </section>
      <div className="trust-strip">
        <div className="container">
          <span>THE BETTER WAY TO BUILD</span>
          <span>
            <Icon name="BadgeCheck" /> Due diligence
          </span>
          <span>
            <Icon name="ChartNoAxesCombined" /> Cost visibility
          </span>
          <span>
            <Icon name="HardHat" /> Technical expertise
          </span>
          <span>
            <Icon name="Globe" /> Diaspora friendly
          </span>
        </div>
      </div>
      <section className="section container">
        <SectionHead
          eyebrow="WHAT WE DO"
          title="One trusted partner. Every step of the journey."
          desc="Choose Bautek to deliver your project or appoint us to independently supervise the team you select."
          action={
            <Button to="/services" variant="light">
              View all services <Icon name="ArrowRight" size={16} />
            </Button>
          }
        />
        <div className="service-grid">
          {services.map((x) => (
            <Link to="/services" className="service-card" key={x.id}>
              <span className="service-symbol">
                <Icon name={x.icon} size={26} />
              </span>
              <h3>{x.name}</h3>
              <p>{x.desc}</p>
              <span className="card-arrow">
                <Icon name="ArrowUpRight" size={18} />
              </span>
            </Link>
          ))}
        </div>
      </section>
      <section className="how-section">
        <div className="container">
          <SectionHead
            eyebrow="HOW IT WORKS"
            title="Your project. Visible from anywhere."
            desc="A transparent process designed for clients who value evidence, clarity and control."
          />
          <div className="how-grid">
            {[
              [
                "01",
                "Tell us your goal",
                "Describe the land, construction or property service you need.",
              ],
              [
                "02",
                "Agree on a plan",
                "Review professional advice, scope, estimated costs and deliverables.",
              ],
              [
                "03",
                "Follow real progress",
                "See documented milestones, photos, financial activity and reviews.",
              ],
              [
                "04",
                "Approve with confidence",
                "Review evidence and approve milestones before the next step.",
              ],
            ].map(([n, t, d]) => (
              <div className="how-item" key={n}>
                <span>{n}</span>
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="section container">
        <div className="split-cta">
          <div>
            <span className="eyebrow">BUILT FOR KENYANS EVERYWHERE</span>
            <h2>Building at home shouldn't feel far away.</h2>
            <p>
              Stay connected to decisions, budgets and work on the ground
              without having to be physically present.
            </p>
            <Button to="/register">
              Create your free account <Icon name="ArrowRight" size={16} />
            </Button>
          </div>
          <div className="cta-visual">
            <Icon name="HousePlus" size={94} />
            <div className="cta-mini">Your vision, backed by visibility.</div>
          </div>
        </div>
      </section>
      <section className="section container">
        <SectionHead
          eyebrow="BAUTEK JOURNAL"
          title="Insights for informed decisions"
          action={
            <Button to="/insights" variant="light">
              See all articles
            </Button>
          }
        />
        <div className="blog-grid">
          {posts.map((p, i) => (
            <Link to="/insights" className="blog-card" key={p.title}>
              <div className={`blog-image blog-image-${i}`}>
                <Icon
                  name={["MapPinned", "Building2", "ClipboardList"][i]}
                  size={42}
                />
              </div>
              <div className="blog-body">
                <span className="eyebrow">
                  {p.category} · {p.date}
                </span>
                <h3>{p.title}</h3>
                <p>{p.excerpt}</p>
                <b>
                  Read article <Icon name="ArrowRight" size={16} />
                </b>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </PublicLayout>
  );
}
function Services() {
  return (
    <PublicLayout>
      <div className="page-hero">
        <div className="container">
          <span className="eyebrow">OUR SOLUTIONS</span>
          <h1>Services built around your goals.</h1>
          <p>
            Expert help from purchase to construction, installation and
            long-term property management.
          </p>
        </div>
      </div>
      <section className="section container">
        <div className="service-grid">
          {services.map((s) => (
            <div className="info-card service-detail" key={s.id}>
              <span className="info-icon">
                <Icon name={s.icon} size={26} />
              </span>
              <h3>{s.name}</h3>
              <p>{s.desc}</p>
              {s.id === "property" ? (
                <p className="service-fee">
                  Management proposal: 5% of annual net property income, subject
                  to agreement.
                </p>
              ) : (
                <p className="service-fee">
                  Bautek delivery: {s.direct * 100}% · Independent supervision:{" "}
                  {s.supervise * 100}%
                </p>
              )}
              <Button to="/register" variant="light">
                Start a request
              </Button>
            </div>
          ))}
        </div>
        <div className="notice">
          <Icon name="Info" /> Fee estimates shown are based on the project
          brief and require a signed agreement. Government charges and other
          third-party costs must be confirmed before payment.
        </div>
      </section>
    </PublicLayout>
  );
}
function About() {
  return (
    <PublicLayout>
      <div className="page-hero">
        <div className="container">
          <span className="eyebrow">ABOUT BAUTEK</span>
          <h1>
            We Build That Last.
            <br />
            To Feel at Home.
          </h1>
          <p>
            Bautek Flink Ltd supports property and construction decisions
            through professional oversight, verifiable records and transparent
            communication.
          </p>
        </div>
      </div>
      <section className="section container">
        <SectionHead
          title="Confidence built into every decision"
          desc="We combine local knowledge and digital reporting to make it easier for clients at home or abroad to follow their investments."
        />
        <div className="three-grid">
          <InfoCard
            icon="ShieldCheck"
            title="Integrity"
            desc="A documented chain of evidence and review for important project and property decisions."
          />
          <InfoCard
            icon="Eye"
            title="Visibility"
            desc="Understand milestones, budgets, materials and project progress as work happens."
          />
          <InfoCard
            icon="Handshake"
            title="Accountability"
            desc="Defined responsibilities, transparent professional fees and independent checks."
          />
        </div>
      </section>
    </PublicLayout>
  );
}
function Insights() {
  return (
    <PublicLayout>
      <div className="page-hero">
        <div className="container">
          <span className="eyebrow">NEWS & KNOWLEDGE</span>
          <h1>Building smarter starts here.</h1>
          <p>
            Guides and project updates designed to protect your investment and
            inform your choices.
          </p>
        </div>
      </div>
      <section className="section container">
        <div className="blog-grid">
          {posts.map((p, i) => (
            <article className="blog-card" key={p.title}>
              <div className={`blog-image blog-image-${i}`}>
                <Icon
                  name={["MapPinned", "Building2", "ClipboardList"][i]}
                  size={42}
                />
              </div>
              <div className="blog-body">
                <span className="eyebrow">
                  {p.category} · {p.date}
                </span>
                <h3>{p.title}</h3>
                <p>{p.excerpt}</p>
                <span className="muted tiny">
                  Editorial summaries for demonstration. Replace with published
                  CMS articles.
                </span>
              </div>
            </article>
          ))}
        </div>
        <div className="notice">
          Public project updates must be anonymised and approved before
          publication. Do not disclose owners, precise addresses or project
          documents.
        </div>
      </section>
    </PublicLayout>
  );
}
function PublicMarketplace() {
  const items = useCollection("listings");
  const [query, setQuery] = useState("");
  const [county, setCounty] = useState("All");
  const filtered = items.filter(
    (x) =>
      x.status === "Published" &&
      (county === "All" || x.county === county) &&
      [x.title, x.category, x.description]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <PublicLayout>
      <div className="page-hero">
        <div className="container">
          <span className="eyebrow">COMMUNITY MARKETPLACE</span>
          <h1>Find possibilities. Verify with confidence.</h1>
          <p>
            Explore land, homes, furniture, machinery and more. Contact details
            are not publicly exchanged.
          </p>
        </div>
      </div>
      <section className="section container">
        <div className="filter-row">
          <input
            placeholder="Search listings…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select value={county} onChange={(e) => setCounty(e.target.value)}>
            <option>All</option>
            {counties.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <Button to="/register" icon="Plus">
            Post a listing
          </Button>
        </div>
        <div className="listing-grid">
          {filtered.map((x, i) => (
            <div className="listing-card" key={x.id}>
              <div className={`listing-image image-${i % 4}`}>
                <Icon
                  name={
                    x.category === "Land"
                      ? "MapPinned"
                      : x.category === "Machinery"
                        ? "Cog"
                        : "House"
                  }
                  size={43}
                />
              </div>
              <div className="listing-content">
                <Tag>{x.category}</Tag>
                <h3>{x.title}</h3>
                <p>
                  <Icon name="MapPin" size={15} /> {x.county} County
                </p>
                <strong>{money(x.price)}</strong>
                <Button to={`/marketplace/${x.id}`} variant="light">
                  View listing
                </Button>
              </div>
            </div>
          ))}
        </div>
        {!filtered.length && <Empty title="No listings found" />}
      </section>
    </PublicLayout>
  );
}
function ListingDetail() {
  const { id } = useParams();
  const item = useCollection("listings").find(
    (x) => x.id === id && x.status === "Published",
  );
  const { user } = useAuth();
  return (
    <PublicLayout>
      <section className="section container">
        {!item ? (
          <Empty title="Listing not found" />
        ) : (
          <div className="detail-layout">
            <div>
              <div className="detail-visual">
                <Icon
                  name={item.category === "Land" ? "MapPinned" : "House"}
                  size={90}
                />
              </div>
              <h1>{item.title}</h1>
              <p>{item.description}</p>
              <div className="notice">
                <Icon name="ShieldAlert" /> Listings are user-submitted and not
                verified unless explicitly marked. All purchase and title checks
                must be completed before funds are released.
              </div>
            </div>
            <div className="panel">
              <Tag>{item.category}</Tag>
              <h2>{money(item.price)}</h2>
              <p>
                <Icon name="MapPin" size={16} /> {item.county} County
              </p>
              <p>Posted by {item.author}</p>
              <Button
                to={
                  user
                    ? user.role === "tenant"
                      ? "/app/tenant"
                      : homeFor(user.role)
                    : "/register"
                }
                block
              >
                Request verification <Icon name="ArrowRight" size={16} />
              </Button>
              <small className="muted">
                Contact details are not shared publicly.
              </small>
            </div>
          </div>
        )}
      </section>
    </PublicLayout>
  );
}
function AuthPage({ register = false }) {
  const { login, demoLogin, register: submitRegistration, demo } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [registrationKind, setRegistrationKind] = useState("client");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (register) {
        await submitRegistration({ name, email, password, role: "client" });
        if (registrationKind === "contractor")
          sessionStorage.setItem(
            "bautek_contract_apply_email",
            email.trim().toLowerCase(),
          );
        navigate("/login", {
          state: {
            notice:
              registrationKind === "contractor"
                ? "Client account created. Sign in and select Apply as contractor to submit your credentials for review."
                : "Account created. Sign in to continue.",
          },
        });
      } else {
        const u = await login(email, password);
        const wantsContractor =
          u.role === "client" &&
          sessionStorage.getItem("bautek_contract_apply_email") ===
            String(u.email || email)
              .trim()
              .toLowerCase();
        if (wantsContractor)
          sessionStorage.removeItem("bautek_contract_apply_email");
        navigate(
          wantsContractor ? "/app/contractor-application" : homeFor(u.role),
        );
      }
    } catch (error) {
      if (error.code === "API_UNAVAILABLE") {
        setError(
          "Unable to connect to Bautek's server. " +
            "Please check your connection and try again.",
        );
      } else if (error.status === 401) {
        setError("Incorrect email or password. Please try again.");
      } else {
        setError(error.message || "Sign in failed.");
      }
    }
  }
  return (
    <div className="auth-shell">
      <div className="auth-aside">
        <Link className="brand brand-white" to="/">
          <span className="brand-mark">
            <Icon name="Landmark" />
          </span>
          <span>
            BAUTEK <strong>FLINK</strong>
            <small>WE BUILD THAT LAST</small>
          </span>
        </Link>
        <div>
          <span className="eyebrow">YOUR VISION. OUR COMMITMENT.</span>
          <h1>Make every milestone a step toward home.</h1>
          <p>
            Manage your projects, see the evidence and stay connected to the
            people delivering your dreams.
          </p>
          <div className="auth-point">
            <Icon name="ShieldCheck" /> Secure account access
          </div>
          <div className="auth-point">
            <Icon name="ChartNoAxesCombined" /> Transparent project reporting
          </div>
          <div className="auth-point">
            <Icon name="Globe" /> Built for clients at home and abroad
          </div>
        </div>
        <small>© {new Date().getFullYear()} Bautek Flink Ltd</small>
      </div>
      <div className="auth-content">
        <div className="auth-form">
          <Link to="/" className="back-link">
            <Icon name="ArrowLeft" size={16} /> Back to website
          </Link>
          <span className="eyebrow">
            {register ? "JOIN BAUTEK" : "WELCOME BACK"}
          </span>
          <h2>{register ? "Create your account" : "Sign in to Bautek"}</h2>
          <p>
            {register
              ? "Start your journey with a free client account."
              : "Enter your details to access your workspace."}
          </p>
          {location.state?.notice && (
            <div className="notice">
              <Icon name="Info" /> {location.state.notice}
            </div>
          )}
          {error && <div className="error-box">{error}</div>}
          {register && (
            <div className="panel" style={{ marginBottom: 16 }}>
              <strong>What kind of account do you need?</strong>
              <div className="filter-row" style={{ marginTop: 12 }}>
                <label>
                  <input
                    type="radio"
                    checked={registrationKind === "client"}
                    onChange={() => setRegistrationKind("client")}
                  />{" "}
                  Client account
                </label>
                <label>
                  <input
                    type="radio"
                    checked={registrationKind === "contractor"}
                    onChange={() => setRegistrationKind("contractor")}
                  />{" "}
                  Apply as contractor
                </label>
              </div>
              <small className="muted">
                Contractor applicants first create a client account, then submit
                qualifications for Super Admin review. Admins and tenants join
                by invitation; Super Admin accounts are never publicly
                registered.
              </small>
            </div>
          )}
          <form onSubmit={submit}>
            {register && (
              <label>
                Full name
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                />
              </label>
            )}
            <label>
              Email address
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
            <label>
              Password
              <input
                required
                type="password"
                minLength={10}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            </label>
            <Button type="submit" disabled={busy} className="full-width">
              {busy ? "Please wait…" : register ? "Create account" : "Sign in"}{" "}
              <Icon name="ArrowRight" size={16} />
            </Button>
          </form>
          <p className="switch-auth">
            {register ? "Already have an account?" : "New to Bautek?"}{" "}
            <Link to={register ? "/login" : "/register"}>
              {register ? "Sign in" : "Create an account"}
            </Link>
          </p>
          {demo && (
            <div className="demo-panel">
              <div className="demo-title">
                <Icon name="FlaskConical" size={18} /> Interactive preview
              </div>
              <p>
                Explore each role with sample data. These are not live accounts
                or backend permissions.
              </p>
              <div className="demo-buttons">
                {["client", "contractor", "admin", "tenant", "super_admin"].map(
                  (role) => (
                    <button
                      key={role}
                      onClick={() => {
                        const u = demoLogin(role);
                        navigate(
                          u.role === "tenant" ? "/app/tenant" : homeFor(u.role),
                        );
                      }}
                    >
                      {roleLabel(role)} <Icon name="ArrowUpRight" size={15} />
                    </button>
                  ),
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function AppShell({ children }) {
  const { user, logout, demo, apiError } = useAuth();
  const navigate = useNavigate();
  const [mobile, setMobile] = useState(false);
  const [actionFeedback, setActionFeedback] = useState(null);
  useEffect(() => {
    const handler = (e) => setActionFeedback(e.detail);
    window.addEventListener("bautek-action-feedback", handler);
    return () => window.removeEventListener("bautek-action-feedback", handler);
  }, []);
  const menu =
    user.role === "tenant"
      ? [
          ["Overview", "/app/tenant", "LayoutDashboard"],
          ["Rent & payments", "/app/tenant/rent", "Receipt"],
          ["Messages", "/app/messages", "MessageSquare"],
          ["Notifications", "/app/notifications", "Bell"],
        ]
      : [...(roleMenus[user.role] || [])];
  if (user.role === "admin")
    menu.push(["My specialisations", "/app/admin/profile", "BadgeCheck"]);
  if (["admin", "super_admin"].includes(user.role))
    menu.push(["Tenants", "/app/tenants", "UsersRound"]);
  if (["admin", "super_admin"].includes(user.role))
    menu.push(["Tenant assignments", "/app/tenant-assignments", "HousePlus"]);
  if (user.role === "super_admin")
    menu.push(["Project allocations", "/app/allocations", "ClipboardCheck"]);
  if (user.role === "super_admin")
    menu.push([
      "Contractor applications",
      "/app/contractor-applications",
      "HardHat",
    ]);
  if (user.role === "super_admin")
    menu.push(["Invitations", "/app/invitations", "MailPlus"]);
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "sidebar-open" : ""}`}>
        <Link
          className="brand brand-white"
          to={homeFor(user.role)}
          onClick={() => setMobile(false)}
        >
          <span className="brand-mark">
            <Icon name="Landmark" />
          </span>
          <span>
            BAUTEK <strong>FLINK</strong>
            <small>WORKSPACE</small>
          </span>
        </Link>
        <div className="workspace-label">
          {user.role === "tenant" ? "Tenant" : roleLabel(user.role)} workspace
        </div>
        <nav className="side-nav">
          {menu.map(([name, path, icon]) => (
            <NavLink
              key={path}
              to={path}
              end={path === homeFor(user.role)}
              onClick={() => setMobile(false)}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              <Icon name={icon} size={19} />
              {name}
            </NavLink>
          ))}
        </nav>
        <div className="side-bottom">
          <Link to="/" className="side-link">
            <Icon name="Globe" size={18} /> Public website
          </Link>
          <button
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
            className="side-link"
          >
            <Icon name="LogOut" size={18} /> Sign out
          </button>
        </div>
      </aside>
      {mobile && (
        <div className="mobile-overlay" onClick={() => setMobile(false)} />
      )}
      <div className="app-area">
        <header className="app-topbar">
          <button className="menu-toggle" onClick={() => setMobile(!mobile)}>
            <Icon name="Menu" />
          </button>
          <div className="breadcrumb">
            <span>Workspace</span>
            <Icon name="ChevronRight" size={14} />
            <strong>
              {user.role === "tenant" ? "Tenant" : roleLabel(user.role)}
            </strong>
          </div>
          <div className="topbar-right">
            {demo && <Tag tone="amber">DEMO MODE</Tag>}
            <Link className="topbar-icon" to="/app/notifications">
              <Icon name="Bell" size={19} />
            </Link>
            <div className="avatar">
              {user.name
                ?.split(" ")
                .slice(0, 2)
                .map((x) => x[0])
                .join("") || "BF"}
            </div>
            <div className="user-meta">
              <strong>{user.name}</strong>
              <small>
                {user.role === "tenant" ? "Tenant" : roleLabel(user.role)}
              </small>
            </div>
          </div>
        </header>
        <main className="workspace-main">
          {apiError && !demo && (
            <div role="status" className="notice">
              <Icon name="WifiOff" size={17} /> {apiError} The saved session is
              retained; live changes require a connection.
            </div>
          )}
          {actionFeedback && (
            <div
              role="status"
              aria-live="polite"
              className={
                actionFeedback.kind === "error" ? "error-box" : "notice"
              }
            >
              <Icon
                name={
                  actionFeedback.kind === "error"
                    ? "AlertCircle"
                    : "CheckCircle2"
                }
                size={18}
              />
              <span>{actionFeedback.message}</span>
              <button
                type="button"
                className="plain-link"
                onClick={() => setActionFeedback(null)}
                aria-label="Dismiss message"
              >
                ×
              </button>
            </div>
          )}
          {demo && (
            <div className="demo-warning">
              <Icon name="Info" size={16} /> Preview workspace — data is stored
              in this browser only. No payments, identity checks, messages or
              approvals are processed by the backend.
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
function Kpi({ label, value, icon, sub, tone = "blue" }) {
  return (
    <div className="kpi">
      <div className="kpi-top">
        <span>{label}</span>
        <span className={`kpi-icon tone-${tone}`}>
          <Icon name={icon} size={20} />
        </span>
      </div>
      <strong>{value}</strong>
      <small>{sub}</small>
    </div>
  );
}
function ProjectTable({ items }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Project</th>
            <th>Location</th>
            <th>Budget</th>
            <th>Status</th>
            <th>Progress</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id}>
              <td>
                <strong>{p.name}</strong>
                <small>
                  {p.id} · {p.type}
                </small>
              </td>
              <td>{p.county}</td>
              <td>{money(p.budget)}</td>
              <td>
                <Tag tone={statusTone(p.status)}>{p.status}</Tag>
              </td>
              <td>
                <div className="progress-cell">
                  <div className="progress-track">
                    <div style={{ width: p.progress + "%" }} />
                  </div>
                  <span>{p.progress}%</span>
                </div>
              </td>
              <td>
                <Link className="row-link" to={`/app/projects/${p.id}`}>
                  <Icon name="ArrowUpRight" size={19} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Dashboard() {
  const { user } = useAuth();
  const projects = useCollection("projects");
  const bids = useCollection("bids");
  const users = useCollection("users");
  const transactions = useCollection("transactions");
  const mine = projects.filter((p) => p.ownerId === user.id);
  const assigned = projects.filter((p) => p.contractor === "Amani Build Co.");
  const working =
    user.role === "client"
      ? mine
      : user.role === "contractor"
        ? assigned
        : user.role === "admin"
          ? projects.filter((p) => belongsToAdmin(p, user.id))
          : projects;
  const role = user.role;
  const labels = {
    client: [
      "Your projects, all in one place.",
      "Track progress, spending and decisions from wherever you are.",
    ],
    contractor: [
      "Deliver great work, with every detail captured.",
      "Stay on top of your tasks, project evidence and submitted bids.",
    ],
    admin: [
      "Keep every project on track.",
      "Review milestones, verify records and coordinate operations.",
    ],
    super_admin: [
      "The full picture. Every decision.",
      "Oversee project performance, users, financial records and system governance.",
    ],
  };
  return (
    <>
      <div className="welcome">
        <div>
          <span className="eyebrow">{dateString(today()).toUpperCase()}</span>
          <h1>
            {role === "client"
              ? `Welcome back, ${user.name?.split(" ")[0]}.`
              : labels[role][0]}
          </h1>
          <p>{role === "client" ? labels.client[1] : labels[role][1]}</p>
        </div>
        {role === "client" ? (
          <Button to="/app/projects/new" icon="Plus">
            New project
          </Button>
        ) : role === "contractor" ? (
          <Button to="/app/deliverables" icon="Plus">
            Log progress
          </Button>
        ) : (
          <Button to="/app/verifications" icon="BadgeCheck">
            Review queue
          </Button>
        )}
      </div>
      <div className="kpi-grid">
        <Kpi
          label={
            role === "client"
              ? "Total projects"
              : role === "contractor"
                ? "Assigned projects"
                : "Total projects"
          }
          value={working.length}
          icon="FolderKanban"
          sub="Projects within your workspace"
        />
        <Kpi
          label="Active projects"
          value={working.filter((x) => x.status === "Active").length}
          icon="Activity"
          sub="Currently in progress"
          tone="green"
        />
        <Kpi
          label={
            role === "contractor"
              ? "My bids"
              : role === "super_admin"
                ? "Platform users"
                : "Project value"
          }
          value={
            role === "contractor"
              ? bids.filter((b) => b.contractor === "Amani Build Co.").length
              : role === "super_admin"
                ? users.length
                : money(working.reduce((a, b) => a + Number(b.budget || 0), 0))
          }
          icon={role === "super_admin" ? "Users" : "Wallet"}
          sub={
            role === "contractor"
              ? "Recorded proposals"
              : role === "super_admin"
                ? "Registered demo records"
                : "Planned total budget"
          }
          tone="orange"
        />
        <Kpi
          label={
            role === "admin" || role === "super_admin"
              ? "Verification items"
              : role === "contractor"
                ? "Awaiting review"
                : "Completed projects"
          }
          value={
            role === "admin" || role === "super_admin"
              ? projects.filter((x) => x.status === "Under review").length
              : role === "contractor"
                ? bids.filter((x) => x.status === "Under review").length
                : working.filter((x) => x.status === "Completed").length
          }
          icon="CheckCheck"
          sub="Records requiring attention"
          tone="purple"
        />
      </div>
      {role === "client" && (
        <section className="panel">
          <SectionHead
            title="Become a Bautek contractor"
            desc="Registered as a contractor? Submit your qualifications for Super Admin approval."
            action={
              <Button to="/app/contractor-application" icon="HardHat">
                Apply as contractor
              </Button>
            }
          />
        </section>
      )}
      {role === "admin" && <AdminPortfolio />}
      {role === "super_admin" && (
        <section className="panel">
          <SectionHead
            title="Pending client approvals"
            action={
              <Button to="/app/allocations" variant="light">
                Review & assign
              </Button>
            }
          />
          <p>
            {
              projects.filter(
                (p) =>
                  p.status === "Under review" || p.approvalStatus === "Pending",
              ).length
            }{" "}
            requests awaiting review and allocation.
          </p>
        </section>
      )}
      <div className="dashboard-grid">
        <section className="panel panel-wide">
          <SectionHead
            title={
              role === "client" ? "My recent projects" : "Project activity"
            }
            desc="Quick access to the latest work and milestones."
            action={
              <Button to="/app/projects" variant="light">
                View all <Icon name="ArrowRight" size={15} />
              </Button>
            }
          />
          {working.length ? (
            <ProjectTable items={working.slice(0, 4)} />
          ) : (
            <Empty
              title="No projects yet"
              action={<Button to="/app/projects/new">Create a project</Button>}
            />
          )}
        </section>
        <section className="panel quick-panel">
          <h3>Quick actions</h3>
          {(role === "client"
            ? [
                ["Start a project", "/app/projects/new", "PlusCircle"],
                ["Explore marketplace", "/app/marketplace", "Store"],
                ["Financial statements", "/app/property", "FileText"],
                ["Project documents", "/app/documents", "Files"],
                [
                  "Apply as contractor",
                  "/app/contractor-application",
                  "HardHat",
                ],
              ]
            : role === "contractor"
              ? [
                  ["Add site update", "/app/deliverables", "ClipboardCheck"],
                  ["Explore tenders", "/app/tenders", "Gavel"],
                  ["Manage bids", "/app/bids", "BriefcaseBusiness"],
                ]
              : role === "admin"
                ? [
                    ["Verify submissions", "/app/verifications", "BadgeCheck"],
                    ["Review marketplace", "/app/marketplace", "Store"],
                    ["Property records", "/app/property", "House"],
                  ]
                : [
                    ["Manage users", "/app/users", "Users"],
                    ["Audit activity", "/app/audit", "ScrollText"],
                    ["System settings", "/app/settings", "Settings"],
                  ]
          ).map(([title, link, icon]) => (
            <Link className="quick-link" key={title} to={link}>
              <span>
                <Icon name={icon} size={18} />
              </span>
              {title}
              <Icon name="ArrowUpRight" size={16} />
            </Link>
          ))}
        </section>
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <SectionHead
            title="Project workflow"
            desc="From the first decision to final handover."
          />
          <div className="timeline">
            {[
              ["01", "Project request", "Scope, location and delivery model"],
              [
                "02",
                "Verification & planning",
                "Documentation, estimates and approvals",
              ],
              [
                "03",
                "Execution & oversight",
                "Deliverables, progress and evidence",
              ],
              [
                "04",
                "Sign-off & reporting",
                "Review, final records and handover",
              ],
            ].map(([n, t, d]) => (
              <div className="timeline-row" key={n}>
                <span>{n}</span>
                <div>
                  <strong>{t}</strong>
                  <p>{d}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <SectionHead
            title="Transparency at a glance"
            desc="The principles behind every Bautek workspace."
          />
          <div className="promise-list">
            {[
              [
                "ShieldCheck",
                "Role-based visibility",
                "Only relevant project and account information appears in each workspace.",
              ],
              [
                "ClipboardCheck",
                "Evidence-led activity",
                "Progress updates and documents attach to project records.",
              ],
              [
                "FileLock2",
                "Controlled approvals",
                "Sensitive actions require backend verification and audit.",
              ],
            ].map(([i, t, d]) => (
              <div className="promise" key={t}>
                <span>
                  <Icon name={i} />
                </span>
                <div>
                  <strong>{t}</strong>
                  <p>{d}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
// Visually consistent Bautek panels, but each role gets its own operational workspace.
function ContractorDashboard() {
  const { user } = useAuth();
  const projects = useCollection("projects");
  const bids = useCollection("bids");
  const deliverables = useCollection("deliverables");
  const mine = projects.filter(
    (p) =>
      String(p.contractorId || "") === String(user.id) ||
      (p.contractor &&
        (p.contractor === user.companyName ||
          p.contractor === user.name ||
          (user.demo && p.contractor === "Amani Build Co."))),
  );
  const myBids = bids.filter(
    (b) =>
      String(b.contractorId || "") === String(user.id) ||
      (user.demo && b.contractor === "Amani Build Co."),
  );
  return (
    <>
      <div className="welcome">
        <div>
          <span className="eyebrow">CONTRACTOR WORKSPACE</span>
          <h1>Delivery, tenders and site updates.</h1>
          <p>
            Manage assigned construction work, submit bids and record verified
            deliverables.
          </p>
        </div>
        <Button to="/app/deliverables" icon="ClipboardCheck">
          Log site progress
        </Button>
      </div>
      <div className="kpi-grid">
        <Kpi
          label="My contracts"
          value={mine.length}
          icon="HardHat"
          sub="Assigned to your contracting team"
        />
        <Kpi
          label="Active sites"
          value={mine.filter((p) => p.status === "Active").length}
          icon="Building2"
          sub="Current execution"
          tone="green"
        />
        <Kpi
          label="Bids submitted"
          value={myBids.length}
          icon="Gavel"
          sub="Tender applications"
          tone="orange"
        />
        <Kpi
          label="Site reports"
          value={
            deliverables.filter((d) => mine.some((p) => p.id === d.projectId))
              .length
          }
          icon="ClipboardList"
          sub="Recorded deliverables"
        />
      </div>
      <div className="dashboard-grid">
        <section className="panel panel-wide">
          <SectionHead
            title="My construction assignments"
            desc="Only your assigned contracts are shown."
            action={
              <Button variant="light" to="/app/projects">
                See all projects
              </Button>
            }
          />
          {mine.length ? (
            <ProjectTable items={mine.slice(0, 6)} />
          ) : (
            <Empty
              title="No contracts assigned"
              description="Approved contracts will appear after assignment."
            />
          )}
        </section>
        <section className="panel quick-panel">
          <h3>Contractor actions</h3>
          {[
            ["Explore tenders", "/app/tenders", "Gavel"],
            ["Submit or review bids", "/app/bids", "BriefcaseBusiness"],
            [
              "Site progress and evidence",
              "/app/deliverables",
              "ClipboardCheck",
            ],
            ["Project documents", "/app/documents", "Files"],
          ].map(([t, path, icon]) => (
            <Link className="quick-link" to={path} key={path}>
              <Icon name={icon} />
              {t}
              <Icon name="ArrowUpRight" size={16} />
            </Link>
          ))}
        </section>
      </div>
      <section className="panel">
        <SectionHead
          title="My bid pipeline"
          desc="Submitted proposals and their current decisions."
        />
        {myBids.length ? (
          myBids.slice(0, 5).map((b) => (
            <div className="activity-entry" key={b.id}>
              <strong>{b.projectId || "Project tender"}</strong>
              <p>
                {money(b.amount)} · {b.status || "Under review"}
              </p>
            </div>
          ))
        ) : (
          <Empty
            title="No submitted bids yet"
            action={
              <Button to="/app/tenders" variant="light">
                Explore tenders
              </Button>
            }
          />
        )}
      </section>
    </>
  );
}
function AdministratorDashboard() {
  const { user } = useAuth();
  const projects = useCollection("projects");
  const properties = useCollection("properties");
  const tenants = useCollection("tenants");
  const assigned = projects.filter((p) => belongsToAdmin(p, user.id));
  const managed = properties.filter(
    (p) =>
      (p.adminIds || []).some((id) => String(id) === String(user.id)) ||
      assigned.some((a) => String(a.id) === String(p.projectId)),
  );
  const linked = tenants.filter((t) =>
    managed.some((p) => p.id === t.propertyId),
  );
  return (
    <>
      <div className="welcome">
        <div>
          <span className="eyebrow">PROFESSIONAL ADMIN WORKSPACE</span>
          <h1>My assigned responsibilities.</h1>
          <p>
            View only the work allocated to you by the Super Admin, organised by
            discipline and property.
          </p>
        </div>
        <Button to="/app/admin/profile" icon="BadgeCheck">
          My specialisations
        </Button>
      </div>
      <div className="kpi-grid">
        <Kpi
          label="Assigned projects"
          value={assigned.length}
          icon="FolderKanban"
          sub="Across your specialisations"
        />
        <Kpi
          label="Managed properties"
          value={managed.length}
          icon="House"
          sub="Under your supervision"
          tone="green"
        />
        <Kpi
          label="Property tenants"
          value={linked.length}
          icon="Users"
          sub="Linked tenancy records"
        />
        <Kpi
          label="Assigned roles"
          value={assigned.reduce(
            (n, p) => n + Math.max(1, assignmentsFor(p, user.id).length),
            0,
          )}
          icon="ListChecks"
          sub="You can manage multiple roles"
          tone="orange"
        />
      </div>
      {!user.profileCompleted && (
        <div className="notice">
          <Icon name="Info" /> Complete your professional specialisations
          profile to become eligible for new allocations.{" "}
          <Link to="/app/admin/profile">Update profile</Link>
        </div>
      )}
      <AdminPortfolio />
      <div className="dashboard-grid">
        <section className="panel">
          <SectionHead
            title="Managed properties and tenants"
            action={
              <Button to="/app/tenants" variant="light">
                Open tenancy records
              </Button>
            }
          />
          {managed.map((p) => (
            <div className="activity-entry" key={p.id}>
              <strong>{p.name}</strong>
              <p>
                {linked.filter((t) => t.propertyId === p.id).length} tenant
                records
              </p>
            </div>
          ))}
          {!managed.length && <Empty title="No properties allocated" />}
        </section>
        <section className="panel quick-panel">
          <h3>My operational tools</h3>
          {[
            ["Property financial records", "/app/property", "Wallet"],
            [
              "Assigned project verification",
              "/app/verifications",
              "BadgeCheck",
            ],
            ["Tenant and rent management", "/app/tenants", "House"],
            ["Project documentation", "/app/documents", "Files"],
          ].map(([t, path, icon]) => (
            <Link className="quick-link" key={path} to={path}>
              <Icon name={icon} />
              {t}
              <Icon name="ArrowUpRight" size={16} />
            </Link>
          ))}
        </section>
      </div>
    </>
  );
}
function SuperAdminDashboard() {
  const projects = useCollection("projects");
  const users = useCollection("users");
  const tenants = useCollection("tenants");
  const pending = projects.filter(
    (p) =>
      p.approvalStatus === "Pending" ||
      (!p.approvalStatus &&
        ["Draft", "Under review", "Pending"].includes(p.status)),
  );
  const awaitingAllocation = projects.filter(
    (p) =>
      p.approvalStatus === "Approved" && !(p.adminAssignments || []).length,
  );
  return (
    <>
      <div className="welcome">
        <div>
          <span className="eyebrow">SUPER ADMIN CONTROL CENTRE</span>
          <h1>Platform oversight and authorisations.</h1>
          <p>
            Review client requests, approve professional roles and allocate work
            across Bautek.
          </p>
        </div>
        <Button to="/app/allocations" icon="ShieldCheck">
          Approve and allocate
        </Button>
      </div>
      <div className="kpi-grid">
        <Kpi
          label="Pending client projects"
          value={pending.length}
          icon="Clock"
          sub="Awaiting your decision"
          tone="orange"
        />
        <Kpi
          label="Unallocated approvals"
          value={awaitingAllocation.length}
          icon="ListChecks"
          sub="Need professional assignment"
        />
        <Kpi
          label="Platform accounts"
          value={users.length}
          icon="Users"
          sub="Registered system users"
          tone="green"
        />
        <Kpi
          label="Tenant removal requests"
          value={tenants.filter((t) => t.status === "Removal requested").length}
          icon="UserX"
          sub="Awaiting final review"
          tone="purple"
        />
      </div>
      <div className="dashboard-grid">
        <section className="panel panel-wide">
          <SectionHead
            title="Client requests awaiting approval"
            action={
              <Button to="/app/allocations" variant="light">
                Decide and assign
              </Button>
            }
          />
          {pending.length ? (
            <ProjectTable items={pending.slice(0, 6)} />
          ) : (
            <Empty title="Approval queue is clear" />
          )}
        </section>
        <section className="panel quick-panel">
          <h3>Governance actions</h3>
          {[
            ["Projects and allocation", "/app/allocations", "ClipboardCheck"],
            ["Users and roles", "/app/users", "Users"],
            ["Issue invitations", "/app/invitations", "MailPlus"],
            [
              "Contractor applications",
              "/app/contractor-applications",
              "HardHat",
            ],
            ["Tenant assignments", "/app/tenant-assignments", "HousePlus"],
            ["Tenant removals", "/app/tenants", "UserX"],
            ["Audit activity", "/app/audit", "ScrollText"],
          ].map(([t, path, icon]) => (
            <Link className="quick-link" key={path} to={path}>
              <Icon name={icon} />
              {t}
              <Icon name="ArrowUpRight" size={16} />
            </Link>
          ))}
        </section>
      </div>
      <section className="panel">
        <SectionHead
          title="Approved projects still awaiting allocation"
          desc="Assign as many specialist administrators as each project needs."
        />
        {awaitingAllocation.map((p) => (
          <div className="verification-row" key={p.id}>
            <div>
              <strong>{p.name}</strong>
              <p>
                {p.type} · {p.county}
              </p>
            </div>
            <Button to="/app/allocations" variant="light">
              Allocate
            </Button>
          </div>
        ))}
        {!awaitingAllocation.length && (
          <Empty title="No unallocated approvals" />
        )}
      </section>
    </>
  );
}
function ContractorApplication() {
  const { user, demo } = useAuth();
  const applications = useCollection("contractorApplications");
  const existing = applications.filter(
    (a) => String(a.applicantId) === String(user.id),
  );
  const [company, setCompany] = useState("");
  const [specialty, setSpecialty] = useState("Construction management");
  const [experience, setExperience] = useState("");
  const [qualification, setQualification] = useState("");
  const [registration, setRegistration] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    const payload = {
      applicantId: user.id,
      companyName: company,
      specialty,
      yearsExperience: Number(experience || 0),
      qualifications: qualification,
      registrationNumber: registration,
      notes: details,
    };
    try {
      if (demo) {
        writeRecord("contractorApplications", {
          ...payload,
          id: `APP-${Date.now()}`,
          status: "Pending",
          createdAt: new Date().toISOString(),
        });
        setMessage(
          "Demo application saved locally. No real approval has been issued.",
        );
      } else {
        await apiRequest("/contractor-applications", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        notifyCollections();
        setMessage("Application submitted for Super Admin review.");
      }
    } catch (error) {
      setMessage(
        `Application not submitted: ${error.message}. The backend needs the contractor-applications endpoint.`,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SectionHead
        eyebrow="CONTRACTOR REGISTRATION"
        title="Apply to work with Bautek"
        desc="Contractor applications require credentials and Super Admin approval; applying does not automatically grant contractor access."
      />
      <ActionNotice
        message={message}
        error={/failed|unsuccessful|unavailable|not submitted|not issued/i.test(
          message,
        )}
      />
      {existing.map((a) => (
        <div className="panel" key={a.id}>
          <strong>Application: {a.companyName}</strong>{" "}
          <Tag tone={statusTone(a.status)}>{a.status}</Tag>
          <p>
            {a.specialty} · {a.qualifications}
          </p>
        </div>
      ))}
      {existing.some((a) => a.status === "Pending") && (
        <div className="notice">
          Your contractor application is pending review. You cannot submit
          another until a decision is made.
        </div>
      )}
      <form className="panel form-grid" onSubmit={submit}>
        <label>
          Company or trading name
          <input
            required
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        </label>
        <label>
          Primary speciality
          <select
            value={specialty}
            onChange={(e) => setSpecialty(e.target.value)}
          >
            {SPECIALTIES.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Years of experience
          <input
            type="number"
            min="0"
            required
            value={experience}
            onChange={(e) => setExperience(e.target.value)}
          />
        </label>
        <label>
          Professional registration / licence
          <input
            value={registration}
            onChange={(e) => setRegistration(e.target.value)}
          />
        </label>
        <label className="span-2">
          Qualifications and relevant experience
          <textarea
            required
            rows="3"
            value={qualification}
            onChange={(e) => setQualification(e.target.value)}
          />
        </label>
        <label className="span-2">
          Additional details
          <textarea
            rows="3"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
          />
        </label>
        <div>
          <Button
            type="submit"
            disabled={busy || existing.some((a) => a.status === "Pending")}
          >
            {busy ? "Submitting…" : "Submit contractor application"}
          </Button>
        </div>
      </form>
      <div className="notice">
        <Icon name="ShieldAlert" /> Contractor applications are reviewed by the
        Super Admin. Approval requires independent verification of the
        credentials supplied.
      </div>
    </>
  );
}
function ContractorApplicationsReview() {
  const { demo } = useAuth();
  const applications = useCollection("contractorApplications");
  const users = useCollection("users");
  const [filter, setFilter] = useState("Pending");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState("");
  const [reasons, setReasons] = useState({});
  const [confirmation, setConfirmation] = useState(null);
  const visible = applications.filter(
    (a) => filter === "All" || a.status === filter,
  );
  const decide = async (application, decision) => {
    if (busy) return;
    if (confirmation !== `${application.id}:${decision}`) {
      setConfirmation(`${application.id}:${decision}`);
      setFeedback(
        `Review your decision, then click ${decision.toLowerCase()} again to confirm.`,
      );
      setError(false);
      return;
    }
    setConfirmation(null);
    setBusy(application.id);
    setFeedback("");
    try {
      if (demo) {
        updateItem("contractorApplications", application.id, {
          status: decision,
          reviewedAt: new Date().toISOString(),
          reviewReason: reasons[application.id] || "",
        });
        if (decision === "Approved")
          updateItem("users", application.applicantId, { role: "contractor" });
        setFeedback(`Demo application ${decision.toLowerCase()} locally.`);
      } else {
        const result = await apiRequest(
          `/contractor-applications/${encodeURIComponent(application.id)}/decision`,
          {
            method: "PATCH",
            body: JSON.stringify({
              decision,
              reason: reasons[application.id] || "",
            }),
          },
        );
        if (!result?.data)
          throw new Error("Backend did not confirm the decision.");
        notifyCollections();
        setFeedback(
          `${application.companyName}: ${decision.toLowerCase()} successfully.`,
        );
      }
      setError(false);
    } catch (e) {
      setError(true);
      setFeedback(`Decision failed: ${e.message}`);
    } finally {
      setBusy("");
    }
  };
  return (
    <>
      <SectionHead
        eyebrow="SUPER ADMINISTRATOR"
        title="Contractor applications review"
        desc="Review qualifications, licences and experience before granting contractor access."
      />
      <ActionNotice message={feedback} error={error} />
      <div className="panel">
        <div className="filter-row">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            {["Pending", "Approved", "Rejected", "All"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <span className="muted">{visible.length} applications</span>
        </div>
        {visible.map((app) => {
          const person = users.find(
            (u) => String(u.id) === String(app.applicantId),
          );
          return (
            <div className="activity-entry" key={app.id}>
              <div className="section-head">
                <div>
                  <strong>{app.companyName}</strong>
                  <p>
                    {person?.name || app.applicantId} · {person?.email || ""}
                  </p>
                </div>
                <Tag tone={statusTone(app.status)}>{app.status}</Tag>
              </div>
              <div className="detail-list">
                <div>
                  <span>Specialty</span>
                  <strong>{app.specialty}</strong>
                </div>
                <div>
                  <span>Experience</span>
                  <strong>{app.yearsExperience} years</strong>
                </div>
                <div>
                  <span>Registration / licence</span>
                  <strong>{app.registrationNumber || "Not supplied"}</strong>
                </div>
                <div>
                  <span>Qualifications</span>
                  <strong>{app.qualifications}</strong>
                </div>
                <div>
                  <span>Additional information</span>
                  <strong>{app.notes || "None"}</strong>
                </div>
              </div>
              {app.status === "Pending" && (
                <>
                  <label>
                    Decision reason / review notes
                    <textarea
                      rows="2"
                      value={reasons[app.id] || ""}
                      onChange={(e) =>
                        setReasons((v) => ({ ...v, [app.id]: e.target.value }))
                      }
                    />
                  </label>
                  <div className="inline-actions">
                    <Button
                      disabled={!!busy}
                      onClick={() => decide(app, "Approved")}
                      icon="CheckCircle2"
                    >
                      {confirmation === `${app.id}:Approved`
                        ? "Confirm approval"
                        : "Approve"}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!!busy}
                      onClick={() => decide(app, "Rejected")}
                      icon="XCircle"
                    >
                      {confirmation === `${app.id}:Rejected`
                        ? "Confirm rejection"
                        : "Reject"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          );
        })}
        {!visible.length && <Empty title="No applications in this category" />}
      </div>
    </>
  );
}

function Invitations() {
  const { demo } = useAuth();
  const invitations = useCollection("invitations");
  const [filter, setFilter] = useState("All");
  const [revokeId, setRevokeId] = useState(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const revoke = async (invitation) => {
    if (revokeId !== invitation.id) {
      setRevokeId(invitation.id);
      setMessage("Click Confirm revoke to cancel the invitation.");
      return;
    }
    setRevokeBusy(true);
    try {
      if (demo) {
        updateItem("invitations", invitation.id, { status: "Revoked" });
      } else {
        const result = await apiRequest(
          `/invitations/${encodeURIComponent(invitation.id)}/revoke`,
          { method: "PATCH" },
        );
        if (!result?.data)
          throw new Error("Backend did not confirm revocation");
        notifyCollections();
      }
      setMessage(`Invitation for ${invitation.email} revoked.`);
    } catch (e) {
      setMessage(`Revoke failed: ${e.message}`);
    } finally {
      setRevokeBusy(false);
      setRevokeId(null);
    }
  };
  const properties = useCollection("properties");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("admin");
  const [propertyId, setPropertyId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (e) => {
    e.preventDefault();
    setMessage("");
    setBusy(true);
    try {
      if (demo) {
        addItem("invitations", {
          id: `INV-${Date.now()}`,
          email,
          role,
          propertyId: role === "tenant" ? propertyId : null,
          status: "Pending",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 48 * 3600000).toISOString(),
        });
        setMessage(`Demo invitation recorded for ${email}. No email was sent.`);
        setEmail("");
      } else {
        await apiRequest("/invitations", {
          method: "POST",
          body: JSON.stringify({
            email,
            role,
            ...(role === "tenant" ? { propertyId } : {}),
          }),
        });
        notifyCollections();
        setMessage(`Invitation sent to ${email}.`);
        setEmail("");
      }
    } catch (err) {
      setMessage(
        `Invitation not issued: ${err.message}. The backend needs an invitation endpoint and email delivery.`,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SectionHead
        eyebrow="SUPER ADMINISTRATOR"
        title="Invite administrators and tenants"
        desc="Admins receive a professional-profile invitation; tenants receive an invitation linked to their property. Super Admin accounts cannot be invited from the public website."
      />
      <ActionNotice
        message={message}
        error={/failed|unsuccessful|unavailable|not submitted|not issued/i.test(
          message,
        )}
      />
      <form className="panel form-grid" onSubmit={send}>
        <label>
          Email address
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Invitation type
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="admin">Administrator</option>
            <option value="tenant">Tenant</option>
          </select>
        </label>
        {role === "tenant" && (
          <label>
            Property
            <select
              required
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
            >
              <option value="">Choose property</option>
              {properties.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div>
          <Button type="submit" disabled={busy} icon="MailPlus">
            {busy ? "Sending…" : "Issue invitation"}
          </Button>
        </div>
      </form>
      <section className="panel">
        <SectionHead
          title="Invitation management"
          desc="Review invitation status and revoke invitations sent in error."
        />
        <div className="filter-row">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            {["All", "Pending", "Accepted", "Expired", "Revoked"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </div>
        {invitations
          .filter((inv) => {
            const status =
              inv.status === "Pending" && new Date(inv.expiresAt) < new Date()
                ? "Expired"
                : inv.status;
            return filter === "All" || status === filter;
          })
          .map((inv) => {
            const expired =
              inv.status === "Pending" && new Date(inv.expiresAt) < new Date();
            const status = expired ? "Expired" : inv.status;
            return (
              <div className="verification-row" key={inv.id}>
                <div>
                  <strong>{inv.email}</strong>
                  <p>
                    {inv.role}{" "}
                    {inv.propertyId ? `· Property ${inv.propertyId}` : ""} ·
                    Expires {inv.expiresAt ? dateString(inv.expiresAt) : "N/A"}
                  </p>
                </div>
                <Tag tone={statusTone(status)}>{status}</Tag>
                {inv.status === "Pending" && !expired && (
                  <Button
                    variant="outline"
                    disabled={revokeBusy}
                    onClick={() => revoke(inv)}
                  >
                    {revokeId === inv.id ? "Confirm revoke" : "Revoke"}
                  </Button>
                )}
              </div>
            );
          })}
        {!invitations.length && <Empty title="No invitations yet" />}
      </section>
      <div className="notice">
        <Icon name="Info" /> Live invitations are sent by the configured backend
        email service. In demo mode no real email is sent.
      </div>
    </>
  );
}
function InvitationActivation() {
  const location = useLocation();
  const navigate = useNavigate();
  const token = new URLSearchParams(location.search).get("token") || "";
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const activate = async (e) => {
    e.preventDefault();
    setError("");
    if (!token) return setError("An invitation token is required.");
    setBusy(true);
    try {
      if (!API_BASE)
        throw new Error("Connect the backend API to activate invitations.");
      await apiRequest("/auth/invitations/accept", {
        method: "POST",
        body: JSON.stringify({ token, name, password }),
      });
      navigate("/login", {
        state: {
          notice:
            "Your invitation was accepted. Sign in with your new account.",
        },
      });
    } catch (err) {
      setError(
        `Activation unavailable: ${err.message}. The backend invitation-acceptance route must be implemented.`,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-shell">
      <div className="auth-aside">
        <Link to="/" className="brand brand-white">
          <span className="brand-mark">
            <Icon name="Landmark" />
          </span>
          <span>
            BAUTEK <strong>FLINK</strong>
          </span>
        </Link>
        <div>
          <span className="eyebrow">SECURE INVITATION</span>
          <h1>Join your Bautek workspace.</h1>
          <p>
            Administrator and tenant access is approved and linked to your
            invitation.
          </p>
        </div>
      </div>
      <div className="auth-content">
        <div className="auth-form">
          <span className="eyebrow">ACCOUNT ACTIVATION</span>
          <h2>Activate your invitation</h2>
          <p>
            Set your name and password. Your role and property permissions are
            determined by the secure backend invitation.
          </p>
          {error && <div className="error-box">{error}</div>}
          {!token && (
            <div className="notice">
              Use the activation link sent to your email address.
            </div>
          )}
          <form onSubmit={activate}>
            <label>
              Full name
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Password
              <input
                required
                type="password"
                minLength={10}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <Button type="submit" disabled={busy || !token}>
              {busy ? "Activating…" : "Activate account"}
            </Button>
          </form>
          <Link to="/login">Already activated? Sign in</Link>
        </div>
      </div>
    </div>
  );
}
function Projects() {
  const { user } = useAuth();
  const all = useCollection("projects");
  const [filter, setFilter] = useState("All");
  const [q, setQ] = useState("");
  const visible = all
    .filter((x) =>
      user.role === "client"
        ? x.ownerId === user.id
        : user.role === "contractor"
          ? x.contractor === "Amani Build Co."
          : user.role === "admin"
            ? belongsToAdmin(x, user.id)
            : true,
    )
    .filter(
      (x) =>
        (filter === "All" || x.status === filter) &&
        [x.name, x.county, x.id]
          .join(" ")
          .toLowerCase()
          .includes(q.toLowerCase()),
    );
  return (
    <>
      <SectionHead
        eyebrow="PROJECTS"
        title={
          user.role === "client"
            ? "My projects"
            : user.role === "contractor"
              ? "Assigned projects"
              : "Project oversight"
        }
        desc="See scope, milestones, budgets, evidence and project history."
        action={
          user.role === "client" ? (
            <Button to="/app/projects/new" icon="Plus">
              New project
            </Button>
          ) : null
        }
      />
      <div className="panel">
        <div className="filter-row">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search project or location"
          />
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            {[
              "All",
              "Active",
              "Under review",
              "Completed",
              "Cancelled",
              "Draft",
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </div>
        {visible.length ? (
          <ProjectTable items={visible} />
        ) : (
          <Empty
            title="No matching projects"
            description="Try adjusting your search or filter."
          />
        )}
      </div>
    </>
  );
}
function ProjectDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const all = useCollection("projects");
  const project = all.find((p) => p.id === id);
  const allowed =
    project &&
    (user.role === "client"
      ? project.ownerId === user.id
      : user.role === "contractor"
        ? project.contractor === "Amani Build Co."
        : user.role === "admin"
          ? belongsToAdmin(project, user.id)
          : true);
  const [note, setNote] = useState("");
  const [cancelPrompt, setCancelPrompt] = useState(false);
  if (!allowed)
    return (
      <Empty
        title="Project unavailable"
        description="This project doesn't exist or you don't have access."
      />
    );
  function cancel() {
    if (!cancelPrompt) {
      setCancelPrompt(true);
      return;
    }
    setCancelPrompt(false);
    patchRecord("projects", project.id, {
      status: "Cancelled",
      updated: today(),
    });
    audit(user, "PROJECT_CANCEL_REQUEST", project.id);
  }
  return (
    <>
      <div className="back-line">
        <Link to="/app/projects">
          <Icon name="ArrowLeft" size={17} /> Projects
        </Link>
      </div>
      <div className="section-head">
        <div>
          <span className="eyebrow">{project.id}</span>
          <h2>{project.name}</h2>
          <p>
            {project.county} · {project.type} · {project.contractor}
          </p>
        </div>
        <Tag tone={statusTone(project.status)}>{project.status}</Tag>
      </div>
      <div className="kpi-grid">
        <Kpi
          label="Total budget"
          value={money(project.budget)}
          icon="Wallet"
          sub="Estimated project value"
        />
        <Kpi
          label="Completion"
          value={`${project.progress}%`}
          icon="ChartNoAxesCombined"
          sub="Based on recorded milestones"
          tone="green"
        />
        <Kpi
          label="Delivery model"
          value={project.delivery === "direct" ? "Bautek" : "Supervised"}
          icon="HardHat"
          sub="Selected project structure"
        />
        <Kpi
          label="Last updated"
          value={dateString(project.updated)}
          icon="CalendarDays"
          sub="Most recent project activity"
        />
      </div>
      <div className="dashboard-grid">
        <div className="panel">
          <SectionHead
            title="Milestone tracker"
            desc="Stages and approvals must be confirmed by the responsible team."
          />
          {(project.type === "land"
            ? stages
            : [
                "Assessment",
                "Design & budgeting",
                "Approvals",
                "Procurement",
                "Execution",
                "Inspection",
                "Handover",
              ]
          ).map((s, i, arr) => {
            const complete = project.progress >= ((i + 1) / arr.length) * 100;
            return (
              <div className="milestone" key={s}>
                <span
                  className={complete ? "milestone-done" : "milestone-pending"}
                >
                  <Icon name={complete ? "Check" : "Circle"} size={15} />
                </span>
                <div>
                  <strong>{s}</strong>
                  <p>
                    {complete
                      ? "Stage recorded as completed in demo progress"
                      : "Awaiting verified update"}
                  </p>
                </div>
                <Tag tone={complete ? "green" : "neutral"}>
                  {complete ? "Recorded" : "Pending"}
                </Tag>
              </div>
            );
          })}
        </div>
        <div className="panel">
          <SectionHead
            title="Project controls"
            desc="Approvals and disbursements require real verification."
          />
          <div className="detail-list">
            <div>
              <span>Project owner</span>
              <strong>
                {project.ownerId === "demo-client"
                  ? "Grace Achieng"
                  : project.ownerId}
              </strong>
            </div>
            <div>
              <span>Delivery team</span>
              <strong>{project.contractor}</strong>
            </div>
            <div>
              <span>Start date</span>
              <strong>{dateString(project.createdAt)}</strong>
            </div>
            <div>
              <span>Estimated service fee</span>
              <strong>
                {project.type === "property"
                  ? "Agreement required"
                  : money(
                      Number(project.budget) *
                        (project.type === "land"
                          ? project.delivery === "direct"
                            ? 0.05
                            : 0.03
                          : project.delivery === "direct"
                            ? 0.1
                            : 0.05),
                    )}
              </strong>
            </div>
          </div>
          {user.role === "client" &&
            project.status !== "Cancelled" &&
            project.status !== "Completed" && (
              <Button variant="outline" onClick={cancel} icon="Ban">
                {cancelPrompt
                  ? "Confirm cancellation request"
                  : "Request cancellation"}
              </Button>
            )}
          <div className="notice small-notice">
            <Icon name="Info" size={16} /> A cancellation request is not a
            refund confirmation. Your backend must apply contract terms and
            approval controls.
          </div>
        </div>
      </div>
      <section className="panel">
        <SectionHead
          title="Evidence and site activity"
          desc="Updates submitted by contractors and site staff."
        />
        {getItem("deliverables").filter((x) => x.projectId === id).length ? (
          getItem("deliverables")
            .filter((x) => x.projectId === id)
            .map((x) => (
              <div className="activity-entry" key={x.id}>
                <strong>{x.title}</strong>
                <span>
                  {x.date} · {x.workers || 0} site workers
                </span>
                <p>{x.description}</p>
              </div>
            ))
        ) : (
          <Empty
            title="No evidence submitted"
            description="Site records will appear here once added by the assigned team."
          />
        )}
      </section>
    </>
  );
}
function ProjectWizard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [data, setData] = useState({
    type: "land",
    title: "",
    country: "Kenya",
    county: "",
    subcounty: "",
    ward: "",
    size: "",
    details: "",
    delivery: "direct",
    budget: "",
    funding: "ready",
    contractorName: "",
    contactPreference: "",
    agree: false,
  });
  const patch = (k, v) => setData((x) => ({ ...x, [k]: v }));
  const service = services.find((x) => x.id === data.type);
  const feeRate =
    data.type === "property"
      ? 0
      : data.delivery === "direct"
        ? service.direct
        : service.supervise;
  const management = data.type === "property";
  const land = data.type === "land";
  const landPrice = Number(data.budget || 0);
  const landCharges = land
    ? {
        legal: landPrice * 0.03,
        valuation: landPrice * 0.005,
        survey: landPrice * 0.01,
        transfer: landPrice * 0.02,
        search: 10000,
        taxes: landPrice * 0.04,
      }
    : null;
  const extra = land
    ? Object.values(landCharges).reduce((a, b) => a + b, 0)
    : 0;
  const fee = management ? 0 : landPrice * feeRate;
  const total = landPrice + extra + fee;
  function validate() {
    if (step === 0) return !!data.type;
    if (step === 1) return !!data.title.trim() && !!data.county;
    if (step === 2)
      return data.delivery === "direct" || !!data.contractorName.trim();
    if (step === 3) return management || landPrice > 0;
    return data.agree;
  }
  function save() {
    if (!validate()) return;
    const id = "PRJ-" + Date.now().toString().slice(-8);
    writeRecord("projects", {
      id,
      name: data.title,
      type: data.type,
      county: data.county,
      budget: landPrice,
      status: "Under review",
      approvalStatus: "Pending",
      adminAssignments: [],
      progress: 0,
      ownerId: user.id,
      contractor:
        data.delivery === "direct" ? "Bautek Flink Ltd" : data.contractorName,
      updated: today(),
      createdAt: today(),
      delivery: data.delivery,
      details: data,
      visibility: "private",
    });
    audit(user, "PROJECT_SUBMITTED_FOR_APPROVAL", id);
    nav(`/app/projects/${id}`);
  }
  return (
    <>
      <SectionHead
        eyebrow="START A PROJECT"
        title="Tell us what you want to build."
        desc="A guided request that adapts to your project's needs. No payment will be requested in this preview."
      />
      <div className="wizard-layout">
        <div className="panel wizard-main">
          <div className="stepper">
            {steps.map((s, i) => (
              <div
                key={s}
                className={`step ${i === step ? "current" : i < step ? "complete" : ""}`}
              >
                <span>
                  {i < step ? <Icon name="Check" size={15} /> : i + 1}
                </span>
                <small>{s}</small>
              </div>
            ))}
          </div>
          {step === 0 && (
            <>
              <h3>What kind of project do you have in mind?</h3>
              <p className="muted">
                Select the service that best describes your goal.
              </p>
              <div className="choice-grid">
                {services.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => patch("type", s.id)}
                    className={`choice ${data.type === s.id ? "selected" : ""}`}
                  >
                    <Icon name={s.icon} size={24} />
                    <strong>{s.name}</strong>
                    <span>{s.desc}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <h3>Where and what is your project?</h3>
              <p className="muted">
                Only share location details you are comfortable providing at
                this stage.
              </p>
              <div className="form-grid">
                <label className="span-2">
                  Project name
                  <input
                    value={data.title}
                    onChange={(e) => patch("title", e.target.value)}
                    placeholder="e.g. My family home in Kisumu"
                    required
                  />
                </label>
                <label>
                  Country
                  <input
                    value={data.country}
                    onChange={(e) => patch("country", e.target.value)}
                  />
                </label>
                <label>
                  County
                  <select
                    value={data.county}
                    onChange={(e) => patch("county", e.target.value)}
                  >
                    <option value="">Select county</option>
                    {counties.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Sub-county (optional)
                  <input
                    placeholder="Any sub-county"
                    value={data.subcounty}
                    onChange={(e) => patch("subcounty", e.target.value)}
                  />
                </label>
                <label>
                  Ward (optional)
                  <input
                    placeholder="Any ward"
                    value={data.ward}
                    onChange={(e) => patch("ward", e.target.value)}
                  />
                </label>
                {land && (
                  <label className="span-2">
                    Preferred land size
                    <input
                      placeholder="e.g. 100 by 100 feet"
                      value={data.size}
                      onChange={(e) => patch("size", e.target.value)}
                    />
                  </label>
                )}
                <label className="span-2">
                  Tell us about your requirements
                  <textarea
                    rows="4"
                    placeholder="Describe your goals, existing site, materials, priorities or special requirements"
                    value={data.details}
                    onChange={(e) => patch("details", e.target.value)}
                  />
                </label>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <h3>Who should carry out the work?</h3>
              <p className="muted">
                Bautek can deliver the project directly or independently
                supervise your chosen provider.
              </p>
              <div className="delivery-choices">
                <button
                  className={`delivery-choice ${data.delivery === "direct" ? "selected" : ""}`}
                  onClick={() => patch("delivery", "direct")}
                >
                  <Icon name="BadgeCheck" size={25} />
                  <strong>Bautek delivers the project</strong>
                  <p>Our team manages delivery and technical execution.</p>
                  <b>
                    {management
                      ? "Contract-based fee"
                      : `${(service.direct * 100).toFixed(0)}% professional fee`}
                  </b>
                </button>
                <button
                  className={`delivery-choice ${data.delivery === "supervise" ? "selected" : ""}`}
                  onClick={() => patch("delivery", "supervise")}
                >
                  <Icon name="Eye" size={25} />
                  <strong>Independent supervision</strong>
                  <p>
                    Use another contractor while Bautek verifies progress and
                    compliance.
                  </p>
                  <b>
                    {management
                      ? "Not applicable for property management"
                      : `${(service.supervise * 100).toFixed(0)}% supervision fee`}
                  </b>
                </button>
              </div>
              {data.delivery === "supervise" && (
                <label className="form-single">
                  Contractor or company name
                  <input
                    placeholder="Name of contractor, or 'To be selected through bids'"
                    value={data.contractorName}
                    onChange={(e) => patch("contractorName", e.target.value)}
                  />
                </label>
              )}
            </>
          )}
          {step === 3 && (
            <>
              <h3>Set your budget and funding preference</h3>
              <p className="muted">
                Estimates are illustrative, subject to verification and formal
                quotation.
              </p>
              <div className="form-grid">
                <label className="span-2">
                  {management
                    ? "Estimated annual property income (KES)"
                    : "Estimated project or land purchase budget (KES)"}
                  <input
                    type="number"
                    min="0"
                    value={data.budget}
                    onChange={(e) => patch("budget", e.target.value)}
                    placeholder="Enter an amount"
                  />
                </label>
                <label className="span-2">
                  How would you like to fund it?
                  <select
                    value={data.funding}
                    onChange={(e) => patch("funding", e.target.value)}
                  >
                    <option value="ready">I am financially ready</option>
                    <option value="save">
                      I want to plan savings with a partner bank
                    </option>
                  </select>
                </label>
              </div>
              {data.funding === "save" && (
                <div className="notice">
                  <Icon name="Landmark" /> Bank escrow/savings integration is
                  not active. Any savings agreement must be made directly with
                  an authorised bank.
                </div>
              )}
              {land && (
                <div className="estimate-list">
                  {Object.entries(landCharges).map(([k, v]) => (
                    <div key={k}>
                      <span>
                        {
                          {
                            legal: "Legal fees (3%)",
                            valuation: "Valuation (0.5%)",
                            survey: "Survey (1%)",
                            transfer: "Transfer/registration (2%)",
                            search: "Search and verification",
                            taxes: "Illustrative statutory charges (4%)",
                          }[k]
                        }
                      </span>
                      <b>{money(v)}</b>
                    </div>
                  ))}
                </div>
              )}
              <div className="notice">
                <Icon name="Info" /> These are user-supplied pricing
                assumptions, not verified tax or statutory charges. Confirm all
                actual fees with qualified professionals.
              </div>
            </>
          )}
          {step === 4 && (
            <>
              <h3>Review your project request</h3>
              <div className="review-grid">
                {[
                  ["Project", data.title],
                  ["Service", service.name],
                  [
                    "Location",
                    [data.county, data.subcounty, data.ward]
                      .filter(Boolean)
                      .join(", "),
                  ],
                  [
                    "Delivery",
                    data.delivery === "direct"
                      ? "Bautek delivery"
                      : "Independent supervision",
                  ],
                  ["Base budget", money(data.budget)],
                  ["Estimated additional land costs", money(extra)],
                  [
                    "Estimated Bautek fee",
                    management ? "Subject to property assessment" : money(fee),
                  ],
                  [
                    "Estimated combined amount",
                    management ? "Subject to proposal" : money(total),
                  ],
                  [
                    "Funding",
                    data.funding === "ready" ? "Ready now" : "Planning savings",
                  ],
                ].map(([k, v]) => (
                  <div key={k}>
                    <span>{k}</span>
                    <strong>{v || "Not provided"}</strong>
                  </div>
                ))}
              </div>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={data.agree}
                  onChange={(e) => patch("agree", e.target.checked)}
                />{" "}
                I understand this creates a draft request only. Fees,
                availability, title verification, payments and contract terms
                require further confirmation.
              </label>
            </>
          )}
          <div className="wizard-actions">
            <Button
              variant="light"
              onClick={() =>
                step === 0 ? nav("/app/client") : setStep(step - 1)
              }
              icon="ArrowLeft"
            >
              {step === 0 ? "Cancel" : "Back"}
            </Button>
            <Button
              onClick={() => (step === 4 ? save() : setStep(step + 1))}
              disabled={!validate()}
            >
              {step === 4 ? "Save project draft" : "Continue"}{" "}
              <Icon name="ArrowRight" size={16} />
            </Button>
          </div>
        </div>
        <aside className="panel estimate-panel">
          <span className="eyebrow">LIVE PROJECT ESTIMATE</span>
          <h3>{service.name}</h3>
          <div className="estimate-row">
            <span>Base budget</span>
            <strong>{money(landPrice)}</strong>
          </div>
          {land && (
            <div className="estimate-row">
              <span>Other acquisition costs</span>
              <strong>{money(extra)}</strong>
            </div>
          )}
          <div className="estimate-row">
            <span>Bautek professional fee</span>
            <strong>{management ? "To be assessed" : money(fee)}</strong>
          </div>
          <div className="estimate-total">
            <span>Estimated total</span>
            <strong>{management ? "By proposal" : money(total)}</strong>
          </div>
          <div className="estimate-note">
            <Icon name="ShieldCheck" size={18} /> A formal agreement and
            independent verification are required before any real payment.
          </div>
        </aside>
      </div>
    </>
  );
}
function Marketplace() {
  const { user } = useAuth();
  const listings = useCollection("listings");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    category: "Land",
    county: "Kisumu",
    price: "",
    description: "",
  });
  const [filter, setFilter] = useState("");
  const clean = (s) =>
    s.replace(
      /(?:\+?\d[\d\s().-]{7,}\d)|(?:[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/g,
      "[contact removed]",
    );
  const matches = listings.filter(
    (x) =>
      (user.role === "admin" ||
        user.role === "super_admin" ||
        x.status === "Published") &&
      [x.title, x.county].join("").toLowerCase().includes(filter.toLowerCase()),
  );
  function submit(e) {
    e.preventDefault();
    const id = "LST-" + Date.now();
    writeRecord("listings", {
      ...form,
      title: clean(form.title),
      description: clean(form.description),
      price: Number(form.price),
      id,
      author: user.name,
      status: "Pending",
      likes: 0,
      createdAt: today(),
    });
    audit(user, "LISTING_SUBMITTED", id);
    setOpen(false);
    setForm({
      title: "",
      category: "Land",
      county: "Kisumu",
      price: "",
      description: "",
    });
  }
  return (
    <>
      <SectionHead
        eyebrow="MARKETPLACE"
        title={
          user.role === "admin" || user.role === "super_admin"
            ? "Marketplace moderation"
            : "Community marketplace"
        }
        desc="Discover opportunities without exchanging private contact information."
        action={
          <Button onClick={() => setOpen((v) => !v)} icon="Plus">
            Post a listing
          </Button>
        }
      />
      {open && (
        <div className="panel form-panel">
          <h3>Create a marketplace listing</h3>
          <div className="notice">
            <Icon name="ShieldAlert" /> Do not include phone numbers or email
            addresses in text, photos or videos. Text contact details are
            filtered in the preview; production requires server-side text and
            image moderation.
          </div>
          <form onSubmit={submit} className="form-grid">
            <label className="span-2">
              Item title
              <input
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label>
              Category
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                {[
                  "Land",
                  "House",
                  "Car",
                  "Livestock",
                  "Furniture",
                  "Machinery",
                  "Other",
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              County
              <select
                value={form.county}
                onChange={(e) => setForm({ ...form, county: e.target.value })}
              >
                {counties.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Asking price (KES)
              <input
                type="number"
                required
                min="0"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </label>
            <label className="span-2">
              Description
              <textarea
                required
                rows="3"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </label>
            <div>
              <Button type="submit">Submit for review</Button>
            </div>
          </form>
        </div>
      )}
      <div className="panel">
        <div className="filter-row">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search listings…"
          />
        </div>
        <div className="listing-grid app-listings">
          {matches.map((x, i) => (
            <div className="listing-card" key={x.id}>
              <div className={`listing-image image-${i % 4}`}>
                <Icon
                  name={
                    x.category === "Land"
                      ? "MapPinned"
                      : x.category === "Machinery"
                        ? "Cog"
                        : "House"
                  }
                  size={37}
                />
              </div>
              <div className="listing-content">
                <Tag tone={statusTone(x.status)}>{x.status}</Tag>
                <h3>{x.title}</h3>
                <p>{x.county} County</p>
                <strong>{money(x.price)}</strong>
                {(user.role === "admin" || user.role === "super_admin") &&
                  x.status === "Pending" && (
                    <div className="inline-actions">
                      <Button
                        variant="light"
                        onClick={() => {
                          patchRecord("listings", x.id, {
                            status: "Published",
                          });
                          audit(user, "LISTING_APPROVED", x.id);
                        }}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          patchRecord("listings", x.id, { status: "Rejected" });
                          audit(user, "LISTING_REJECTED", x.id);
                        }}
                      >
                        Reject
                      </Button>
                    </div>
                  )}
              </div>
            </div>
          ))}
        </div>
        {!matches.length && <Empty title="No listings" />}
      </div>
    </>
  );
}
function Bids() {
  const { user } = useAuth();
  const bids = useCollection("bids");
  const projects = useCollection("projects");
  const [form, setForm] = useState({
    project: "",
    amount: "",
    description: "",
  });
  const [show, setShow] = useState(false);
  const eligible = projects.filter(
    (p) => p.status === "Under review" || p.status === "Active",
  );
  const visible =
    user.role === "client"
      ? bids.filter((b) =>
          projects.some((p) => p.id === b.project && p.ownerId === user.id),
        )
      : user.role === "contractor"
        ? bids.filter(
            (b) =>
              b.contractor === "Amani Build Co." || b.contractor === user.name,
          )
        : bids;
  function submit(e) {
    e.preventDefault();
    writeRecord("bids", {
      id: "BID-" + Date.now(),
      project: form.project,
      amount: Number(form.amount),
      contractor: user.name,
      status: "Under review",
      description: form.description,
      createdAt: today(),
    });
    audit(user, "BID_SUBMITTED", form.project);
    setShow(false);
  }
  return (
    <>
      <SectionHead
        eyebrow="CONTRACTORS & BIDS"
        title={
          user.role === "contractor" ? "My proposals" : "Contractor proposals"
        }
        desc="Contractor offers and decisions tied to project records."
        action={
          user.role === "contractor" ? (
            <Button icon="Plus" onClick={() => setShow(!show)}>
              Submit proposal
            </Button>
          ) : null
        }
      />
      {show && (
        <div className="panel form-panel">
          <h3>New contractor proposal</h3>
          <form className="form-grid" onSubmit={submit}>
            <label>
              Project
              <select
                required
                value={form.project}
                onChange={(e) => setForm({ ...form, project: e.target.value })}
              >
                <option value="">Select project</option>
                {eligible.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Quote (KES)
              <input
                type="number"
                min="1"
                required
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </label>
            <label className="span-2">
              Scope
              <textarea
                required
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </label>
            <div>
              <Button type="submit">Save proposal</Button>
            </div>
          </form>
          <p className="muted tiny">
            Demo proposals are local only. Production tender eligibility must be
            verified by the API.
          </p>
        </div>
      )}
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Proposal ID</th>
              <th>Project</th>
              <th>Contractor</th>
              <th>Quoted amount</th>
              <th>Status</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((x) => (
              <tr key={x.id}>
                <td>{x.id}</td>
                <td>
                  {projects.find((p) => p.id === x.project)?.name || x.project}
                </td>
                <td>{x.contractor}</td>
                <td>{money(x.amount)}</td>
                <td>
                  <Tag tone={statusTone(x.status)}>{x.status}</Tag>
                </td>
                <td>{dateString(x.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && <Empty title="No proposals available" />}
      </div>
    </>
  );
}
function Deliverables() {
  const { user } = useAuth();
  const projects = useCollection("projects");
  const items = useCollection("deliverables");
  const [form, setForm] = useState({
    projectId: "",
    title: "",
    description: "",
    workers: "",
    materials: "",
    start: "",
    end: "",
  });
  const eligible = projects.filter(
    (x) => x.contractor === "Amani Build Co." || user.role === "admin",
  );
  function submit(e) {
    e.preventDefault();
    const id = "DEL-" + Date.now();
    writeRecord("deliverables", {
      ...form,
      id,
      workers: Number(form.workers || 0),
      date: today(),
      author: user.name,
      status: "Submitted",
    });
    audit(user, "DELIVERABLE_SUBMITTED", id);
    setForm({
      projectId: "",
      title: "",
      description: "",
      workers: "",
      materials: "",
      start: "",
      end: "",
    });
  }
  return (
    <>
      <SectionHead
        eyebrow="SITE REPORTING"
        title="Daily deliverables"
        desc="Record work completed, personnel, materials and work hours. Evidence uploads require backend storage."
      />
      <div className="dashboard-grid">
        <section className="panel">
          <h3>Submit a daily update</h3>
          <form className="form-grid" onSubmit={submit}>
            <label className="span-2">
              Assigned project
              <select
                required
                value={form.projectId}
                onChange={(e) =>
                  setForm({ ...form, projectId: e.target.value })
                }
              >
                <option value="">Select project</option>
                {eligible.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="span-2">
              Work completed
              <input
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label className="span-2">
              Details
              <textarea
                required
                rows="3"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </label>
            <label>
              Workers on site
              <input
                type="number"
                min="0"
                value={form.workers}
                onChange={(e) => setForm({ ...form, workers: e.target.value })}
              />
            </label>
            <label>
              Materials used
              <input
                value={form.materials}
                onChange={(e) =>
                  setForm({ ...form, materials: e.target.value })
                }
              />
            </label>
            <label>
              Start time
              <input
                type="time"
                value={form.start}
                onChange={(e) => setForm({ ...form, start: e.target.value })}
              />
            </label>
            <label>
              End time
              <input
                type="time"
                value={form.end}
                onChange={(e) => setForm({ ...form, end: e.target.value })}
              />
            </label>
            <Button type="submit" icon="ClipboardCheck">
              Record update
            </Button>
          </form>
        </section>
        <section className="panel">
          <h3>Recent updates</h3>
          {items.length ? (
            items.slice(0, 10).map((x) => (
              <div className="activity-entry" key={x.id}>
                <strong>{x.title}</strong>
                <small>
                  {x.projectId} · {dateString(x.date)}
                </small>
                <p>{x.description}</p>
              </div>
            ))
          ) : (
            <Empty title="No site updates yet" />
          )}
        </section>
      </div>
    </>
  );
}
function Tenders() {
  const projects = useCollection("projects");
  const available = projects.filter((x) => x.status === "Under review");
  return (
    <>
      <SectionHead
        eyebrow="OPPORTUNITIES"
        title="Contractor tender board"
        desc="Open requests from clients seeking construction or land service providers."
      />
      <div className="three-grid">
        {available.map((x) => (
          <div className="panel" key={x.id}>
            <Tag tone="amber">Expression of interest</Tag>
            <h3>{x.name}</h3>
            <p>
              {x.county} · {x.type}
            </p>
            <h2>{money(x.budget)}</h2>
            <Button to="/app/bids" variant="light">
              Prepare bid <Icon name="ArrowRight" size={16} />
            </Button>
          </div>
        ))}
      </div>
      {!available.length && <Empty title="No open opportunities" />}
      <div className="notice">
        <Icon name="ShieldAlert" /> A public tender must be explicitly
        authorised by its owner. This demo board is illustrative; enforce
        project publication permissions on the backend.
      </div>
    </>
  );
}
function Property() {
  const { user } = useAuth();
  const propertyRecords = useCollection("properties");
  const projectRecords = useCollection("projects");
  const accessibleProperties = propertyRecords.filter((p) =>
    canSeeProperty(p, user, projectRecords),
  );
  const transactions = useCollection("transactions");
  const [range, setRange] = useState("all");
  const filtered = transactions
    .filter((x) => {
      const property = accessibleProperties.find(
        (p) => p.id === x.propertyId || p.name === x.property,
      );
      return Boolean(property);
    })
    .filter(
      (x) =>
        range === "all" ||
        (range === "month"
          ? x.date?.slice(0, 7) === new Date().toISOString().slice(0, 7)
          : x.date?.slice(0, 4) === new Date().getFullYear().toString()),
    );
  const inc = filtered
    .filter((x) => x.type === "Income")
    .reduce((a, x) => a + Number(x.amount), 0);
  const exp = filtered
    .filter((x) => x.type === "Expense")
    .reduce((a, x) => a + Number(x.amount), 0);
  const [form, setForm] = useState({
    type: "Expense",
    category: "Repairs",
    property: "Modern Rental Apartments",
    propertyId: "",
    amount: "",
    date: today(),
  });
  const [show, setShow] = useState(false);
  function submit(e) {
    e.preventDefault();
    if (!form.propertyId)
      return notifyAction("Select a property before recording a transaction.");
    const id = "TXN-" + Date.now();
    writeRecord("transactions", {
      ...form,
      id,
      amount: Number(form.amount),
      status: "Recorded",
    });
    audit(user, "PROPERTY_LEDGER_ENTRY", id);
    setShow(false);
  }
  return (
    <>
      <SectionHead
        eyebrow="PROPERTY MANAGEMENT"
        title="Income, expenses & statements"
        desc="An overview of rental income, operating costs and owner distributions."
        action={
          <Button
            variant="light"
            icon="Download"
            onClick={() => window.print()}
          >
            Print / save as PDF
          </Button>
        }
      />
      <PropertyInvestmentSummary />
      <div className="filter-row property-filters">
        <select value={range} onChange={(e) => setRange(e.target.value)}>
          <option value="all">Entire history</option>
          <option value="month">This month</option>
          <option value="year">This year</option>
        </select>
        <Button
          variant="outline"
          icon="FileSpreadsheet"
          onClick={() => exportCSV(filtered, "bautek-property-statement.csv")}
        >
          Export CSV
        </Button>
        {["admin", "super_admin"].includes(user.role) && (
          <Button icon="Plus" onClick={() => setShow((v) => !v)}>
            Record transaction
          </Button>
        )}
      </div>
      {show && (
        <div className="panel form-panel">
          <form className="form-grid" onSubmit={submit}>
            <label>
              Property
              <select
                required
                value={form.propertyId}
                onChange={(e) => {
                  const selected = accessibleProperties.find(
                    (p) => p.id === e.target.value,
                  );
                  setForm({
                    ...form,
                    propertyId: e.target.value,
                    property: selected?.name || "",
                  });
                }}
              >
                <option value="">Choose property</option>
                {accessibleProperties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Type
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                <option>Income</option>
                <option>Expense</option>
                <option value="Owner distribution">Owner distribution</option>
              </select>
            </label>
            <label>
              Category
              <input
                required
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
            </label>
            <label>
              Amount (KES)
              <input
                required
                type="number"
                min="1"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </label>
            <label>
              Date
              <input
                required
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </label>
            <Button type="submit">Record entry</Button>
          </form>
        </div>
      )}
      <div className="kpi-grid">
        <Kpi
          label="Recorded income"
          value={money(inc)}
          icon="ArrowDownToLine"
          sub="All recorded rental income"
          tone="green"
        />
        <Kpi
          label="Operating expenses"
          value={money(exp)}
          icon="ArrowUpFromLine"
          sub="Total cost entries"
          tone="orange"
        />
        <Kpi
          label="Net before fees"
          value={money(inc - exp)}
          icon="ChartNoAxesCombined"
          sub="Income less expenses"
        />
        <Kpi
          label="Illustrative net balance"
          value={money(inc - exp)}
          icon="Wallet"
          sub="Not an approved payout"
          tone="purple"
        />
      </div>
      <div className="panel">
        <SectionHead
          title="Transaction statement"
          desc="Based on local demo records. An audited backend ledger is required for official statements."
        />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Property</th>
                <th>Category</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((x) => (
                <tr key={x.id}>
                  <td>{dateString(x.date)}</td>
                  <td>{x.property}</td>
                  <td>{x.category}</td>
                  <td>
                    <Tag tone={x.type === "Income" ? "green" : "amber"}>
                      {x.type}
                    </Tag>
                  </td>
                  <td>{money(x.amount)}</td>
                  <td>{x.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
function Payments() {
  const { user } = useAuth();
  const transactions = useCollection("transactions");
  return (
    <>
      <SectionHead
        eyebrow="FINANCE"
        title={
          ["admin", "super_admin"].includes(user.role)
            ? "Financial oversight"
            : "Payments & receipts"
        }
        desc="Payment status, financial records and verified supporting documents."
      />
      <div className="notice">
        <Icon name="ShieldCheck" /> Live M-Pesa Daraja payments, escrow
        balances, refunds and receipts are not enabled in the frontend preview.
        The backend must confirm each transaction using trusted payment
        callbacks and immutable ledger entries.
      </div>
      <div className="kpi-grid">
        <Kpi
          label="Confirmed online payments"
          value="—"
          icon="CreditCard"
          sub="Connect Daraja backend"
        />
        <Kpi
          label="Pending payment requests"
          value="—"
          icon="Clock"
          sub="Requires payment service"
          tone="orange"
        />
        <Kpi
          label="Refund requests"
          value="—"
          icon="RefreshCcw"
          sub="Approval workflow required"
        />
        <Kpi
          label="Verified receipts"
          value="—"
          icon="ReceiptText"
          sub="Generated after backend confirmation"
          tone="green"
        />
      </div>
      <div className="panel">
        <SectionHead
          title="Financial activity"
          desc="Property ledger transactions available in this demonstration."
        />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Description</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((x) => (
                <tr key={x.id}>
                  <td>{x.id}</td>
                  <td>{x.category}</td>
                  <td>{dateString(x.date)}</td>
                  <td>{money(x.amount)}</td>
                  <td>
                    <Tag tone="green">{x.status}</Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
function Documents() {
  const { user } = useAuth();
  const docs = useCollection("documents");
  const [form, setForm] = useState({
    name: "",
    projectId: "",
    type: "Supporting document",
  });
  const projects = useCollection("projects").filter((x) =>
    user.role === "client"
      ? x.ownerId === user.id
      : user.role === "contractor"
        ? x.contractor === "Amani Build Co."
        : true,
  );
  function submit(e) {
    e.preventDefault();
    writeRecord("documents", {
      ...form,
      id: "DOC-" + Date.now(),
      ownerId: user.id,
      createdAt: today(),
      status: "Metadata only",
    });
    audit(user, "DOCUMENT_METADATA_ADDED", form.name);
    setForm({ name: "", projectId: "", type: "Supporting document" });
  }
  return (
    <>
      <SectionHead
        eyebrow="DOCUMENT CENTRE"
        title="Project documents"
        desc="A place for plans, receipts, agreements, certificates and verification reports."
      />
      <div className="notice">
        <Icon name="FileLock2" /> This preview stores document metadata only. It
        does not upload files. Production requires private object storage,
        malware scanning, signed access URLs and document-level authorisation.
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <h3>Prepare a document record</h3>
          <form className="form-grid" onSubmit={submit}>
            <label className="span-2">
              Document name
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              Type
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                {[
                  "Supporting document",
                  "Title deed",
                  "Contract",
                  "Bill of quantities",
                  "Inspection report",
                  "Completion certificate",
                  "Receipt",
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Project
              <select
                required
                value={form.projectId}
                onChange={(e) =>
                  setForm({ ...form, projectId: e.target.value })
                }
              >
                <option value="">Select project</option>
                {projects.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit">Add record</Button>
          </form>
        </section>
        <section className="panel">
          <h3>Document registry</h3>
          {docs.filter((d) =>
            user.role === "client"
              ? d.ownerId === user.id
              : user.role === "contractor"
                ? projects.some((x) => x.id === d.projectId)
                : true,
          ).length ? (
            docs
              .filter((d) =>
                user.role === "client"
                  ? d.ownerId === user.id
                  : user.role === "contractor"
                    ? projects.some((x) => x.id === d.projectId)
                    : true,
              )
              .map((x) => (
                <div className="doc-row" key={x.id}>
                  <Icon name="FileText" />
                  <div>
                    <strong>{x.name}</strong>
                    <small>
                      {x.type} · {x.projectId}
                    </small>
                  </div>
                  <Tag>{x.status}</Tag>
                </div>
              ))
          ) : (
            <Empty title="No documents yet" />
          )}
        </section>
      </div>
    </>
  );
}
function Messages() {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const messages = useCollection("messages");
  const own = messages.filter((x) => x.authorId === user.id);
  return (
    <>
      <SectionHead
        eyebrow="MESSAGING"
        title="Project conversations"
        desc="Communicate within Bautek while keeping private contact details protected."
      />
      <div className="panel">
        <div className="notice">
          <Icon name="MessageCircle" /> Preview notes are visible only in this
          browser. Real chat requires project-scoped backend permissions, secure
          delivery, moderation and retention controls.
        </div>
        <div className="message-board">
          {own.length ? (
            own.map((x) => (
              <div className="chat-bubble" key={x.id}>
                <strong>{x.author}</strong>
                <p>{x.text}</p>
                <small>{dateString(x.date)}</small>
              </div>
            ))
          ) : (
            <Empty
              title="No conversations started"
              description="Your project messages will appear here."
            />
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            const safe = text.replace(
              /(?:\+?\d[\d\s().-]{7,}\d)|(?:[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/g,
              "[contact removed]",
            );
            writeRecord("messages", {
              id: "MSG-" + Date.now(),
              author: user.name,
              authorId: user.id,
              text: safe,
              date: new Date().toISOString(),
            });
            setText("");
          }}
          className="message-form"
        >
          <input
            required
            placeholder="Write a demo note (no contact details)…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button type="submit" icon="Send">
            Send note
          </Button>
        </form>
      </div>
    </>
  );
}

// Each admin completes their own technical profile after promotion.
function AdminProfile() {
  const { user, demo, refreshUser } = useAuth();
  const users = useCollection("users");
  const [profileMessage, setProfileMessage] = useState("");
  const current = users.find((u) => String(u.id) === String(user.id)) || user;
  const [selected, setSelected] = useState(current.specialties || []);
  const [years, setYears] = useState(current.yearsExperience || "");
  const [registration, setRegistration] = useState(
    current.professionalRegistration || "",
  );
  const [bio, setBio] = useState(current.professionalBio || "");
  const [other, setOther] = useState(current.otherSpecialty || "");
  const toggle = (s) =>
    setSelected((v) => (v.includes(s) ? v.filter((x) => x !== s) : [...v, s]));
  return (
    <>
      <SectionHead
        eyebrow="PROFESSIONAL PROFILE"
        title="My specialisations"
        desc="Complete this profile so the super administrator can match assignments to your skills."
      />
      {!current.profileCompleted && (
        <div className="notice">
          <Icon name="Info" /> Your admin profile needs to be completed before
          you receive new assignments.
        </div>
      )}
      {profileMessage && (
        <div className="notice">
          <Icon name="Info" />
          {profileMessage}
        </div>
      )}
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!selected.length && !other.trim())
            return notifyAction("Select at least one specialty.");
          const changes = {
            specialties: selected,
            otherSpecialty: other.trim(),
            yearsExperience: amount(years),
            professionalRegistration: registration,
            professionalBio: bio,
          };
          try {
            if (demo) {
              patchRecord("users", user.id, {
                ...changes,
                profileCompleted: true,
              });
              setProfileMessage("Demo professional profile saved locally.");
            } else {
              await apiRequest("/auth/me", {
                method: "PATCH",
                body: JSON.stringify(changes),
              });
              await refreshUser();
              setProfileMessage(
                "Your professional profile was saved to the backend.",
              );
            }
            audit(user, "ADMIN_PROFILE_COMPLETED", user.id);
          } catch (error) {
            setProfileMessage(`Profile was not saved: ${error.message}`);
          }
        }}
      >
        <h3>Areas of expertise</h3>
        <div className="specialty-grid">
          {SPECIALTIES.map((s) => (
            <label key={s} className="specialty-choice">
              <input
                type="checkbox"
                checked={selected.includes(s)}
                onChange={() => toggle(s)}
              />{" "}
              {s}
            </label>
          ))}
        </div>
        <div className="form-grid">
          <label>
            Other speciality
            <input
              value={other}
              onChange={(e) => setOther(e.target.value)}
              placeholder="Additional professional skills"
            />
          </label>
          <label>
            Years of experience
            <input
              type="number"
              min="0"
              value={years}
              onChange={(e) => setYears(e.target.value)}
            />
          </label>
          <label className="span-2">
            Professional registration / licence
            <input
              value={registration}
              onChange={(e) => setRegistration(e.target.value)}
              placeholder="Professional body and registration number (if applicable)"
            />
          </label>
          <label className="span-2">
            Professional summary
            <textarea
              rows="4"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
            />
          </label>
        </div>
        <Button type="submit" icon="Save">
          Save profile
        </Button>
      </form>
    </>
  );
}
function AllocationCenter() {
  const { user } = useAuth();
  const projects = useCollection("projects");
  const users = useCollection("users");
  const admins = users.filter((u) => u.role === "admin");
  const [projectId, setProjectId] = useState("");
  const [adminId, setAdminId] = useState("");
  const [responsibility, setResponsibility] = useState("Project management");
  const [category, setCategory] = useState("All");
  const [reason, setReason] = useState("");
  const [operationMessage, setOperationMessage] = useState("");
  const [working, setWorking] = useState(false);
  const { demo } = useAuth();
  const selectedProject = projects.find((p) => p.id === projectId);
  const groups = [...new Set(projects.map((p) => p.type || "other"))];
  const visible = projects.filter(
    (p) => category === "All" || (p.type || "other") === category,
  );
  const pending = visible.filter(
    (p) =>
      !["Approved", "Rejected"].includes(p.approvalStatus) &&
      ["Under review", "Draft", "Pending"].includes(p.status),
  );
  const approve = async (p, yes) => {
    setWorking(true);
    setOperationMessage("");
    try {
      const changes = {
        approvalStatus: yes ? "Approved" : "Rejected",
        status: yes ? "Approved" : "Rejected",
        reviewedBy: user.id,
        reviewedAt: new Date().toISOString(),
        reviewReason: reason,
      };
      if (demo) {
        updateItem("projects", p.id, changes);
        setOperationMessage("Demo project decision recorded locally.");
      } else {
        const result = await apiRequest(
          `/projects/${encodeURIComponent(p.id)}/decision`,
          {
            method: "POST",
            body: JSON.stringify({
              decision: yes ? "Approved" : "Rejected",
              reason,
            }),
          },
        );
        if (!result?.data)
          throw new Error("Project decision not confirmed by backend");
        updateItem("projects", p.id, result.data);
        setOperationMessage("Project decision confirmed by backend.");
      }
      audit(user, yes ? "PROJECT_APPROVED" : "PROJECT_REJECTED", p.id);
    } catch (error) {
      setOperationMessage(`Project decision unsuccessful: ${error.message}`);
    } finally {
      setWorking(false);
    }
  };
  const assign = async (e) => {
    e.preventDefault();
    if (!selectedProject || !adminId || working) return;
    if (selectedProject.approvalStatus !== "Approved")
      return notifyAction("Approve the request before allocating it.");
    const admin = admins.find((u) => String(u.id) === String(adminId));
    if (!admin?.profileCompleted)
      return notifyAction(
        "The administrator must complete their specialties profile before allocation.",
      );
    if (
      (selectedProject.adminAssignments || []).some(
        (a) =>
          String(a.adminId) === String(adminId) &&
          a.responsibility === responsibility,
      )
    )
      return notifyAction("This assignment already exists.");
    setWorking(true);
    setOperationMessage("");
    try {
      if (demo) {
        updateItem("projects", projectId, {
          adminAssignments: [
            ...(selectedProject.adminAssignments || []),
            {
              adminId,
              adminName: admin.name,
              responsibility,
              assignedAt: new Date().toISOString(),
              assignedBy: user.id,
            },
          ],
          status: "Active",
        });
        setOperationMessage("Demo assignment saved locally.");
      } else {
        const result = await apiRequest(
          `/projects/${encodeURIComponent(projectId)}/assignments`,
          { method: "POST", body: JSON.stringify({ adminId, responsibility }) },
        );
        if (!result?.data)
          throw new Error("Assignment not confirmed by backend");
        updateItem("projects", projectId, result.data);
        setOperationMessage("Professional assignment confirmed by backend.");
      }
      audit(
        user,
        "ADMIN_ASSIGNED_TO_PROJECT",
        `${projectId}: ${adminId}: ${responsibility}`,
      );
      setAdminId("");
    } catch (error) {
      setOperationMessage(`Assignment unsuccessful: ${error.message}`);
    } finally {
      setWorking(false);
    }
  };
  return (
    <>
      <SectionHead
        eyebrow="SUPER ADMINISTRATOR"
        title="Project approvals & allocations"
        desc="Review incoming requests by category and allocate multiple specialist roles to one or more administrators."
      />
      {operationMessage && (
        <div className="notice">
          <Icon name="Info" />
          {operationMessage}
        </div>
      )}
      <div className="kpi-grid">
        <Kpi
          label="Pending approval"
          value={
            projects.filter(
              (p) =>
                !["Approved", "Rejected"].includes(p.approvalStatus) &&
                ["Under review", "Draft", "Pending"].includes(p.status),
            ).length
          }
          icon="Clock"
          sub="Awaiting super admin decision"
        />
        <Kpi
          label="Approved"
          value={projects.filter((p) => p.approvalStatus === "Approved").length}
          icon="ShieldCheck"
          sub="Authorised requests"
          tone="green"
        />
        <Kpi
          label="Admins"
          value={admins.length}
          icon="Users"
          sub="Possible assignees"
        />
        <Kpi
          label="Active allocations"
          value={projects.reduce(
            (n, p) => n + (p.adminAssignments || []).length,
            0,
          )}
          icon="ClipboardList"
          sub="Parallel responsibilities"
        />
      </div>
      <div className="filter-row">
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option>All</option>
          {groups.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
      </div>
      <section className="panel">
        <SectionHead
          title="Awaiting decision"
          desc="An approval is separate from assigning an administrator."
        />
        <div className="form-grid">
          <label className="span-2">
            Decision notes (optional)
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </div>
        {pending.length ? (
          pending.map((p) => (
            <div className="verification-row" key={p.id}>
              <div>
                <strong>{p.name}</strong>
                <p>
                  {p.type} · {p.county} · {money(p.budget)} · {p.id}
                </p>
              </div>
              <div className="inline-actions">
                <Button variant="light" to={`/app/projects/${p.id}`}>
                  Inspect
                </Button>
                <Button disabled={working} onClick={() => approve(p, true)}>
                  Approve
                </Button>
                <Button
                  disabled={working}
                  variant="outline"
                  onClick={() => approve(p, false)}
                >
                  Reject
                </Button>
              </div>
            </div>
          ))
        ) : (
          <Empty title="No pending requests in this category" />
        )}
      </section>
      <section className="panel">
        <SectionHead
          title="Allocate professional responsibilities"
          desc="One project can have many admins; one admin can handle many projects and roles."
        />
        <form onSubmit={assign} className="form-grid">
          <label>
            Approved project
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              required
            >
              <option value="">Choose project</option>
              {projects
                .filter((p) => p.approvalStatus === "Approved")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.type})
                  </option>
                ))}
            </select>
          </label>
          <label>
            Administrator
            <select
              value={adminId}
              onChange={(e) => setAdminId(e.target.value)}
              required
            >
              <option value="">Choose administrator</option>
              {admins.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.profileCompleted
                    ? ` · ${(a.specialties || []).join(", ")}`
                    : " · profile incomplete"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Role / assignment
            <select
              value={responsibility}
              onChange={(e) => setResponsibility(e.target.value)}
            >
              {["Project management", ...SPECIALTIES].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <div style={{ alignSelf: "end" }}>
            <Button type="submit" disabled={working}>
              {working ? "Saving…" : "Assign administrator"}
            </Button>
          </div>
        </form>
      </section>
      <section className="panel">
        <SectionHead title="Current assignments by project nature" />
        {groups.map((group) => (
          <div key={group} className="assignment-group">
            <h3>{group}</h3>
            {visible
              .filter((p) => p.type === group)
              .map((p) => (
                <div key={p.id} className="activity-entry">
                  <strong>{p.name}</strong>{" "}
                  <Tag tone={statusTone(p.status)}>{p.status}</Tag>
                  <p>
                    {(p.adminAssignments || []).length
                      ? p.adminAssignments
                          .map((a) => `${a.adminName}: ${a.responsibility}`)
                          .join(" · ")
                      : "Not allocated"}
                  </p>
                </div>
              ))}
          </div>
        ))}
      </section>
    </>
  );
}
function AdminPortfolio() {
  const { user } = useAuth();
  const projects = useCollection("projects").filter((p) =>
    belongsToAdmin(p, user.id),
  );
  const groups = [...new Set(projects.map((p) => p.type || "other"))];
  return (
    <section className="panel">
      <SectionHead
        title="My allocated work by category"
        desc="Projects, properties and specialist responsibilities entrusted to you."
        action={
          <Button to="/app/admin/profile" variant="light">
            Update specialties
          </Button>
        }
      />
      {!groups.length && (
        <Empty
          title="No assignments yet"
          description="Your approved assignments will appear after allocation by the super administrator."
        />
      )}
      {groups.map((g) => (
        <div className="assignment-group" key={g}>
          <h3>{g}</h3>
          {projects
            .filter((p) => (p.type || "other") === g)
            .map((p) => (
              <div className="activity-entry" key={p.id}>
                <strong>
                  <Link to={`/app/projects/${p.id}`}>{p.name}</Link>
                </strong>{" "}
                <Tag tone={statusTone(p.status)}>{p.status}</Tag>
                <p>
                  Your roles:{" "}
                  {assignmentsFor(p, user.id)
                    .map((a) => a.responsibility)
                    .join(", ") || "Assigned administrator"}
                </p>
              </div>
            ))}
        </div>
      ))}
    </section>
  );
}
function TenantAssignments() {
  const { demo } = useAuth();
  const users = useCollection("users");
  const properties = useCollection("properties");
  const tenants = useCollection("tenants");
  const [form, setForm] = useState({
    userId: "",
    propertyId: "",
    unit: "",
    monthlyRent: "",
    leaseStart: today(),
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const unassigned = users.filter(
    (u) =>
      u.role === "tenant" &&
      u.active !== false &&
      !tenants.some(
        (t) => String(t.userId) === String(u.id) && t.status === "Active",
      ),
  );
  const selected = users.find((u) => String(u.id) === String(form.userId));
  const linked = selected?.invitedPropertyId;
  const { user } = useAuth();
  const projects = useCollection("projects");
  const allowedProperties = properties.filter((p) =>
    canSeeProperty(p, user, projects),
  );
  const choices = linked
    ? allowedProperties.filter((p) => String(p.id) === String(linked))
    : allowedProperties;
  const assign = async (e) => {
    e.preventDefault();
    setMessage("");
    setError(false);
    if (!selected) {
      setMessage("Select an activated tenant account.");
      setError(true);
      return;
    }
    if (linked && String(linked) !== String(form.propertyId)) {
      setMessage("Tenant invitation is linked to a different property.");
      setError(true);
      return;
    }
    if (
      tenants.some(
        (t) =>
          t.propertyId === form.propertyId &&
          t.unit.trim().toLowerCase() === form.unit.trim().toLowerCase() &&
          t.status === "Active",
      )
    ) {
      setMessage("That rental unit is already occupied.");
      setError(true);
      return;
    }
    setBusy(true);
    try {
      const payload = {
        ...form,
        name: selected.name,
        monthlyRent: Number(form.monthlyRent),
      };
      if (demo)
        addItem("tenants", {
          ...payload,
          id: `TEN-${Date.now()}`,
          status: "Active",
        });
      else {
        const result = await apiRequest("/tenants", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        if (!result?.data)
          throw new Error("Backend did not confirm tenancy allocation.");
        notifyCollections();
      }
      setMessage(
        `${selected.name} assigned to unit ${form.unit}${demo ? " (demo only)" : ""}.`,
      );
      setForm({
        userId: "",
        propertyId: "",
        unit: "",
        monthlyRent: "",
        leaseStart: today(),
      });
    } catch (e) {
      setMessage(`Assignment failed: ${e.message}`);
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SectionHead
        eyebrow="PROPERTY OPERATIONS"
        title="Tenant assignment confirmation"
        desc="Activated invited tenants remain here until they are allocated a property, unit and monthly rent."
      />
      <ActionNotice message={message} error={error} />
      <section className="panel">
        <h3>Activated tenants awaiting allocation</h3>
        {unassigned.map((u) => (
          <div key={u.id} className="verification-row">
            <div>
              <strong>{u.name}</strong>
              <p>
                {u.email} ·{" "}
                {u.invitedPropertyId
                  ? `Invited to ${properties.find((p) => String(p.id) === String(u.invitedPropertyId))?.name || u.invitedPropertyId}`
                  : "Property not specified"}
              </p>
            </div>
            <Button
              variant="light"
              onClick={() =>
                setForm((v) => ({
                  ...v,
                  userId: u.id,
                  propertyId: u.invitedPropertyId || "",
                }))
              }
            >
              Assign unit
            </Button>
          </div>
        ))}
        {!unassigned.length && (
          <Empty title="No activated tenants awaiting assignment" />
        )}
      </section>
      <form className="panel form-grid" onSubmit={assign}>
        <label>
          Tenant{" "}
          <select
            required
            value={form.userId}
            onChange={(e) => {
              const u = users.find(
                (v) => String(v.id) === String(e.target.value),
              );
              setForm((v) => ({
                ...v,
                userId: e.target.value,
                propertyId: u?.invitedPropertyId || "",
              }));
            }}
          >
            <option value="">Select tenant</option>
            {unassigned.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </select>
        </label>
        <label>
          Property{" "}
          <select
            required
            value={form.propertyId}
            onChange={(e) =>
              setForm((v) => ({ ...v, propertyId: e.target.value }))
            }
          >
            <option value="">Choose property</option>
            {choices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Unit / house{" "}
          <input
            required
            value={form.unit}
            onChange={(e) => setForm((v) => ({ ...v, unit: e.target.value }))}
          />
        </label>
        <label>
          Monthly rent (KES){" "}
          <input
            required
            type="number"
            min="1"
            value={form.monthlyRent}
            onChange={(e) =>
              setForm((v) => ({ ...v, monthlyRent: e.target.value }))
            }
          />
        </label>
        <label>
          Lease start{" "}
          <input
            required
            type="date"
            value={form.leaseStart}
            onChange={(e) =>
              setForm((v) => ({ ...v, leaseStart: e.target.value }))
            }
          />
        </label>
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? "Assigning…" : "Confirm tenant assignment"}
          </Button>
        </div>
      </form>
    </>
  );
}

function TenantWorkspace({ rentOnly = false }) {
  const { user } = useAuth();
  const tenants = useCollection("tenants");
  const properties = useCollection("properties");
  const payments = useCollection("rentPayments");
  const tenant = tenants.find(
    (t) => String(t.userId) === String(user.id) && t.status !== "Removed",
  );
  if (!tenant)
    return (
      <Empty
        title="Tenant record not linked"
        description="Ask the property administrator to link your account to your lease. No rental data is available yet."
      />
    );
  const property = propertyForTenant(tenant, properties);
  const stats = rentStats(tenant, payments);
  const mine = payments.filter((p) => String(p.tenantId) === String(tenant.id));
  return (
    <>
      <SectionHead
        eyebrow="TENANT PORTAL"
        title={
          rentOnly ? "Rent statement" : `Welcome, ${user.name || tenant.name}`
        }
        desc="Your property, rent history, confirmed receipts, and outstanding balance."
      />
      <div className="notice">
        <Icon name="Info" /> Payment entries are confirmed only by the backend
        or recorded by authorised property staff. This preview does not collect
        M-Pesa payments.
      </div>
      <div className="kpi-grid">
        <Kpi
          label="Monthly rent"
          value={money(tenant.monthlyRent)}
          icon="House"
          sub={property?.name || tenant.propertyId}
        />
        <Kpi
          label="Total paid"
          value={money(stats.received)}
          icon="CircleCheck"
          sub="Confirmed / recorded rent"
          tone="green"
        />
        <Kpi
          label="Arrears"
          value={money(stats.arrears)}
          icon="AlertCircle"
          sub="Rent due less confirmed payments"
          tone="orange"
        />
        <Kpi
          label="Payment rating"
          value={`${stats.score}%`}
          icon="Star"
          sub="Indicative payment coverage"
        />
      </div>
      <section className="panel">
        <SectionHead title="My tenancy details" />
        <div className="detail-list">
          <div>
            <span>Property</span>
            <strong>{property?.name || "Not assigned"}</strong>
          </div>
          <div>
            <span>Unit</span>
            <strong>{tenant.unit || "—"}</strong>
          </div>
          <div>
            <span>Lease start</span>
            <strong>{tenant.leaseStart || "—"}</strong>
          </div>
          <div>
            <span>Tenancy status</span>
            <strong>{tenant.status || "Active"}</strong>
          </div>
        </div>
      </section>
      <section className="panel">
        <SectionHead title="Rent payment history" />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Reference</th>
                <th>Property / unit</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {mine.map((p) => (
                <tr key={p.id}>
                  <td>{p.date}</td>
                  <td>{p.reference || p.id}</td>
                  <td>
                    {property?.name} · {tenant.unit}
                  </td>
                  <td>{money(p.amount)}</td>
                  <td>
                    <Tag tone={statusTone(p.status)}>{p.status}</Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!mine.length && <Empty title="No rent receipts yet" />}
      </section>
    </>
  );
}
function Tenants() {
  const { user } = useAuth();
  const allProperties = useCollection("properties");
  const projects = useCollection("projects");
  const users = useCollection("users");
  const allTenants = useCollection("tenants");
  const payments = useCollection("rentPayments");
  const visibleProperties = allProperties.filter((p) =>
    canSeeProperty(p, user, projects),
  );
  const propertyIds = new Set(visibleProperties.map((p) => String(p.id)));
  const visibleTenants = allTenants.filter((t) =>
    propertyIds.has(String(t.propertyId)),
  );
  const [form, setForm] = useState({
    propertyId: "",
    name: "",
    userId: "",
    unit: "",
    monthlyRent: "",
    leaseStart: today(),
  });
  const [pay, setPay] = useState({
    tenantId: "",
    amount: "",
    date: today(),
    reference: "",
  });
  const [propertyForm, setPropertyForm] = useState({
    name: "",
    projectId: "",
    ownerId: "",
  });
  const addProperty = async (e) => {
    e.preventDefault();
    const project = projects.find((p) => p.id === propertyForm.projectId);
    const id = `PROP-${Date.now()}`;
    const saved = await writeRecord("properties", {
      ...propertyForm,
      id,
      ownerId: project?.ownerId || propertyForm.ownerId,
      adminIds: (project?.adminAssignments || []).map((a) => a.adminId),
    });
    if (!saved) return;
    audit(user, "PROPERTY_CREATED", id);
    setPropertyForm({ name: "", projectId: "", ownerId: "" });
  };
  const addTenant = async (e) => {
    e.preventDefault();
    if (!propertyIds.has(String(form.propertyId))) return;
    if (!form.userId)
      return notifyAction("Select a user account for this tenant.", "error");
    if (
      allTenants.some((t) => t.userId === form.userId && t.status === "Active")
    )
      return notifyAction("This user already has an active tenancy.", "error");
    const id = `TEN-${Date.now()}`;
    const saved = await writeRecord("tenants", {
      ...form,
      id,
      monthlyRent: amount(form.monthlyRent),
      status: "Active",
    });
    if (!saved) return;
    audit(user, "TENANT_ADDED", id);
    setForm({
      propertyId: "",
      name: "",
      userId: "",
      unit: "",
      monthlyRent: "",
      leaseStart: today(),
    });
  };
  const recordPayment = async (e) => {
    e.preventDefault();
    const tenant = visibleTenants.find((t) => t.id === pay.tenantId);
    if (!tenant || tenant.status !== "Active")
      return notifyAction("Select an active tenant.", "error");
    if (!pay.reference.trim())
      return notifyAction("Provide a verified payment reference.", "error");
    if (payments.some((p) => p.reference === pay.reference))
      return notifyAction(
        "Duplicate reference. Payment not recorded.",
        "error",
      );
    const id = `RENT-${Date.now()}`;
    const saved = await writeRecord("rentPayments", {
      ...pay,
      id,
      propertyId: tenant.propertyId,
      amount: amount(pay.amount),
      status: "Recorded",
      recordedBy: user.id,
    });
    if (!saved) return;
    audit(user, "RENT_PAYMENT_RECORDED", id);
    setPay({ tenantId: "", amount: "", date: today(), reference: "" });
  };
  const [tenantConfirmation, setTenantConfirmation] = useState("");
  const [tenantFeedback, setTenantFeedback] = useState("");
  const requestRemoval = async (tenant) => {
    if (tenantConfirmation !== `request:${tenant.id}`) {
      setTenantConfirmation(`request:${tenant.id}`);
      setTenantFeedback(
        `Click Request removal again to confirm ${tenant.name}.`,
      );
      return;
    }
    setTenantConfirmation("");
    try {
      if (!liveWriteEnabled())
        updateItem("tenants", tenant.id, { status: "Removal requested" });
      else {
        const result = await apiRequest(
          `/tenants/${encodeURIComponent(tenant.id)}/removal-request`,
          {
            method: "POST",
            body: JSON.stringify({ reason: "Tenant relocation" }),
          },
        );
        if (!result?.data)
          throw new Error("Backend did not confirm removal request");
        notifyCollections();
      }
      setTenantFeedback(
        "Tenant removal request submitted for Super Admin review.",
      );
    } catch (e) {
      setTenantFeedback(`Removal request failed: ${e.message}`);
    }
  };
  const decideRemoval = async (tenant, remove) => {
    if (tenantConfirmation !== `decide:${tenant.id}:${remove}`) {
      setTenantConfirmation(`decide:${tenant.id}:${remove}`);
      setTenantFeedback(
        `Click ${remove ? "Remove" : "Reinstate"} again to confirm the decision for ${tenant.name}.`,
      );
      return;
    }
    setTenantConfirmation("");
    try {
      if (!liveWriteEnabled())
        updateItem("tenants", tenant.id, {
          status: remove ? "Removed" : "Active",
        });
      else {
        const result = await apiRequest(
          `/tenants/${encodeURIComponent(tenant.id)}/removal-decision`,
          {
            method: "POST",
            body: JSON.stringify({ decision: remove ? "remove" : "reinstate" }),
          },
        );
        if (!result?.data)
          throw new Error("Backend did not confirm removal decision");
        notifyCollections();
      }
      setTenantFeedback(
        `Tenant ${remove ? "removed" : "reinstated"} successfully.`,
      );
    } catch (e) {
      setTenantFeedback(`Removal decision failed: ${e.message}`);
    }
  };
  return (
    <>
      <SectionHead
        eyebrow="PROPERTY OPERATIONS"
        title="Properties, tenants & rent"
        desc="Each property has its own tenants, rental records, receipts and supervision history."
        action={
          <Button to="/app/tenant-assignments" variant="light">
            Tenant assignments
          </Button>
        }
      />
      <ActionNotice
        message={tenantFeedback}
        error={/failed/i.test(tenantFeedback)}
      />
      {user.role === "super_admin" && (
        <section className="panel">
          <h3>Register managed property</h3>
          <form className="form-grid" onSubmit={addProperty}>
            <label>
              Property name
              <input
                required
                value={propertyForm.name}
                onChange={(e) =>
                  setPropertyForm({ ...propertyForm, name: e.target.value })
                }
              />
            </label>
            <label>
              Approved property project
              <select
                required
                value={propertyForm.projectId}
                onChange={(e) =>
                  setPropertyForm({
                    ...propertyForm,
                    projectId: e.target.value,
                  })
                }
              >
                <option value="">Select</option>
                {projects
                  .filter(
                    (p) =>
                      p.approvalStatus === "Approved" && p.type === "property",
                  )
                  .map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <div>
              <Button type="submit">Create property</Button>
            </div>
          </form>
        </section>
      )}
      <section className="panel">
        <h3>Register a tenant</h3>
        <form className="form-grid" onSubmit={addTenant}>
          <label>
            Property
            <select
              required
              value={form.propertyId}
              onChange={(e) => setForm({ ...form, propertyId: e.target.value })}
            >
              <option value="">Choose property</option>
              {visibleProperties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tenant user account
            <select
              required
              value={form.userId}
              onChange={(e) => {
                const chosen = users.find((u) => u.id === e.target.value);
                setForm({
                  ...form,
                  userId: e.target.value,
                  name: chosen?.name || "",
                });
              }}
            >
              <option value="">Select registered account</option>
              {users
                .filter((u) => u.role === "tenant")
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </option>
                ))}
            </select>
          </label>
          <label>
            Unit / house
            <input
              required
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
            />
          </label>
          <label>
            Monthly rent (KES)
            <input
              type="number"
              min="1"
              required
              value={form.monthlyRent}
              onChange={(e) =>
                setForm({ ...form, monthlyRent: e.target.value })
              }
            />
          </label>
          <label>
            Lease start
            <input
              type="date"
              required
              value={form.leaseStart}
              onChange={(e) => setForm({ ...form, leaseStart: e.target.value })}
            />
          </label>
          <div>
            <Button type="submit">Link tenant to property</Button>
          </div>
        </form>
        <p className="muted tiny">
          Tenant accounts are created through the authentication system; account
          creation and invitations will be wired in Auth.jsx.
        </p>
      </section>
      <section className="panel">
        <h3>Record verified rent payment</h3>
        <form className="form-grid" onSubmit={recordPayment}>
          <label>
            Tenant
            <select
              required
              value={pay.tenantId}
              onChange={(e) => setPay({ ...pay, tenantId: e.target.value })}
            >
              <option value="">Choose tenant</option>
              {visibleTenants
                .filter((t) => t.status === "Active")
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ·{" "}
                    {visibleProperties.find((p) => p.id === t.propertyId)?.name}{" "}
                    · {t.unit}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Amount (KES)
            <input
              type="number"
              required
              min="1"
              value={pay.amount}
              onChange={(e) => setPay({ ...pay, amount: e.target.value })}
            />
          </label>
          <label>
            Payment reference
            <input
              required
              value={pay.reference}
              onChange={(e) => setPay({ ...pay, reference: e.target.value })}
            />
          </label>
          <label>
            Payment date
            <input
              type="date"
              required
              value={pay.date}
              onChange={(e) => setPay({ ...pay, date: e.target.value })}
            />
          </label>
          <div>
            <Button type="submit">Record receipt</Button>
          </div>
        </form>
        <p className="muted tiny">
          Only verified receipts should be entered; in production the payment
          provider webhook and server-side idempotency checks will be
          authoritative.
        </p>
      </section>
      {visibleProperties.map((property) => {
        const tenants = visibleTenants.filter(
          (t) => t.propertyId === property.id,
        );
        return (
          <section className="panel" key={property.id}>
            <SectionHead
              title={property.name}
              desc={`Property ID ${property.id} · ${tenants.length} tenant records`}
            />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tenant / account</th>
                    <th>Unit</th>
                    <th>Monthly rent</th>
                    <th>Paid</th>
                    <th>Arrears</th>
                    <th>Rating</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((t) => {
                    const st = rentStats(t, payments);
                    return (
                      <tr key={t.id}>
                        <td>
                          <strong>{t.name}</strong>
                          <small>
                            {users.find((u) => u.id === t.userId)?.email ||
                              t.userId}
                          </small>
                        </td>
                        <td>{t.unit}</td>
                        <td>{money(t.monthlyRent)}</td>
                        <td>{money(st.received)}</td>
                        <td>{money(st.arrears)}</td>
                        <td>{st.score}%</td>
                        <td>
                          <Tag tone={statusTone(t.status)}>{t.status}</Tag>
                        </td>
                        <td>
                          {user.role === "admin" && t.status === "Active" && (
                            <Button
                              variant="light"
                              onClick={() => requestRemoval(t)}
                            >
                              Request removal
                            </Button>
                          )}
                          {user.role === "super_admin" &&
                            t.status === "Removal requested" && (
                              <div className="inline-actions">
                                <Button onClick={() => decideRemoval(t, true)}>
                                  Confirm removal
                                </Button>
                                <Button
                                  variant="outline"
                                  onClick={() => decideRemoval(t, false)}
                                >
                                  Reinstate
                                </Button>
                              </div>
                            )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!tenants.length && <Empty title="No linked tenants yet" />}
          </section>
        );
      })}
      {!visibleProperties.length && (
        <Empty
          title="No properties allocated"
          description="Managed properties are shown once the super administrator registers and assigns them."
        />
      )}
    </>
  );
}
function PropertyInvestmentSummary() {
  const { user } = useAuth();
  const properties = useCollection("properties");
  const projects = useCollection("projects");
  const tenants = useCollection("tenants");
  const rent = useCollection("rentPayments");
  const ledger = useCollection("transactions");
  const visible = properties.filter((p) => canSeeProperty(p, user, projects));
  return (
    <section className="panel">
      <SectionHead
        title="Individual property investment performance"
        desc="Rent received, operating costs, owner distributions and balance per property."
        action={
          user.role !== "client" ? (
            <Button to="/app/tenants" variant="light">
              Manage tenants
            </Button>
          ) : null
        }
      />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Property</th>
              <th>Tenants</th>
              <th>Rent income</th>
              <th>Other income</th>
              <th>Expenditure</th>
              <th>Owner remitted</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => {
              const rents = sumAmounts(
                rent.filter(
                  (r) =>
                    r.propertyId === p.id &&
                    ["Recorded", "Confirmed", "Paid"].includes(r.status),
                ),
              );
              const transactions = ledger.filter(
                (t) => t.propertyId === p.id || t.property === p.name,
              );
              const other = sumAmounts(
                transactions.filter(
                  (t) =>
                    t.type === "Income" &&
                    !["Rent", "Rental income"].includes(t.category),
                ),
              );
              const expenses = sumAmounts(
                transactions.filter((t) => t.type === "Expense"),
              );
              const distributed = sumAmounts(
                transactions.filter(
                  (t) =>
                    t.type === "Owner distribution" ||
                    t.category === "Owner distribution",
                ),
              );
              return (
                <tr key={p.id}>
                  <td>
                    <strong>{p.name}</strong>
                  </td>
                  <td>
                    {
                      tenants.filter(
                        (t) => t.propertyId === p.id && t.status === "Active",
                      ).length
                    }
                  </td>
                  <td>{money(rents)}</td>
                  <td>{money(other)}</td>
                  <td>{money(expenses)}</td>
                  <td>{money(distributed)}</td>
                  <td>{money(rents + other - expenses - distributed)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!visible.length && <Empty title="No property investment records yet" />}
    </section>
  );
}

function Notifications() {
  const { user } = useAuth();
  const notifications = useCollection("notifications");
  return (
    <>
      <SectionHead
        eyebrow="UPDATES"
        title="Notifications"
        desc="Important milestones, payments, approvals and operational alerts."
      />
      <div className="panel">
        <div className="activity-entry">
          <strong>Welcome to your Bautek workspace</strong>
          <p>
            Your {roleLabel(user.role).toLowerCase()} interface is ready to
            preview.
          </p>
          <small>Demo notification</small>
        </div>
        {notifications.map((x) => (
          <div key={x.id} className="activity-entry">
            <strong>{x.title}</strong>
            <p>{x.message}</p>
          </div>
        ))}
      </div>
    </>
  );
}
function Verifications() {
  const { user } = useAuth();
  const projects = useCollection("projects");
  const pending = projects.filter(
    (p) =>
      p.status === "Under review" &&
      (user.role === "super_admin" || belongsToAdmin(p, user.id)),
  );
  return (
    <>
      <SectionHead
        eyebrow="QUALITY & COMPLIANCE"
        title="Verification queue"
        desc="Review due diligence, project requests and evidence before further action."
      />
      <div className="panel">
        <div className="notice">
          <Icon name="ShieldAlert" /> Changing status in demo mode does not
          legally verify title, identity, engineering safety or payment.
          Production requires verified supporting evidence and dual-approval
          rules for sensitive actions.
        </div>
        {pending.length ? (
          pending.map((p) => (
            <div className="verification-row" key={p.id}>
              <span className="verify-icon">
                <Icon name="FolderSearch" />
              </span>
              <div>
                <strong>{p.name}</strong>
                <p>
                  {p.id} · {p.county} · {money(p.budget)}
                </p>
              </div>
              <div className="inline-actions">
                <Button variant="light" to={`/app/projects/${p.id}`}>
                  Review
                </Button>
                {user.role === "super_admin" && (
                  <Button to="/app/allocations" variant="light">
                    Open approval queue
                  </Button>
                )}
              </div>
            </div>
          ))
        ) : (
          <Empty title="No pending projects" />
        )}
      </div>
    </>
  );
}
function Users() {
  const { user, demo } = useAuth();
  const users = useCollection("users");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState("");
  const [role, setRole] = useState("client");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [confirmRole, setConfirmRole] = useState(false);
  const filtered = users.filter((x) =>
    [x.name, x.email, x.role].join(" ").toLowerCase().includes(q.toLowerCase()),
  );
  async function apply() {
    if (!selected || saving) return;
    setFeedback("");
    const target = users.find((u) => String(u.id) === String(selected));
    if (!target || String(target.id) === String(user.id))
      return setFeedback("You cannot change your own role.");
    if (target.role === "super_admin" || role === "super_admin")
      return setFeedback(
        "Super Admin accounts can only be provisioned through the secure backend bootstrap process.",
      );
    if (!confirmRole) {
      setConfirmRole(true);
      return setFeedback(
        `Confirm changing ${target.name}'s role to ${role}. Click Apply role again to confirm.`,
      );
    }
    setConfirmRole(false);
    setSaving(true);
    try {
      const patch = {
        role,
        ...(role === "admin" && target.role !== "admin"
          ? { profileCompleted: false, specialties: [] }
          : {}),
      };
      if (demo) {
        updateItem("users", selected, patch);
        setFeedback(
          "Demo role updated locally. This does not change any backend permissions.",
        );
      } else {
        const result = await apiRequest(
          `/users/${encodeURIComponent(selected)}/role`,
          { method: "PATCH", body: JSON.stringify({ role }) },
        );
        const updated = result?.data || result?.user;
        if (!updated || String(updated.id) !== String(selected))
          throw new Error("The backend did not confirm the new role.");
        updateItem("users", selected, updated);
        setFeedback(
          "Backend confirmed role change. The user's previous sessions were revoked; they should sign in again.",
        );
      }
      audit(user, "ROLE_CHANGED", `${target.email} => ${role}`);
      setSelected("");
    } catch (error) {
      setFeedback(`Role change unsuccessful: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <SectionHead
        eyebrow="SUPER ADMINISTRATOR"
        title="Users & access control"
        desc="Manage users, account states and role assignments. This feature is restricted to super administrators."
      />
      <div className="notice">
        <Icon name="ShieldCheck" /> Live role changes use the protected backend
        /users/:id/role endpoint and revoke previous sessions. Demo changes
        remain local and do not grant real access.
      </div>
      {feedback && (
        <div className="notice">
          <Icon name="Info" /> {feedback}
        </div>
      )}
      <div className="panel">
        <div className="filter-row">
          <input
            placeholder="Search users…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((x) => (
                <tr key={x.id}>
                  <td>
                    <strong>{x.name}</strong>
                  </td>
                  <td>{x.email}</td>
                  <td>
                    <Tag>
                      {x.role === "tenant" ? "Tenant" : roleLabel(x.role)}
                    </Tag>
                  </td>
                  <td>
                    <Tag tone="green">{x.status}</Tag>
                  </td>
                  <td>
                    <button
                      disabled={x.id === user.id || x.role === "super_admin"}
                      className="text-button"
                      onClick={() => {
                        setSelected(x.id);
                        setRole(x.role);
                      }}
                    >
                      Edit role
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {selected && (
        <div className="panel form-panel">
          <h3>Edit role: {users.find((u) => u.id === selected)?.name}</h3>
          <div className="filter-row">
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {["client", "contractor", "tenant", "admin"].map((x) => (
                <option key={x} value={x}>
                  {x === "tenant" ? "Tenant" : roleLabel(x)}
                </option>
              ))}
            </select>
            <Button onClick={apply} disabled={saving}>
              {saving
                ? "Saving…"
                : demo
                  ? "Save demo role"
                  : "Save role to backend"}
            </Button>
            <Button variant="light" onClick={() => setSelected("")}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
function Audit() {
  const entries = useCollection("audit");
  return (
    <>
      <SectionHead
        eyebrow="SUPER ADMINISTRATOR"
        title="Audit trail"
        desc="Track administrative and operational changes."
        action={
          <Button
            icon="Download"
            variant="outline"
            onClick={() => exportCSV(entries, "bautek-audit-demo.csv")}
          >
            Export log
          </Button>
        }
      />
      <div className="panel">
        <div className="notice">
          <Icon name="Info" /> These audit records are browser-local and can be
          altered. A secure production audit trail must be append-only and
          written by the backend.
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date/time</th>
                <th>Actor</th>
                <th>Role</th>
                <th>Action</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((x) => (
                <tr key={x.id}>
                  <td>{new Date(x.date).toLocaleString("en-KE")}</td>
                  <td>{x.user}</td>
                  <td>{x.role}</td>
                  <td>{x.action}</td>
                  <td>{x.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!entries.length && <Empty title="No demo actions yet" />}
        </div>
      </div>
    </>
  );
}
function Settings() {
  return (
    <>
      <SectionHead
        eyebrow="SUPER ADMINISTRATOR"
        title="System settings"
        desc="A reference view of company rules, service fees, policies and security requirements."
      />
      <div className="three-grid">
        <InfoCard
          icon="Percent"
          title="Project fees"
          desc="Land: 5% Bautek delivery or 3% supervision. Construction and procurement: 10% delivery or 5% supervision. Property management: separately assessed."
        />
        <InfoCard
          icon="ShieldCheck"
          title="Security"
          desc="Enable backend session checks, role enforcement, least-privilege permissions, audit logging and multi-factor authentication for staff."
        />
        <InfoCard
          icon="CreditCard"
          title="Payments"
          desc="Integrate Daraja through secure server-side requests and callbacks. Use regulated banking partners for any escrow or savings product."
        />
      </div>
      <div className="panel">
        <h3>Role permission matrix (reference)</h3>
        <div className="permission-grid">
          {Object.entries(permissions).map(([r, p]) => (
            <div key={r}>
              <h4>{roleLabel(r)}</h4>
              {p.map((x) => (
                <span key={x}>
                  <Icon name="Check" size={14} />
                  {x.replaceAll("_", " ")}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
function Unauthorized() {
  const { user } = useAuth();
  return (
    <div className="error-page">
      <Icon name="ShieldX" size={56} />
      <h1>Access denied</h1>
      <p>Your account role does not permit access to this area.</p>
      <Button
        to={
          user
            ? user.role === "tenant"
              ? "/app/tenant"
              : homeFor(user.role)
            : "/login"
        }
      >
        Return to your workspace
      </Button>
    </div>
  );
}
function NotFound() {
  return (
    <div className="error-page">
      <Icon name="SearchX" size={56} />
      <h1>Page not found</h1>
      <p>The page you requested is unavailable.</p>
      <Button to="/">Back to Bautek</Button>
    </div>
  );
}
function AppRedirect() {
  const { user } = useAuth();
  return (
    <Guard>
      {user ? (
        <Navigate
          to={user.role === "tenant" ? "/app/tenant" : homeFor(user.role)}
          replace
        />
      ) : null}
    </Guard>
  );
}
const secured = (roles, comp) => <Guard roles={roles}>{comp}</Guard>;
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/services" element={<Services />} />
      <Route path="/about" element={<About />} />
      <Route path="/insights" element={<Insights />} />
      <Route path="/marketplace" element={<PublicMarketplace />} />
      <Route path="/marketplace/:id" element={<ListingDetail />} />
      <Route path="/login" element={<AuthPage />} />
      <Route path="/register" element={<AuthPage register />} />
      <Route path="/activate-invitation" element={<InvitationActivation />} />
      <Route path="/unauthorized" element={<Unauthorized />} />
      <Route
        path="/app/contractor-application"
        element={secured(
          ["client"],
          <AppShell>
            <ContractorApplication />
          </AppShell>,
        )}
      />
      <Route
        path="/app/invitations"
        element={secured(
          ["super_admin"],
          <AppShell>
            <Invitations />
          </AppShell>,
        )}
      />
      <Route path="/app" element={<AppRedirect />} />
      <Route
        path="/app/client"
        element={secured(
          ["client"],
          <AppShell>
            <Dashboard />
          </AppShell>,
        )}
      />
      <Route
        path="/app/contractor"
        element={secured(
          ["contractor"],
          <AppShell>
            <ContractorDashboard />
          </AppShell>,
        )}
      />
      <Route
        path="/app/admin"
        element={secured(
          ["admin"],
          <AppShell>
            <AdministratorDashboard />
          </AppShell>,
        )}
      />
      <Route
        path="/app/super-admin"
        element={secured(
          ["super_admin"],
          <AppShell>
            <SuperAdminDashboard />
          </AppShell>,
        )}
      />
      <Route
        path="/app/admin/profile"
        element={secured(
          ["admin"],
          <AppShell>
            <AdminProfile />
          </AppShell>,
        )}
      />
      <Route
        path="/app/allocations"
        element={secured(
          ["super_admin"],
          <AppShell>
            <AllocationCenter />
          </AppShell>,
        )}
      />
      <Route
        path="/app/tenant-assignments"
        element={secured(
          ["admin", "super_admin"],
          <AppShell>
            <TenantAssignments />
          </AppShell>,
        )}
      />
      <Route
        path="/app/contractor-applications"
        element={secured(
          ["super_admin"],
          <AppShell>
            <ContractorApplicationsReview />
          </AppShell>,
        )}
      />
      <Route
        path="/app/tenants"
        element={secured(
          ["admin", "super_admin"],
          <AppShell>
            <Tenants />
          </AppShell>,
        )}
      />
      <Route
        path="/app/tenant"
        element={secured(
          ["tenant"],
          <AppShell>
            <TenantWorkspace />
          </AppShell>,
        )}
      />
      <Route
        path="/app/tenant/rent"
        element={secured(
          ["tenant"],
          <AppShell>
            <TenantWorkspace rentOnly />
          </AppShell>,
        )}
      />
      <Route
        path="/app/projects"
        element={secured(
          ["client", "contractor", "admin", "super_admin"],
          <AppShell>
            <Projects />
          </AppShell>,
        )}
      />
      <Route
        path="/app/projects/new"
        element={secured(
          ["client"],
          <AppShell>
            <ProjectWizard />
          </AppShell>,
        )}
      />
      <Route
        path="/app/projects/:id"
        element={secured(
          ["client", "contractor", "admin", "super_admin"],
          <AppShell>
            <ProjectDetail />
          </AppShell>,
        )}
      />
      <Route
        path="/app/marketplace"
        element={secured(
          ["client", "contractor", "admin", "super_admin"],
          <AppShell>
            <Marketplace />
          </AppShell>,
        )}
      />
      <Route
        path="/app/bids"
        element={secured(
          ["client", "contractor", "admin", "super_admin"],
          <AppShell>
            <Bids />
          </AppShell>,
        )}
      />
      <Route
        path="/app/deliverables"
        element={secured(
          ["contractor", "admin"],
          <AppShell>
            <Deliverables />
          </AppShell>,
        )}
      />
      <Route
        path="/app/tenders"
        element={secured(
          ["contractor"],
          <AppShell>
            <Tenders />
          </AppShell>,
        )}
      />
      <Route
        path="/app/property"
        element={secured(
          ["client", "admin", "super_admin"],
          <AppShell>
            <Property />
          </AppShell>,
        )}
      />
      <Route
        path="/app/payments"
        element={secured(
          ["client", "admin", "super_admin"],
          <AppShell>
            <Payments />
          </AppShell>,
        )}
      />
      <Route
        path="/app/documents"
        element={secured(
          ["client", "contractor", "admin", "super_admin"],
          <AppShell>
            <Documents />
          </AppShell>,
        )}
      />
      <Route
        path="/app/messages"
        element={secured(
          ["client", "contractor", "admin", "tenant"],
          <AppShell>
            <Messages />
          </AppShell>,
        )}
      />
      <Route
        path="/app/notifications"
        element={secured(
          ["client", "contractor", "admin", "super_admin", "tenant"],
          <AppShell>
            <Notifications />
          </AppShell>,
        )}
      />
      <Route
        path="/app/verifications"
        element={secured(
          ["admin", "super_admin"],
          <AppShell>
            <Verifications />
          </AppShell>,
        )}
      />
      <Route
        path="/app/users"
        element={secured(
          ["super_admin"],
          <AppShell>
            <Users />
          </AppShell>,
        )}
      />
      <Route
        path="/app/audit"
        element={secured(
          ["super_admin"],
          <AppShell>
            <Audit />
          </AppShell>,
        )}
      />
      <Route
        path="/app/settings"
        element={secured(
          ["super_admin"],
          <AppShell>
            <Settings />
          </AppShell>,
        )}
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
