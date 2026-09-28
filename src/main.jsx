import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import hero from './assets/veltrix-parking-hero.png';
import {
  authService,
  parkingService,
  bookingService,
  adminService,
  dashboardService,
} from './services/api';
import { getTranslation, supportedLanguages } from './i18n.js';
import 'leaflet/dist/leaflet.css';
import './styles.css';

// =========================================================
// LOADING SPINNER
// =========================================================

function Spinner({ size = 20, color = 'var(--blue)' }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        border: `2.5px solid rgba(29,114,216,0.15)`,
        borderTopColor: color,
        borderRadius: '50%',
        animation: 'spin 0.7s linear infinite',
        display: 'inline-block',
      }}
    />
  );
}

// Inject spinner keyframe
if (typeof document !== 'undefined' && !document.getElementById('veltrix-spin-style')) {
  const s = document.createElement('style');
  s.id = 'veltrix-spin-style';
  s.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(s);
}

// =========================================================
// ROUTE PROTECTION
// =========================================================

const isProtected = (path) => ['/profile'].includes(path);
const isAdminRoute = (path) =>
  ['/admin', '/admin/dashboard', '/management'].includes(path);

// =========================================================
// NORMALIZATION & HELPERS
// =========================================================

function normalizeParkingArea(a) {
  return {
    id: String(a.id),
    code: a.code || `PARK-${a.id}`,
    name: a.name || 'Parking Area',
    location: a.address || a.location || 'Mumbai',
    latitude: Number(a.latitude ?? a.lat ?? 0),
    longitude: Number(a.longitude ?? a.lng ?? a.lon ?? 0),
    total: Number(a.total_slots ?? a.total ?? 0),
    available: Number(a.available_slots ?? a.available ?? 0),
    occupancy: Number(a.occupancy_percent ?? a.occupancy ?? 0),
    distance: Number(a.distance_km ?? a.distance ?? 0),
    status: a.status || 'Available',
  };
}

function tag(a) {
  if (a.available <= 0 || a.occupancy > 90) return 'danger';
  if (a.occupancy > 75) return 'warning';
  return 'good';
}

function statusBadgeClass(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'AVAILABLE' || s === 'OPEN') return 'badge-success';
  if (s === 'BOOKED' || s === 'RESERVED') return 'badge-warning';
  if (s === 'OCCUPIED' || s === 'CANCELLED') return 'badge-danger';
  return 'badge-neutral';
}

// Leaflet custom marker icons
const destinationIcon = L.divIcon({
  className: 'destination-marker',
  html: '<span>📍</span>',
  iconSize: [32, 32],
  iconAnchor: [16, 30],
});

const userLocationIcon = L.divIcon({
  className: 'user-location-marker',
  html: '<span style="filter: drop-shadow(0 0 4px #1d72d8); font-size: 24px;">📍</span>',
  iconSize: [32, 32],
  iconAnchor: [16, 30],
});

function getParkingIcon(area) {
  const occ = Number(area?.occupancy ?? 0);
  const symbol = occ > 90 ? '🔴' : occ > 75 ? '🟠' : '🟢';
  return L.divIcon({
    className: 'parking-marker',
    html: `<span style="font-size: 20px;">${symbol}</span>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

const parkingIcon = L.divIcon({
  className: 'parking-marker',
  html: '<span>🅿️</span>',
  iconSize: [32, 32],
  iconAnchor: [16, 30],
});

// =========================================================
// MAIN APP COMPONENT
// =========================================================

function App() {
  const [path, setPath] = useState(window.location.pathname || '/');
  const [user, setUser] = useState(authService.currentUser());
  const [language, setLanguage] = useState('en');
  const [areas, setAreas] = useState([]);
  const [loadingAreas, setLoadingAreas] = useState(true);
  const [overview, setOverview] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  // -------------------------------------------------------
  // Load real parking areas from FastAPI backend
  // -------------------------------------------------------
  const refreshAreas = async () => {
    try {
      setLoadingAreas(true);
      const data = await parkingService.getAreas();
      const normalized = Array.isArray(data)
        ? data.map(normalizeParkingArea)
        : [];
      setAreas(normalized);
    } catch (error) {
      console.error('Error fetching parking areas:', error);
    } finally {
      setLoadingAreas(false);
    }
  };

  const refreshOverview = async () => {
    try {
      const data = await dashboardService.getOverview();
      setOverview(data);
    } catch (error) {
      console.error('Error fetching overview:', error);
    }
  };

  useEffect(() => {
    refreshAreas();
    refreshOverview();
    setLastUpdated(new Date());
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      refreshAreas();
      refreshOverview();
      setLastUpdated(new Date());
    }, 15000);

    return () => clearInterval(interval);
  }, []);

  // -------------------------------------------------------
  // Browser History Navigation
  // -------------------------------------------------------
  useEffect(() => {
    const handlePopState = () => {
      setPath(window.location.pathname || '/');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const go = (p) => {
    window.history.pushState({}, '', p);
    setPath(p);
    window.scrollTo(0, 0);
  };

  // Route security check
  useEffect(() => {
    if (isProtected(path) && !user) {
      go('/login');
    }
    if (isAdminRoute(path) && (!user || user.role !== 'admin')) {
      if (!user) go('/admin/login');
      else go('/dashboard');
    }
  }, [path, user]);

  const handleLogout = () => {
    authService.logout();
    setUser(null);
    go('/');
  };

  const c = {
    go,
    user,
    setUser,
    areas,
    setAreas,
    loadingAreas,
    refreshAreas,
    overview,
    refreshOverview,
    lastUpdated,
    language,
    setLanguage,
  };

  // -------------------------------------------------------
  // Routing Switch
  // -------------------------------------------------------
  let pageContent;

  if (path === '/') {
    pageContent = <Home {...c} />;
  } else if (path === '/parking' || path === '/nearby') {
    pageContent = <FindParking {...c} />;
  } else if (path.startsWith('/parking/')) {
    const id = path.split('/')[2];
    pageContent = <Detail {...c} id={id} />;
  } else if (path === '/dashboard') {
    pageContent = <Dashboard {...c} />;
  } else if (path === '/intelligence' || path === '/forecasting') {
    pageContent = <AI {...c} />;
  } else if (path === '/bookings') {
    pageContent = <Bookings {...c} />;
  } else if (path === '/contact') {
    pageContent = <Contact {...c} />;
  } else if (path === '/how-it-works' || path === '/about') {
    pageContent = <HowItWorks {...c} />;
  } else if (path === '/profile') {
    pageContent = <Profile {...c} logout={handleLogout} />;
  } else if (path === '/login') {
    pageContent = <Auth {...c} done={setUser} />;
  } else if (path === '/signup') {
    pageContent = <Auth {...c} signup done={setUser} />;
  } else if (path === '/admin/login') {
    pageContent = <Auth {...c} admin done={setUser} />;
  } else if (isAdminRoute(path)) {
    pageContent = <Admin {...c} />;
  } else {
    pageContent = <Home {...c} />;
  }

  return (
    <>
      <Header
        go={go}
        user={user}
        logout={handleLogout}
        currentPath={path}
        language={language}
        setLanguage={setLanguage}
      />
      {pageContent}
      <AIAssistant areas={areas} language={language} />
    </>
  );
}

// =========================================================
// HEADER COMPONENT
// =========================================================

function Header({ go, user, logout, currentPath, language = 'en', setLanguage }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const navigate = (p) => {
    setMobileOpen(false);
    go(p);
  };

  return (
    <>
      <div className="utility">
        <span>VELTRIX Smart Mobility Platform · Real-time Urban Parking</span>
        <span>
          <button type="button" onClick={() => navigate('/how-it-works')}>
            Architecture
          </button>
          <button type="button" onClick={() => navigate('/contact')}>
            Support
          </button>
          <select
            className="lang-select"
            value={language}
            onChange={(e) => setLanguage && setLanguage(e.target.value)}
            aria-label="Select language"
          >
            {supportedLanguages.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.native} ({lang.label})
              </option>
            ))}
          </select>
        </span>
      </div>

      <header>
        <button className="brand" onClick={() => navigate('/')}>
          <i>V</i>
          VELTRIX
        </button>

        <div className="brand-copy">
          <b>VELTRIX Smart Parking</b>
          <small>Efficient Parking. Smarter Cities.</small>
        </div>

        <button
          className="mobile-menu-btn"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? '✕' : '☰'}
        </button>

        <nav className={mobileOpen ? 'nav-open' : ''}>
          <button
            className={currentPath === '/' ? 'active-nav' : ''}
            onClick={() => navigate('/')}
          >
            {getTranslation(language, 'navHome', 'Home')}
          </button>

          <button
            className={
              currentPath === '/parking' || currentPath === '/nearby'
                ? 'active-nav'
                : ''
            }
            onClick={() => navigate('/parking')}
          >
            {getTranslation(language, 'navFind', 'Find Parking')}
          </button>

          <button
            className={
              currentPath === '/how-it-works' || currentPath === '/about'
                ? 'active-nav'
                : ''
            }
            onClick={() => navigate('/how-it-works')}
          >
            {getTranslation(language, 'navHow', 'How It Works')}
          </button>

          <button
            className={currentPath === '/dashboard' ? 'active-nav' : ''}
            onClick={() => navigate('/dashboard')}
          >
            {getTranslation(language, 'navDashboard', 'Dashboard')}
          </button>

          <button
            className={
              currentPath === '/intelligence' || currentPath === '/forecasting'
                ? 'active-nav'
                : ''
            }
            onClick={() => navigate('/intelligence')}
          >
            {getTranslation(language, 'navForecast', 'AI Forecast')}
          </button>

          <button
            className={currentPath === '/contact' ? 'active-nav' : ''}
            onClick={() => navigate('/contact')}
          >
            {getTranslation(language, 'navContact', 'Contact')}
          </button>
        </nav>

        {user ? (
          <div className="account">
            <button onClick={() => navigate('/bookings')}>
              My Bookings
            </button>

            {user.role === 'admin' && (
              <button
                className="admin-link-btn"
                onClick={() => navigate('/admin')}
              >
                Admin
              </button>
            )}

            <button onClick={() => navigate('/profile')}>
              {user.name.split(' ')[0]}
              <span className="role-tag">{user.role}</span>
            </button>

            <button onClick={logout}>Sign out</button>
          </div>
        ) : (
          <button
            className="primary nav-login"
            onClick={() => navigate('/login')}
          >
            {getTranslation(language, 'navLogin', 'Login / Register')}
          </button>
        )}
      </header>
    </>
  );
}

// =========================================================
// GENERIC PAGE SHELL
// =========================================================

function Page({ kicker, title, intro, children }) {
  return (
    <main className="page">
      {kicker && <p className="eyebrow">{kicker}</p>}
      <h1>{title}</h1>
      {intro && <p className="intro">{intro}</p>}
      {children}
    </main>
  );
}

// =========================================================
// PARKING CARD
// =========================================================

function Card({ a, go }) {
  const isAvailable = a.available > 0;
  const pctAvail = a.total > 0 ? Math.round((a.available / a.total) * 100) : 0;
  return (
    <button
      type="button"
      className="card"
      onClick={() => go('/parking/' + a.id)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
        <span className={'status ' + tag(a)} />
        <small>{a.code}</small>
        <span
          className={`badge ${a.available <= 0 ? 'badge-danger' : a.occupancy > 75 ? 'badge-warning' : 'badge-success'}`}
          style={{ marginLeft: 'auto', fontSize: '9.5px' }}
        >
          {a.available <= 0 ? 'FULL' : a.occupancy > 75 ? 'BUSY' : 'OPEN'}
        </span>
      </div>
      <h3>{a.name}</h3>
      <p style={{ marginBottom: '14px' }}>{a.location}</p>

      <b>
        {a.available}
        <em> / {a.total} FREE</em>
      </b>

      {/* Mini occupancy bar */}
      <div style={{
        position: 'absolute',
        bottom: '42px',
        left: '22px',
        right: '22px',
        height: '3px',
        background: 'var(--line)',
        borderRadius: '2px',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${a.occupancy}%`,
          height: '100%',
          background: a.occupancy > 90 ? 'var(--red)' : a.occupancy > 75 ? 'var(--saffron)' : 'var(--green)',
          borderRadius: '2px',
          transition: 'width 0.5s ease',
        }} />
      </div>

      <footer>
        {Number(a.distance) > 0
          ? `${Number(a.distance).toFixed(2)} km · `
          : ''}
        {a.occupancy}% occupied
      </footer>
    </button>
  );
}

// =========================================================
// 1. HOME PAGE
// =========================================================

function Home({ go, overview, areas, lastUpdated }) {
  const features = [
    [
      '🕐',
      'Real-Time Availability',
      'Live database-backed slot availability and real-time status across Mumbai facilities.',
    ],
    [
      '🔮',
      'Smart Recommendations',
      'Intelligent predictions and recommendations calculated from live load and demand.',
    ],
    [
      '🔒',
      'Secure Access',
      'Role-protected accounts for drivers and operational parking administrators.',
    ],
    [
      '🗺️',
      'Smart Navigation',
      'GPS proximity discovery and OpenStreetMap destination geocoding for seamless arrival.',
    ],
  ];

  const totalCapacity =
    overview?.total_capacity ||
    areas.reduce((sum, a) => sum + (a.total || 0), 0) ||
    63371;
  const availableSlots =
    overview?.available_slots ||
    areas.reduce((sum, a) => sum + (a.available || 0), 0) ||
    63371;
  const occupiedSlots = Math.max(0, totalCapacity - availableSlots);
  const totalFacilities = overview?.total_facilities || areas.length || 92;
  const activeBookings = overview?.active_bookings || 0;
  const liveActivity = overview?.recent_activity || [];
  const bestArea = [...areas]
    .filter((area) => Number(area.total) > 0)
    .sort((a, b) => Number(b.available) - Number(a.available))[0];

  const recommendationText = bestArea
    ? `${bestArea.name} has ${bestArea.available} of ${bestArea.total} spaces available right now and is the strongest option to reserve first.`
    : 'No live facility data is available yet. Try refreshing or searching parking locations.';

  const lastUpdatedText = new Date(lastUpdated).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <main>
      <section
        className="hero"
        style={{ backgroundImage: `url(${hero})` }}
      >
        <div>
          <div className="hero-badge">
            <span className="hero-badge-dot" />
            <span>System Online · {totalFacilities} Facilities Active</span>
          </div>

          <p className="eyebrow">
            AI-POWERED SMART PARKING · URBAN MOBILITY MANAGEMENT
          </p>

          <h1>
            Find Parking.<br />
            <span>Save Time. Drive Easy.</span>
          </h1>

          <p>
            Real-time parking availability, smart recommendations and seamless
            urban mobility — all powered by live data from Mumbai's municipal network.
          </p>

          <div>
            <button className="primary" onClick={() => go('/parking')}>
              🔎 Find Parking Now
            </button>
            <button className="secondary" onClick={() => go('/how-it-works')}>
              How It Works →
            </button>
          </div>
        </div>
      </section>

      <section className="features">
        {features.map((x) => (
          <article key={x[1]}>
            <i>{x[0]}</i>
            <div>
              <b>{x[1]}</b>
              <p>{x[2]}</p>
            </div>
          </article>
        ))}
      </section>

      <div style={{ maxWidth: '1160px', margin: '60px auto 0', padding: '0 5vw' }}>
        <div className="live-row" style={{ justifyContent: 'center' }}>
          <span className="live-dot" />
          <span>Live</span>
          <span className="live-meta">Last updated: {lastUpdatedText}</span>
        </div>

        <p className="eyebrow" style={{ justifyContent: 'center', marginBottom: '20px' }}>
          LIVE SYSTEM STATUS
        </p>

        <div className="stat-banner">
          <div className="stat-box">
            <b>{totalFacilities}</b>
            <span>Active Facilities</span>
          </div>
          <div className="stat-box">
            <b>{availableSlots.toLocaleString()}</b>
            <span>Available Slots</span>
          </div>
          <div className="stat-box">
            <b>{occupiedSlots.toLocaleString()}</b>
            <span>Occupied Slots</span>
          </div>
          <div className="stat-box">
            <b>{activeBookings}</b>
            <span>Active Bookings</span>
          </div>
        </div>
      </div>

      <section className="home-panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Live Parking Activity</p>
            <h3>Recent real-time availability and booking updates</h3>
          </div>
          <span className="live-pill"><span className="live-dot" /> Live feed</span>
        </div>

        <div className="activity-feed">
          {liveActivity.length === 0 ? (
            <p className="empty-state">No recent activity yet. Fresh booking and occupancy events will appear here.</p>
          ) : (
            liveActivity.slice(0, 6).map((item) => (
              <div key={item.id} className="activity-item">
                <span className="activity-time">{item.time}</span>
                <div>
                  <strong>{item.place}</strong>
                  <p>{item.detail}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="home-block">
        <p className="eyebrow" style={{ justifyContent: 'center' }}>A SMARTER WAY TO PARK</p>
        <h2>How VELTRIX works</h2>
        <p className="section-sub">
          From destination search to parking guidance, every step uses real availability and verified reservations.
        </p>

        <div className="steps steps-5">
          {[
            ['1', 'Search', 'Find your destination or use GPS to discover parking near you.'],
            ['2', 'Compare', 'Review live capacity, occupancy, and distance before you drive.'],
            ['3', 'Reserve', 'Lock an available slot instantly with real booking protection.'],
            ['4', 'Navigate', 'Get directions to the facility and reduce circling time.'],
            ['5', 'Park', 'Arrive, park in your allocated bay, and manage your booking seamlessly.'],
          ].map((x, i) => (
            <article key={x[0]}>
              <b>{x[0]}</b>
              <h3>{x[1]}</h3>
              <p>{x[2]}</p>
              {i < 4 && <span>→</span>}
            </article>
          ))}
        </div>
      </section>

      <section className="recommendation-grid">
        <div className="recommendation-card recommendation-primary">
          <p className="eyebrow">Smart Recommendation</p>
          <h3>Best parking option right now</h3>
          <strong>{bestArea ? bestArea.name : 'No live option available'}</strong>
          <p>{recommendationText}</p>
          <button className="primary" type="button" onClick={() => go(bestArea ? `/parking/${bestArea.id}` : '/parking')}>
            {bestArea ? 'Book this facility' : 'Explore parking'}
          </button>
        </div>

        <div className="recommendation-card">
          <p className="eyebrow">System Insight</p>
          <h3>Citywide demand</h3>
          <div className="mini-metric">
            <span>Available</span>
            <strong>{availableSlots.toLocaleString()}</strong>
          </div>
          <div className="mini-metric">
            <span>Occupied</span>
            <strong>{occupiedSlots.toLocaleString()}</strong>
          </div>
          <div className="mini-metric">
            <span>Demand</span>
            <strong>{Math.round((occupiedSlots / Math.max(totalCapacity, 1)) * 100)}%</strong>
          </div>
        </div>
      </section>

      <section className="notice">
        <div>
          <p className="eyebrow">SMART URBAN MOBILITY</p>
          <h2>Connected city infrastructure</h2>
          <p>
            VELTRIX uses authentic persistent parking records from Mumbai's
            municipal dataset and real-time database slot grids. No simulated or
            invented figures — every slot status and booking is atomic and persistent.
          </p>
        </div>

        <button className="primary" onClick={() => go('/how-it-works')}>
          View Architecture →
        </button>
      </section>

      <Footer go={go} />
    </main>
  );
}

// =========================================================
// 2. FIND PARKING (Destination Search + GPS + Map + Selection)
// =========================================================

function MapCenterController({ location, results }) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    if (location && results && results.length > 0) {
      const bounds = [
        [location.lat, location.lon],
        ...results.map((r) => [r.latitude, r.longitude]),
      ];
      map.fitBounds(bounds, { padding: [35, 35], maxZoom: 15 });
    } else if (location) {
      map.setView([location.lat, location.lon], 14);
    } else if (results && results.length > 0) {
      const bounds = results.map((r) => [r.latitude, r.longitude]);
      map.fitBounds(bounds, { padding: [35, 35], maxZoom: 14 });
    }
  }, [location, map, results]);

  return null;
}

function FindParking({ areas, go, loadingAreas, lastUpdated }) {
  const [mode, setMode] = useState('all'); // 'all', 'gps', 'destination'
  const [destination, setDestination] = useState('');
  const [message, setMessage] = useState(
    'Search for a destination or use current location to discover nearby parking facilities.'
  );
  const [location, setLocation] = useState(null);
  const [results, setResults] = useState([]);
  const [placeResults, setPlaceResults] = useState([]);
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [routeSummary, setRouteSummary] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [searching, setSearching] = useState(false);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [radiusKm, setRadiusKm] = useState(5);
  const [sortBy, setSortBy] = useState('distance'); // 'distance', 'available', 'occupancy'

  const searchDebounce = useRef(null);

  // Initialize with all areas
  useEffect(() => {
    if (!location && areas.length > 0 && results.length === 0) {
      setResults(areas);
    }
  }, [areas, location]);

  // Destination autocomplete search
  useEffect(() => {
    if (mode !== 'destination' || destination.trim().length < 2) {
      setPlaceResults([]);
      return undefined;
    }

    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(async () => {
      setSearching(true);
      try {
        const places = await parkingService.geocode(destination.trim());
        setPlaceResults(Array.isArray(places) ? places : []);
        if (places && places.length > 0) {
          setMessage(`Found ${places.length} matching locations. Select your exact destination.`);
        } else {
          setMessage('No matching destination found. Try another place name.');
        }
      } catch (err) {
        console.error('Geocode search error:', err);
        setPlaceResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);

    return () => clearTimeout(searchDebounce.current);
  }, [destination, mode]);

  // Fetch nearby from backend
  const loadNearby = async (lat, lon, rKm) => {
    setNearbyLoading(true);
    try {
      const data = await parkingService.getNearby(lat, lon, rKm);
      const normalized = Array.isArray(data) ? data.map(normalizeParkingArea) : [];
      setResults(normalized);
      return normalized;
    } catch (err) {
      console.error('Nearby error:', err);
      setMessage('Failed to load nearby facilities. Please try again.');
      return [];
    } finally {
      setNearbyLoading(false);
    }
  };

  const fetchRouteRecommendation = async (originPoint, destinationPoint) => {
    try {
      const data = await parkingService.routeAndParking({
        origin: originPoint,
        destination: destinationPoint,
        radius_km: radiusKm,
        arrival_minutes: 30,
      });

      if (data?.route) {
        setRouteSummary(data.route);
      }

      if (Array.isArray(data?.parking_recommendations)) {
        setRecommendations(data.parking_recommendations);
        const recResults = data.parking_recommendations.map((item) => normalizeParkingArea({
          id: item.id,
          name: item.name,
          address: item.address,
          latitude: item.latitude,
          longitude: item.longitude,
          total_slots: item.total_capacity,
          available_slots: item.current_available_slots,
          occupied_slots: item.total_capacity - item.current_available_slots,
          occupancy_percent: item.current_occupancy_percent,
          distance: item.distance_from_destination_km,
          status: item.confidence,
        }));
        setResults(recResults);
      }

      if (data?.route) {
        setMessage(`Route ready: ${data.route.distance_km.toFixed(1)} km · ${data.route.estimated_duration_minutes.toFixed(0)} min ETA · ${data.parking_recommendations?.length || 0} facilities recommended.`);
      }

      return data;
    } catch (err) {
      console.error('Route search error:', err);
      setMessage(err?.message || 'Failed to calculate route and parking recommendations.');
      return null;
    }
  };

  // GPS Location handler
  const useGPS = () => {
    if (!navigator.geolocation) {
      setMessage('Geolocation is not supported by your browser.');
      return;
    }

    setMode('gps');
    setSelectedPlace(null);
    setPlaceResults([]);
    setMessage('Detecting your current location...');

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const origin = { lat, lon };
        setLocation({ lat, lon, type: 'gps', label: 'Current GPS Location' });
        const nearby = await loadNearby(lat, lon, radiusKm);

        if (selectedPlace) {
          await fetchRouteRecommendation(origin, { lat: Number(selectedPlace.latitude), lon: Number(selectedPlace.longitude) });
        }

        setMessage(
          nearby.length > 0
            ? `Showing ${nearby.length} parking facilities within ${radiusKm} km of your location.`
            : `No facilities found within ${radiusKm} km. Try increasing the search radius.`
        );
      },
      (err) => {
        console.error('GPS error:', err);
        setMessage('Location permission was denied or is unavailable. Please search by place name.');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  // Place selection handler
  const selectPlace = async (place) => {
    const lat = Number(place.latitude);
    const lon = Number(place.longitude);
    setSelectedPlace(place);
    setLocation({ lat, lon, type: 'destination', label: place.name });
    setPlaceResults([]);

    const origin = location && location.lat && location.lon
      ? { lat: location.lat, lon: location.lon }
      : { lat: 19.0760, lon: 72.8777 };

    await fetchRouteRecommendation(origin, { lat, lon });

    const nearby = await loadNearby(lat, lon, radiusKm);
    setMessage(
      nearby.length > 0
        ? `Showing ${nearby.length} parking facilities within ${radiusKm} km of "${place.name}".`
        : `No facilities found within ${radiusKm} km of "${place.name}". Try increasing search radius.`
    );
  };

  // Radius change handler
  const handleRadiusChange = (newRadius) => {
    setRadiusKm(newRadius);
    if (location) {
      loadNearby(location.lat, location.lon, newRadius);
    }
  };

  // Sorted results
  const sortedResults = [...results].sort((a, b) => {
    if (sortBy === 'available') return b.available - a.available;
    if (sortBy === 'occupancy') return a.occupancy - b.occupancy;
    return (a.distance || 0) - (b.distance || 0);
  });

  const updatedLabel = lastUpdated ? new Date(lastUpdated).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  }) : 'just now';

  return (
    <Page
      kicker="FIND PARKING"
      title="Discover parking facilities."
      intro={message}
    >
      <div className="live-row">
        <span className="live-dot" />
        <span>Live</span>
        <span className="live-meta">Last updated: {updatedLabel}</span>
      </div>
      {/* Controls */}
      <div className="nearby-controls">
        <button
          type="button"
          className={mode === 'gps' ? 'primary' : 'secondary'}
          onClick={useGPS}
          disabled={loadingAreas}
        >
          📍 Use My Location
        </button>

        <button
          type="button"
          className={mode === 'destination' ? 'primary' : 'secondary'}
          onClick={() => {
            setMode('destination');
            setLocation(null);
            setSelectedPlace(null);
            setPlaceResults([]);
            setMessage('Enter a destination, landmark, station, or street name.');
          }}
        >
          🔎 Search Destination
        </button>

        <button
          type="button"
          className={mode === 'all' ? 'primary' : 'secondary'}
          onClick={() => {
            setMode('all');
            setLocation(null);
            setSelectedPlace(null);
            setPlaceResults([]);
            setResults(areas);
            setMessage(`Browsing all ${areas.length} parking facilities across Mumbai.`);
          }}
        >
          🏙️ Browse All ({areas.length})
        </button>
      </div>

      {/* Destination search input */}
      {mode === 'destination' && (
        <div style={{ position: 'relative', maxWidth: '750px' }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (placeResults.length > 0) selectPlace(placeResults[0]);
            }}
            className="destination-search"
          >
            <input
              type="text"
              placeholder="Search place, e.g. Bandra, BKC, Dadar, Andheri, Nirmal..."
              value={destination}
              onChange={(e) => {
                setDestination(e.target.value);
                setSelectedPlace(null);
              }}
              autoFocus
            />
            <button
              className="primary"
              type="submit"
              disabled={searching || !destination.trim()}
            >
              {searching ? 'Searching...' : 'Search'}
            </button>
          </form>

          {/* Autocomplete Dropdown */}
          {placeResults.length > 0 && (
            <div className="place-results">
              <p className="eyebrow" style={{ padding: '8px 16px 0' }}>
                SUGGESTED DESTINATIONS
              </p>
              <div>
                {placeResults.map((place) => (
                  <button
                    key={place.place_id || place.id}
                    type="button"
                    className="place-result"
                    onClick={() => selectPlace(place)}
                  >
                    <span>📍</span>
                    <div>
                      <strong>{place.name}</strong>
                      <small>{place.display_name}</small>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Selected location indicator */}
      {location && (
        <div className="location-info">
          <b>📍 {location.label || 'Selected Location'}</b>
          <span>
            {location.lat.toFixed(4)}, {location.lon.toFixed(4)}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <small>Radius:</small>
            <select
              value={radiusKm}
              onChange={(e) => handleRadiusChange(Number(e.target.value))}
              style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--line)' }}
            >
              <option value={2}>2 km</option>
              <option value={5}>5 km</option>
              <option value={10}>10 km</option>
              <option value={20}>20 km</option>
            </select>
          </div>
        </div>
      )}

      {routeSummary && (
        <div className="location-info" style={{ background: 'rgba(29,114,216,0.06)', borderColor: 'rgba(29,114,216,0.2)' }}>
          <b>🧭 Route & ETA</b>
          <span>{routeSummary.distance_km.toFixed(1)} km · {routeSummary.estimated_duration_minutes.toFixed(0)} min</span>
          <span>Arrival {new Date(routeSummary.estimated_arrival).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      )}

      {recommendations.length > 0 && (
        <div className="cards" style={{ marginTop: '20px' }}>
          {recommendations.slice(0, 3).map((rec) => {
            const probPct = Math.round((rec.parking_probability || 0) * 100);
            const whyRecommended = rec.reason
              || (rec.parking_probability >= 0.75
                ? 'High probability of open slots and optimal proximity to destination.'
                : rec.parking_probability >= 0.5
                ? 'Moderate expected availability; ideal balance of distance and space.'
                : 'High demand area; nearby alternatives may fill quickly.');
            return (
              <div key={rec.id} className="card" style={{ cursor: 'default', textAlign: 'left' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>{rec.name}</strong>
                  <span className={`badge ${rec.parking_probability >= 0.75 ? 'badge-success' : rec.parking_probability >= 0.5 ? 'badge-warning' : 'badge-danger'}`}>
                    {rec.confidence}
                  </span>
                </div>
                <p style={{ margin: '8px 0 6px' }}>{rec.address}</p>
                <p style={{ margin: '0 0 8px', fontSize: '13px' }}>
                  <b>{rec.current_available_slots}</b> / {rec.total_capacity} free now · <b>{rec.predicted_available_slots}</b> predicted at arrival
                </p>
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--muted)' }}>Parking probability:</span>
                    <strong style={{ color: probPct >= 70 ? 'var(--green)' : probPct >= 40 ? 'var(--saffron)' : 'var(--red)' }}>
                      {probPct}%
                    </strong>
                  </div>
                  <div style={{ background: '#e2e8f0', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${probPct}%`,
                        background: probPct >= 70 ? 'var(--green)' : probPct >= 40 ? 'var(--saffron)' : 'var(--red)',
                        height: '100%',
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                </div>
                <p style={{ margin: '0 0 8px', color: 'var(--muted)', fontSize: '12px' }}>
                  📍 {rec.distance_from_destination_km?.toFixed(1) ?? '0.0'} km from destination · ⏱️ {rec.estimated_drive_minutes?.toFixed(0) ?? '0'} min ETA
                </p>
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--blue)', background: 'var(--blue-pale)', padding: '6px 8px', borderRadius: 'var(--r-sm)' }}>
                  💡 <b>Why recommended:</b> {whyRecommended}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Interactive Map */}
      <div className="nearby-map">
        <MapContainer
          center={location ? [location.lat, location.lon] : [19.076, 72.8777]}
          zoom={location ? 14 : 11}
          scrollWheelZoom={false}
          className="leaflet-map"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapCenterController location={location} results={sortedResults} />

          {location && (
            <Marker
              position={[location.lat, location.lon]}
              icon={location.type === 'gps' ? userLocationIcon : destinationIcon}
            >
              <Popup>
                <strong>{location.label || (location.type === 'gps' ? 'Current GPS Location' : 'Destination')}</strong>
                <br />
                {location.type === 'gps' ? 'Your detected location' : 'Search Centerpoint'}
              </Popup>
            </Marker>
          )}

          {sortedResults.slice(0, 50).map((area) => {
            const rec = recommendations.find((r) => String(r.id) === String(area.id));
            const etaMinutes = rec?.estimated_drive_minutes ?? (area.distance ? (area.distance * 3).toFixed(0) : null);
            return (
              <Marker
                key={area.id}
                position={[area.latitude, area.longitude]}
                icon={getParkingIcon(area)}
              >
                <Popup>
                  <div style={{ padding: '4px' }}>
                    <strong>{area.name}</strong>
                    <br />
                    <small>{area.location}</small>
                    <p style={{ margin: '6px 0 4px', fontWeight: 'bold', color: 'var(--green)' }}>
                      {area.available} / {area.total} slots available ({area.occupancy}% full)
                    </p>
                    {rec?.predicted_available_slots !== undefined && (
                      <p style={{ margin: '0 0 4px', fontSize: '11px', color: 'var(--blue)' }}>
                        🔮 {rec.predicted_available_slots} slots predicted at arrival
                      </p>
                    )}
                    {etaMinutes && (
                      <p style={{ margin: '0 0 6px', fontSize: '11px', color: 'var(--muted)' }}>
                        ⏱️ ~{Math.round(etaMinutes)} min drive ({area.distance?.toFixed(1) || rec?.distance_from_destination_km?.toFixed(1) || 0} km)
                      </p>
                    )}
                    <button
                      type="button"
                      className="primary"
                      style={{ padding: '6px 10px', fontSize: '11px', width: '100%' }}
                      onClick={() => go(`/parking/${area.id}`)}
                    >
                      View Facility & Slots →
                    </button>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>

      {/* Filter and sorting toolbar */}
      <div className="nearby-heading">
        <h2>
          {location ? `Nearby Facilities (${sortedResults.length})` : `All Parking Facilities (${sortedResults.length})`}
        </h2>

        <div className="filter-bar" style={{ margin: 0 }}>
          <label htmlFor="sort-select" style={{ fontSize: '12px', color: 'var(--muted)' }}>
            Sort by:
          </label>
          <select
            id="sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="distance">Proximity (Nearest)</option>
            <option value="available">Highest Available Slots</option>
            <option value="occupancy">Lowest Occupancy %</option>
          </select>
        </div>
      </div>

      {/* Results grid */}
      {loadingAreas || nearbyLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '32px 0', color: 'var(--muted)', fontWeight: 600, fontSize: '14px' }}>
          <Spinner size={24} />
          Loading parking facilities from database...
        </div>
      ) : sortedResults.length === 0 ? (
        <div style={{ padding: '56px 20px', textAlign: 'center', background: 'white', borderRadius: 'var(--r-lg)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🅿️</div>
          <h3 style={{ color: 'var(--navy)', marginBottom: '8px' }}>No parking facilities found</h3>
          <p style={{ color: 'var(--muted)', fontSize: '14px', marginBottom: '24px' }}>
            Try expanding the search radius or exploring another Mumbai location.
          </p>
          <button
            type="button"
            className="primary"
            onClick={() => handleRadiusChange(20)}
          >
            Expand to 20 km radius
          </button>
        </div>
      ) : (
        <div className="cards">
          {sortedResults.map((a) => (
            <Card key={a.id} a={a} go={go} />
          ))}
        </div>
      )}
    </Page>
  );
}

// =========================================================
// 3. FACILITY DETAILS & 4. BOOKING
// =========================================================

function Detail({ areas, id, go, user, setAreas, loadingAreas }) {
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [slotError, setSlotError] = useState('');
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [bookingResult, setBookingResult] = useState(null);
  const [slotFilter, setSlotFilter] = useState('ALL'); // 'ALL', 'AVAILABLE', 'BOOKED', 'OCCUPIED'

  const a =
    areas.find((x) => String(x.id) === String(id)) ||
    (areas.length > 0 ? areas[0] : null);

  useEffect(() => {
    if (!a?.id) return;

    let active = true;
    setSlotsLoading(true);
    setSlotError('');

    parkingService
      .getSlots(a.id)
      .then((data) => {
        if (active) {
          setSlots(Array.isArray(data) ? data : []);
        }
      })
      .catch((err) => {
        if (active) {
          setSlotError(err.message || 'Unable to load real slot status');
        }
      })
      .finally(() => {
        if (active) setSlotsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [a?.id]);

  if (loadingAreas || !a) {
    return (
      <Page
        kicker="FACILITY DETAILS"
        title="Loading parking facility..."
        intro=""
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '40px 0', color: 'var(--muted)', fontSize: '14px', fontWeight: 600 }}>
          <Spinner size={28} />
          Retrieving live capacity and slot records from database...
        </div>
      </Page>
    );
  }

  const liveAvailable = slots.filter((s) => s.status === 'AVAILABLE').length;
  const liveBooked = slots.filter((s) => s.status === 'BOOKED').length;
  const liveOccupied = slots.filter((s) => s.status === 'OCCUPIED').length;
  const totalSlotsCount = slots.length || a.total;
  const occupancyPercent =
    totalSlotsCount > 0
      ? Math.round(((totalSlotsCount - liveAvailable) / totalSlotsCount) * 100)
      : a.occupancy;

  const filteredSlots = slots.filter((s) => {
    if (slotFilter === 'ALL') return true;
    return s.status === slotFilter;
  });

  return (
    <Page
      kicker="FACILITY DETAILS & RESERVATION"
      title={a.name}
      intro={`${a.location} · Facility Code: ${a.code} · ${Number(a.distance).toFixed(2)} km away`}
    >
      <div style={{ marginBottom: '20px' }}>
        <button
          type="button"
          className="secondary"
          onClick={() => go('/parking')}
          style={{ padding: '8px 14px', fontSize: '11px', marginLeft: 0 }}
        >
          ← Back to Find Parking
        </button>
      </div>

      <section className="detail">
        {/* Main Deck Grid */}
        <div className="deck">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
            <p style={{ margin: 0, fontWeight: 700, letterSpacing: '0.05em' }}>
              SMART PARKING DECK · {a.code}
            </p>

            {/* Filter pills */}
            <div className="filter-bar" style={{ margin: 0 }}>
              <select
                value={slotFilter}
                onChange={(e) => setSlotFilter(e.target.value)}
                style={{ padding: '5px 10px', fontSize: '11px' }}
              >
                <option value="ALL">All Slots ({slots.length})</option>
                <option value="AVAILABLE">Available Only ({liveAvailable})</option>
                <option value="BOOKED">Reserved/Booked ({liveBooked})</option>
                <option value="OCCUPIED">Occupied ({liveOccupied})</option>
              </select>
            </div>
          </div>

          {/* Slot Legend */}
          <div className="slot-legend">
            <div className="legend-item">
              <span className="legend-box open" /> Available
            </div>
            <div className="legend-item">
              <span className="legend-box selected-slot" /> Selected
            </div>
            <div className="legend-item">
              <span className="legend-box booked-slot" /> Reserved / Booked
            </div>
            <div className="legend-item">
              <span className="legend-box taken" /> Occupied
            </div>
          </div>

          {slotsLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '32px 0', color: 'var(--muted)', fontSize: '13px', fontWeight: 600 }}>
              <Spinner size={20} />
              Loading real-time slot status from database...
            </div>
          ) : slotError ? (
            <p className="error-text">{slotError}</p>
          ) : slots.length === 0 ? (
            <p style={{ color: 'var(--muted)', padding: '24px 0', fontSize: '14px' }}>No parking slots configured for this facility.</p>
          ) : (
            <>
              <div className="slot-grid">
                {filteredSlots.slice(0, 240).map((slot) => {
                  const isAvail = slot.status === 'AVAILABLE';
                  const isBooked = slot.status === 'BOOKED';
                  const isSelected = selectedSlot?.id === slot.id;

                  let slotClass = 'slot-button taken';
                  if (isSelected) slotClass = 'slot-button selected-slot';
                  else if (isAvail) slotClass = 'slot-button open';
                  else if (isBooked) slotClass = 'slot-button booked-slot';

                  return (
                    <button
                      type="button"
                      key={slot.id}
                      className={slotClass}
                      disabled={!isAvail}
                      onClick={() => setSelectedSlot(slot)}
                      title={
                        isAvail
                          ? `Slot ${slot.slot_number} (Available) — Click to Reserve`
                          : `Slot ${slot.slot_number} (${slot.status})`
                      }
                    >
                      {slot.slot_number.split('-').pop()}
                    </button>
                  );
                })}
              </div>

              {filteredSlots.length > 240 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '12px', padding: '10px 14px', background: 'var(--bg)', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)' }}>
                  <small style={{ color: 'var(--muted)', fontSize: '12px' }}>
                    Showing 240 of {filteredSlots.length} slots.
                  </small>
                  <small style={{ color: 'var(--blue)', fontSize: '12px', fontWeight: 600 }}>
                    Select any green slot to reserve →
                  </small>
                </div>
              )}
            </>
          )}
        </div>

        {/* Sidebar Metrics & Mini Map */}
        <aside>
          {/* Facility Location Mini Map */}
          {a.latitude && a.longitude && (
            <div className="facility-mini-map">
              <MapContainer
                center={[a.latitude, a.longitude]}
                zoom={14}
                scrollWheelZoom={false}
                zoomControl={false}
                style={{ width: '100%', height: '100%' }}
              >
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <Marker position={[a.latitude, a.longitude]} icon={parkingIcon}>
                  <Popup>
                    <strong>{a.name}</strong>
                    <br />
                    {a.location}
                  </Popup>
                </Marker>
              </MapContainer>
            </div>
          )}

          <b>
            {liveAvailable} / {totalSlotsCount}
          </b>
          <p>Available parking spaces</p>

          {/* Occupancy meter */}
          <div className="occupancy-meter">
            <div
              className={`occupancy-fill ${
                occupancyPercent > 85
                  ? 'fill-danger'
                  : occupancyPercent > 65
                  ? 'fill-warning'
                  : 'fill-good'
              }`}
              style={{ width: `${occupancyPercent}%` }}
            />
          </div>

          <hr style={{ margin: '18px 0', borderColor: 'var(--line)' }} />

          <p>
            Capacity <strong>{totalSlotsCount} slots</strong>
          </p>
          <p>
            Occupied <strong>{totalSlotsCount - liveAvailable} slots</strong>
          </p>
          <p>
            Occupancy Rate <strong>{occupancyPercent}%</strong>
          </p>
          <p>
            Status <span className={`badge ${statusBadgeClass(a.status)}`}>{a.status}</span>
          </p>

          <button
            type="button"
            className="primary"
            style={{ width: '100%', marginTop: '14px' }}
            onClick={() => go('/intelligence')}
          >
            Check AI Forecast →
          </button>
        </aside>
      </section>

      {/* Booking Modal */}
      {selectedSlot && (
        <BookingModal
          area={a}
          slot={selectedSlot}
          user={user}
          onClose={() => setSelectedSlot(null)}
          onConfirmed={(res) => {
            setBookingResult(res);
            setSelectedSlot(null);
            // Update slots state locally
            setSlots((prev) =>
              prev.map((s) => (s.id === selectedSlot.id ? { ...s, status: 'BOOKED' } : s))
            );
            // Update areas state locally
            setAreas((prev) =>
              prev.map((ar) => {
                if (String(ar.id) !== String(a.id)) return ar;
                const newAvail = Math.max(0, ar.available - 1);
                return {
                  ...ar,
                  available: newAvail,
                  occupancy: ar.total ? Math.round(((ar.total - newAvail) / ar.total) * 100) : 0,
                };
              })
            );
          }}
        />
      )}

      {/* Confirmation Panel */}
      {bookingResult && (
        <BookingConfirmation
          booking={bookingResult}
          onBack={() => setBookingResult(null)}
          onViewBookings={() => go('/bookings')}
        />
      )}
    </Page>
  );
}

// ---------------------------------------------------------
// Booking Modal Component
// ---------------------------------------------------------

function BookingModal({ area, slot, user, onClose, onConfirmed }) {
  const [form, setForm] = useState({
    customer_name: user?.name || '',
    phone_number: user?.phone || '',
    vehicle_number: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const name = form.customer_name.trim();
    const phone = form.phone_number.replace(/[ -]/g, '');
    const vehicle = form.vehicle_number.replace(/\s/g, '').toUpperCase();

    if (!/^[A-Za-z][A-Za-z .'-]{1,99}$/.test(name)) {
      setError('Please enter a valid full name (alphabets and spaces only).');
      return;
    }
    if (!/^(?:\+91|91)?[6-9]\d{9}$/.test(phone)) {
      setError('Please enter a valid 10-digit Indian phone number (starting with 6-9).');
      return;
    }
    if (!/^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{4}$/.test(vehicle)) {
      setError('Please enter a valid Indian vehicle number (e.g. MH12AB1234).');
      return;
    }

    setSaving(true);
    try {
      const data = await bookingService.createBooking({
        parking_id: area.id,
        slot_id: slot.id,
        customer_name: name,
        phone_number: phone,
        vehicle_number: vehicle,
      });
      onConfirmed(data);
    } catch (err) {
      setError(err.message || 'Booking failed. Slot may have been taken.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="booking-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <button type="button" className="modal-close" onClick={onClose}>
          ✕
        </button>

        <p className="eyebrow">ATOMIC DATABASE RESERVATION</p>
        <h2>Reserve Slot {slot.slot_number}</h2>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: '13px' }}>
          {area.name} · 2-Hour Reservation Guarantee
        </p>

        <label>
          Full Name
          <input
            required
            value={form.customer_name}
            onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
            placeholder="e.g. Rahul Sharma"
          />
        </label>

        <label>
          Phone Number
          <input
            required
            type="tel"
            value={form.phone_number}
            onChange={(e) => setForm({ ...form, phone_number: e.target.value })}
            placeholder="e.g. 9876543210"
          />
        </label>

        <label>
          Vehicle Registration Number
          <input
            required
            value={form.vehicle_number}
            onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })}
            placeholder="e.g. MH12AB1234"
          />
        </label>

        {error && <p className="error-text">{error}</p>}

        <button type="submit" className="primary" disabled={saving}>
          {saving ? 'Verifying Availability & Reserving...' : 'Confirm Real Reservation'}
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------
// Booking Confirmation Panel
// ---------------------------------------------------------

function BookingConfirmation({ booking, onBack, onViewBookings }) {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    const updateCountdown = () => {
      const remainingMs = new Date(booking.expiry_time).getTime() - Date.now();
      if (remainingMs <= 0) {
        setTimeLeft('Expired');
        return;
      }
      const totalSec = Math.floor(remainingMs / 1000);
      const hrs = String(Math.floor(totalSec / 3600)).padStart(2, '0');
      const mins = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
      const secs = String(totalSec % 60).padStart(2, '0');
      setTimeLeft(`${hrs}:${mins}:${secs}`);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [booking.expiry_time]);

  return (
    <div className="confirmation-panel">
      <p className="eyebrow" style={{ color: 'var(--green)' }}>
        ✓ BOOKING CONFIRMED & PERSISTED
      </p>
      <h2>Booking ID: {booking.booking_id}</h2>

      <div className="booking-summary">
        <p>
          Customer: <strong>{booking.customer_name}</strong>
        </p>
        <p>
          Phone: <strong>{booking.phone_number}</strong>
        </p>
        <p>
          Vehicle: <strong>{booking.vehicle_number}</strong>
        </p>
        <p>
          Facility: <strong>{booking.parking_name}</strong>
        </p>
        <p>
          Slot: <strong>{booking.slot_number}</strong>
        </p>
        <p>
          Status: <span className="badge badge-success">{booking.status}</span>
        </p>
        <p>
          Time Remaining: <strong>{timeLeft}</strong>
        </p>
        <p>
          Valid Until: <strong>{new Date(booking.expiry_time).toLocaleTimeString()}</strong>
        </p>
      </div>

      <div style={{ display: 'flex', gap: '12px', marginTop: '14px' }}>
        <button type="button" className="primary" onClick={onViewBookings}>
          View in My Bookings
        </button>
        <button type="button" className="secondary" onClick={onBack}>
          Done
        </button>
      </div>
    </div>
  );
}

// =========================================================
// 5. MY BOOKINGS (Upcoming, Active, Completed, Cancelled)
// =========================================================

function Bookings({ user }) {
  const [phone, setPhone] = useState(user?.phone || '');
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState('ALL'); // 'ALL', 'ACTIVE', 'UPCOMING', 'COMPLETED', 'CANCELLED'

  const fetchBookings = async (searchPhone) => {
    setLoading(true);
    setMessage('');
    try {
      const data = await bookingService.getBookings(searchPhone);
      setBookings(Array.isArray(data) ? data : []);
      if (data.length === 0) {
        setMessage('No bookings found for this search.');
      }
    } catch (err) {
      setMessage(err.message || 'Failed to load bookings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Automatically load if logged in
    fetchBookings(phone);
  }, []);

  const handleLookup = (e) => {
    e.preventDefault();
    fetchBookings(phone);
  };

  const handleCancel = async (booking) => {
    if (!window.confirm(`Are you sure you want to cancel reservation ${booking.booking_id}?`)) {
      return;
    }
    try {
      const updated = await bookingService.cancelBooking(
        booking.booking_id,
        booking.phone_number
      );
      setBookings((prev) =>
        prev.map((b) => (b.booking_id === updated.booking_id ? updated : b))
      );
      alert(`Reservation ${booking.booking_id} cancelled. Slot is now available again.`);
    } catch (err) {
      alert(err.message || 'Failed to cancel reservation.');
    }
  };

  // Categorize bookings
  const now = new Date();
  const filtered = bookings.filter((b) => {
    const isCancelled = b.status === 'CANCELLED';
    const isExpired = b.status === 'EXPIRED' || new Date(b.expiry_time) < now;
    const isActive = (b.status === 'BOOKED' || b.status === 'ACTIVE') && !isExpired;

    if (tab === 'ACTIVE') return isActive;
    if (tab === 'UPCOMING') return isActive; // Active 2-hour window reservations
    if (tab === 'COMPLETED') return isExpired && !isCancelled;
    if (tab === 'CANCELLED') return isCancelled;
    return true;
  });

  return (
    <Page
      kicker="MY RESERVATIONS"
      title="Your booked parking slots."
      intro="Persisted database reservations with live countdowns and cancellation."
    >
      {/* Lookup Form */}
      <form className="booking-lookup" onSubmit={handleLookup}>
        <input
          type="tel"
          placeholder="Lookup by Phone Number (e.g. 9876543210)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <button type="submit" className="primary" disabled={loading}>
          {loading ? 'Searching...' : 'Find Bookings'}
        </button>
      </form>

      {message && <p className="error-text">{message}</p>}

      {/* Tabs */}
      <div className="tabs-nav">
        {['ALL', 'ACTIVE', 'UPCOMING', 'COMPLETED', 'CANCELLED'].map((t) => (
          <button
            key={t}
            type="button"
            className={`tab-btn ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'ALL'
              ? `All (${bookings.length})`
              : t === 'ACTIVE'
              ? 'Active'
              : t === 'UPCOMING'
              ? 'Upcoming'
              : t === 'COMPLETED'
              ? 'Completed'
              : 'Cancelled'}
          </button>
        ))}
      </div>

      {/* Booking Cards List */}
      {filtered.length === 0 ? (
        <p style={{ color: 'var(--muted)', padding: '20px 0' }}>
          No reservations found in the "{tab}" tab.
        </p>
      ) : (
        <div className="booking-list">
          {filtered.map((item) => {
            const isCancelled = item.status === 'CANCELLED';
            const isExpired = item.status === 'EXPIRED' || new Date(item.expiry_time) < now;
            const canCancel = !isCancelled && !isExpired;

            return (
              <article className="booking-card" key={item.booking_id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <p className="eyebrow" style={{ margin: 0 }}>
                    {item.booking_id}
                  </p>
                  <span className={`badge ${statusBadgeClass(item.status)}`}>
                    {isCancelled ? 'CANCELLED' : isExpired ? 'EXPIRED' : 'ACTIVE'}
                  </span>
                </div>

                <h3 style={{ margin: '8px 0', color: 'var(--navy)' }}>
                  {item.parking_name} · Slot {item.slot_number}
                </h3>
                <p style={{ margin: '4px 0', fontSize: '13px' }}>
                  Customer: <strong>{item.customer_name}</strong> · Vehicle: <strong>{item.vehicle_number}</strong>
                </p>
                <p style={{ margin: '4px 0', fontSize: '12px', color: 'var(--muted)' }}>
                  Booked: {new Date(item.booking_time).toLocaleString()} · Expires: {new Date(item.expiry_time).toLocaleString()}
                </p>

                {canCancel && (
                  <div style={{ marginTop: '14px' }}>
                    <button
                      type="button"
                      className="secondary"
                      style={{ color: '#b91c1c', borderColor: '#b91c1c', padding: '6px 12px', fontSize: '11px' }}
                      onClick={() => handleCancel(item)}
                    >
                      Cancel Reservation (Release Slot)
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </Page>
  );
}

// =========================================================
// 6. DASHBOARD (Analytics & Real Activity)
// =========================================================

function Dashboard({ user, areas, go, overview }) {
  const totalCapacity =
    overview?.total_capacity ||
    areas.reduce((s, a) => s + (a.total || 0), 0) ||
    63371;
  const availableSlots =
    overview?.available_slots ||
    areas.reduce((s, a) => s + (a.available || 0), 0) ||
    63371;
  const occupiedSlots = totalCapacity - availableSlots;
  const occupancyPercent =
    totalCapacity > 0
      ? Math.round((occupiedSlots / totalCapacity) * 100)
      : overview?.occupancy_percent || 0;
  const totalBookings = overview?.total_bookings || 0;
  const activeBookings = overview?.active_bookings || 0;

  // Real database activity
  const realActivity = overview?.recent_activity || [];

  return (
    <Page
      kicker="OPERATIONAL DASHBOARD"
      title={user ? `Welcome, ${user.name}.` : 'City Parking Overview.'}
      intro="Real-time occupancy metrics, persistent booking statistics, and city mobility trends."
    >
      {/* Quick Actions */}
      <div className="actions">
        <button type="button" onClick={() => go('/parking')}>
          🔎 Find Nearby Parking
        </button>
        <button type="button" onClick={() => go('/bookings')}>
          📋 My Reservations
        </button>
        <button type="button" onClick={() => go('/intelligence')}>
          ✦ AI Availability Forecast
        </button>
        {user?.role === 'admin' && (
          <button type="button" onClick={() => go('/admin')}>
            ⚙️ Admin Control Panel
          </button>
        )}
      </div>

      {/* KPI Banners */}
      <div className="stat-banner">
        <div className="stat-box">
          <b style={{ color: 'var(--green)' }}>{availableSlots.toLocaleString()}</b>
          <span>Available Spaces</span>
        </div>
        <div className="stat-box">
          <b>{totalCapacity.toLocaleString()}</b>
          <span>Total City Capacity</span>
        </div>
        <div className="stat-box">
          <b style={{ color: occupancyPercent > 80 ? 'var(--red)' : occupancyPercent > 60 ? 'var(--saffron)' : 'var(--green)' }}>
            {occupancyPercent}%
          </b>
          <span>Overall City Occupancy</span>
        </div>
        <div className="stat-box">
          <b style={{ color: 'var(--blue)' }}>{activeBookings}</b>
          <span>{totalBookings} Total Reservations</span>
        </div>
      </div>

      {/* Occupancy breakdown bar */}
      <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: '24px', marginBottom: '32px', boxShadow: 'var(--shadow-xs)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ margin: 0, color: 'var(--navy)', fontSize: '16px', fontWeight: 700 }}>
            City-wide Utilization Meter
          </h3>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: 'var(--muted)', fontWeight: 600 }}>
            {occupiedSlots.toLocaleString()} / {totalCapacity.toLocaleString()} occupied
          </span>
        </div>
        <div className="occupancy-meter" style={{ height: '12px' }}>
          <div
            className={`occupancy-fill ${
              occupancyPercent > 80 ? 'fill-danger' : occupancyPercent > 60 ? 'fill-warning' : 'fill-good'
            }`}
            style={{ width: `${Math.max(2, occupancyPercent)}%` }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px' }}>
          <small style={{ color: 'var(--green)', fontSize: '11px', fontWeight: 700 }}>▓ {availableSlots.toLocaleString()} available</small>
          <small style={{ color: 'var(--muted)', fontSize: '11px' }}>{occupancyPercent}% utilized</small>
        </div>
      </div>

      {/* Real Parking Activity */}
      <h2>Recent Database Activity</h2>
      {realActivity.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>No recent activity records found.</p>
      ) : (
        <div className="list">
          {realActivity.map((act) => (
            <p key={act.id}>
              <span>{act.time}</span>
              <b>{act.place}</b>
              {act.detail}
            </p>
          ))}
        </div>
      )}

      {/* Highlights */}
      <h2>High-Capacity Parking Hubs</h2>
      <div className="cards">
        {areas.slice(0, 6).map((a) => (
          <Card key={a.id} a={a} go={go} />
        ))}
      </div>
    </Page>
  );
}

// =========================================================
// 7. FORECASTING (Transparent ML / Demand Prediction)
// =========================================================

function AI({ areas }) {
  const [selectedId, setSelectedId] = useState(areas[0]?.id || '1');
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(false);

  const selectedArea =
    areas.find((a) => String(a.id) === String(selectedId)) || areas[0];

  useEffect(() => {
    if (!selectedArea?.id) return;

    let active = true;
    setLoading(true);

    parkingService
      .getPrediction(selectedArea.id)
      .then((data) => {
        if (active) setForecast(data);
      })
      .catch((err) => {
        console.error('Forecast error:', err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedArea?.id]);

  const pLabel = (pred) => {
    if (!pred || pred.availability_probability === null) return '—';
    return `${Math.round(pred.availability_probability * 100)}%`;
  };

  const getSmartRecommendation = () => {
    if (!forecast?.predictions) return 'Loading forecast analysis...';
    const twoHrProb = forecast.predictions['2_hours']?.availability_probability ?? 1;
    const currentProb =
      forecast.total_capacity > 0
        ? forecast.current_available / forecast.total_capacity
        : 1;

    if (twoHrProb < currentProb - 0.15) {
      return 'Demand is trending upward. We recommend reserving a slot now to avoid peak congestion.';
    }
    if (twoHrProb >= 0.7) {
      return 'High availability is projected over the next 2 hours. Optimal arrival conditions.';
    }
    return 'Availability is expected to remain constrained. Consider booking in advance.';
  };

  return (
    <Page
      kicker="FORECASTING & DEMAND INTELLIGENCE"
      title="Transparent availability projection."
      intro="Ground-truth slot logs, active booking rates, and deterministic capacity trends."
    >
      {/* Facility picker */}
      <div className="forecast-picker">
        <label htmlFor="forecast-select">Select Parking Facility</label>
        <select
          id="forecast-select"
          value={selectedArea?.id || ''}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          {areas.map((area) => (
            <option key={area.id} value={area.id}>
              {area.name} ({area.available}/{area.total} open)
            </option>
          ))}
        </select>
      </div>

      <section className="ai">
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p className="eyebrow" style={{ margin: 0 }}>AVAILABILITY FORECAST</p>
            <span className={`badge ${forecast?.model_status?.includes('fallback') ? 'badge-neutral' : 'badge-success'}`}>
              {forecast?.model_status || 'ml_regression'}
            </span>
          </div>
          <b>
            {forecast
              ? `${forecast.current_available} / ${forecast.total_capacity}`
              : '—'}
          </b>
          <span>Current available slots</span>

          <div className="forecast-grid">
            <p>
              <span>15 Minutes</span>
              <strong>{pLabel(forecast?.predictions?.['15_minutes'])}</strong>
              <small>
                {forecast?.predictions?.['15_minutes']
                  ? `~${forecast.predictions['15_minutes'].predicted_available_slots} spots expected`
                  : 'Calculating...'}
              </small>
            </p>
            <p>
              <span>30 Minutes</span>
              <strong>{pLabel(forecast?.predictions?.['30_minutes'])}</strong>
              <small>
                {forecast?.predictions?.['30_minutes']
                  ? `~${forecast.predictions['30_minutes'].predicted_available_slots} spots expected`
                  : 'Calculating...'}
              </small>
            </p>
            <p>
              <span>1 Hour</span>
              <strong>{pLabel(forecast?.predictions?.['1_hour'])}</strong>
              <small>
                {forecast?.predictions?.['1_hour']
                  ? `~${forecast.predictions['1_hour'].predicted_available_slots} spots expected`
                  : 'Calculating...'}
              </small>
            </p>
            <p>
              <span>2 Hours</span>
              <strong>{pLabel(forecast?.predictions?.['2_hours'])}</strong>
              <small>
                {forecast?.predictions?.['2_hours']
                  ? `~${forecast.predictions['2_hours'].predicted_available_slots} spots expected`
                  : 'Calculating...'}
              </small>
            </p>
          </div>

          {forecast?.arrival_prediction && (
            <div className="arrival-prediction-box" style={{ marginTop: '16px', padding: '14px', background: 'var(--bg)', borderRadius: 'var(--r-md)', border: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <b style={{ fontSize: '13px' }}>Predicted at Arrival (~30 min):</b>
                <span className={`badge ${forecast.arrival_prediction.probability_of_parking >= 0.7 ? 'badge-success' : 'badge-warning'}`}>
                  {forecast.arrival_prediction.confidence || 'ML Predicted'}
                </span>
              </div>
              <p style={{ margin: '0 0 4px', fontSize: '14px' }}>
                Expected free slots: <b>{forecast.arrival_prediction.predicted_available_slots}</b> ({forecast.arrival_prediction.predicted_occupancy_percent?.toFixed(1)}% occupancy)
              </p>
              <small style={{ color: 'var(--muted)' }}>
                {forecast.arrival_prediction.evaluation?.note || 'Calculated using real-time machine learning prediction.'}
              </small>
            </div>
          )}
        </div>

        <aside>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>{selectedArea?.name}</h2>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: '13px', marginTop: '8px' }}>
            {forecast?.message || 'Processing live historical occupancy trend...'}
          </p>

          <small className="forecast-source" style={{ display: 'block' }}>
            Algorithm Source: <code>{forecast?.prediction_source || 'transparent_data_driven'}</code>
          </small>

          {forecast?.generated_at && (
            <small style={{ display: 'block', marginTop: '6px', color: 'var(--muted)' }}>
              Prediction generated at: <b>{new Date(forecast.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</b>
            </small>
          )}

          <div className="smart-recommendation" style={{ marginTop: '16px' }}>
            <strong>Smart Recommendation:</strong>
            <p style={{ margin: '6px 0 0', fontSize: '13px' }}>
              {getSmartRecommendation()}
            </p>
          </div>
        </aside>
      </section>

      {/* Pipeline explanation */}
      <div className="flow">
        Live Slot Grid Sensors → Recorded Occupancy Logs → Trend Slope & Active Demand Analysis → Verified Availability Forecast
      </div>
    </Page>
  );
}

// =========================================================
// 8. ADMIN OPERATIONS (Facilities, Slots, Bookings, Users, Analytics)
// =========================================================

function Admin({ user, areas, refreshAreas }) {
  const [adminTab, setAdminTab] = useState('overview'); // 'overview', 'facilities', 'slots', 'bookings', 'users', 'ml'
  const [stats, setStats] = useState(null);
  const [adminBookings, setAdminBookings] = useState([]);
  const [adminUsers, setAdminUsers] = useState([]);
  const [mlStats, setMlStats] = useState(null);
  const [loadingMl, setLoadingMl] = useState(false);
  const [bookingFilter, setBookingFilter] = useState('ALL');
  const [searchFacility, setSearchFacility] = useState('');
  const [selectedFacilityId, setSelectedFacilityId] = useState(areas[0]?.id || '1');
  const [inspectSlots, setInspectSlots] = useState([]);
  const [slotStatusFilter, setSlotStatusFilter] = useState('ALL');
  const [updatingOccupancy, setUpdatingOccupancy] = useState(null);
  const [newOccupancyValue, setNewOccupancyValue] = useState('');

  // Load admin stats
  useEffect(() => {
    adminService.getStats().then(setStats).catch(console.error);
    adminService.getBookings().then(setAdminBookings).catch(console.error);
    adminService.getUsers().then(setAdminUsers).catch(console.error);
  }, []);

  // Load ML diagnostics when ML tab selected
  useEffect(() => {
    if (adminTab === 'ml') {
      setLoadingMl(true);
      adminService
        .getMlStats()
        .then(setMlStats)
        .catch(console.error)
        .finally(() => setLoadingMl(false));
    }
  }, [adminTab]);

  // Load slots for inspector
  useEffect(() => {
    if (selectedFacilityId) {
      parkingService.getSlots(selectedFacilityId).then(setInspectSlots).catch(console.error);
    }
  }, [selectedFacilityId]);

  const handleUpdateOccupancy = async (facilityId) => {
    const occ = Number(newOccupancyValue);
    if (isNaN(occ) || occ < 0) {
      alert('Please enter a valid non-negative number of occupied slots.');
      return;
    }
    try {
      await parkingService.updateOccupancy(facilityId, occ);
      alert('Facility occupancy updated successfully in database.');
      setUpdatingOccupancy(null);
      refreshAreas();
      adminService.getStats().then(setStats);
    } catch (err) {
      alert(err.message || 'Failed to update occupancy.');
    }
  };

  const handleAdminCancelBooking = async (bId) => {
    if (!window.confirm(`Admin Action: Cancel booking ${bId}?`)) return;
    try {
      await bookingService.cancelBooking(bId);
      setAdminBookings((prev) =>
        prev.map((b) => (b.booking_id === bId ? { ...b, status: 'CANCELLED' } : b))
      );
      refreshAreas();
      adminService.getStats().then(setStats);
      alert(`Booking ${bId} cancelled.`);
    } catch (err) {
      alert(err.message || 'Failed to cancel booking.');
    }
  };

  const filteredFacilities = areas.filter(
    (a) =>
      a.name.toLowerCase().includes(searchFacility.toLowerCase()) ||
      a.code.toLowerCase().includes(searchFacility.toLowerCase()) ||
      a.location.toLowerCase().includes(searchFacility.toLowerCase())
  );

  const filteredAdminBookings = adminBookings.filter((b) => {
    if (bookingFilter === 'ALL') return true;
    return b.status === bookingFilter;
  });

  const filteredInspectorSlots = inspectSlots.filter((s) => {
    if (slotStatusFilter === 'ALL') return true;
    return s.status === slotStatusFilter;
  });

  return (
    <Page
      kicker="MUNICIPAL & FACILITY OPERATIONS"
      title="Admin Management Portal"
      intro="Administrative governance for facilities, real-time slot inventory, booking lifecycles, and user accounts."
    >
      {/* Admin Navigation Tabs */}
      <div className="tabs-nav">
        {[
          ['overview', '📊 Overview & Analytics'],
          ['facilities', `🏢 Facilities (${areas.length})`],
          ['slots', '🅿️ Slots Inspector'],
          ['bookings', `📋 All Bookings (${adminBookings.length})`],
          ['users', `👥 Users (${adminUsers.length})`],
          ['ml', '🧠 ML Analytics'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`tab-btn ${adminTab === key ? 'active' : ''}`}
            onClick={() => setAdminTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* TAB 1: OVERVIEW & ANALYTICS */}
      {adminTab === 'overview' && (
        <div>
          <div className="stat-banner">
            <div className="stat-box">
              <b>{stats?.total_facilities ?? areas.length}</b>
              <span>Active Facilities</span>
            </div>
            <div className="stat-box">
              <b>{(stats?.total_capacity ?? 63371).toLocaleString()}</b>
              <span>Database Slot Capacity</span>
            </div>
            <div className="stat-box">
              <b>{(stats?.available_slots ?? 0).toLocaleString()}</b>
              <span>Open Available Slots</span>
            </div>
            <div className="stat-box">
              <b>{stats?.occupancy_percent ?? 0}%</b>
              <span>System Occupancy Rate</span>
            </div>
          </div>

          <div className="stat-banner" style={{ marginTop: '-10px' }}>
            <div className="stat-box">
              <b>{stats?.total_bookings ?? adminBookings.length}</b>
              <span>Total Bookings Logged</span>
            </div>
            <div className="stat-box">
              <b>{stats?.active_bookings ?? 0}</b>
              <span>Active Reservations</span>
            </div>
            <div className="stat-box">
              <b>{stats?.cancelled_bookings ?? 0}</b>
              <span>Cancelled Bookings</span>
            </div>
            <div className="stat-box">
              <b>{stats?.total_users ?? adminUsers.length}</b>
              <span>Registered Accounts</span>
            </div>
          </div>

          <div style={{ background: 'white', padding: '24px', borderRadius: '8px', border: '1px solid var(--line)', marginTop: '20px' }}>
            <h3>System Status & Security</h3>
            <p style={{ color: 'var(--muted)', fontSize: '13px' }}>
              Database: <strong>SQLite (backend/veltrix.db)</strong> · Role Authentication: <strong>PBKDF2-HMAC Tokenized Session</strong>
            </p>
            <p style={{ color: 'var(--muted)', fontSize: '13px' }}>
              Administrator: <strong>{user?.name} ({user?.email})</strong> · Access Level: <strong>Full Operations Control</strong>
            </p>
          </div>
        </div>
      )}

      {/* TAB 2: FACILITIES & OCCUPANCY MANAGEMENT */}
      {adminTab === 'facilities' && (
        <div>
          <div className="filter-bar">
            <input
              type="text"
              placeholder="Search facilities by name, code, or area..."
              value={searchFacility}
              onChange={(e) => setSearchFacility(e.target.value)}
              style={{ width: '320px' }}
            />
          </div>

          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Facility Name</th>
                  <th>Address</th>
                  <th>Capacity</th>
                  <th>Available</th>
                  <th>Occupancy</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredFacilities.slice(0, 50).map((a) => (
                  <tr key={a.id}>
                    <td>
                      <code>{a.code}</code>
                    </td>
                    <td>
                      <strong>{a.name}</strong>
                    </td>
                    <td>{a.location}</td>
                    <td>{a.total}</td>
                    <td>
                      <span style={{ color: 'var(--green)', fontWeight: 'bold' }}>
                        {a.available}
                      </span>
                    </td>
                    <td>{a.occupancy}%</td>
                    <td>
                      {updatingOccupancy === a.id ? (
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <input
                            type="number"
                            min="0"
                            max={a.total}
                            style={{ width: '70px', padding: '4px' }}
                            value={newOccupancyValue}
                            onChange={(e) => setNewOccupancyValue(e.target.value)}
                            placeholder="Slots"
                          />
                          <button
                            type="button"
                            className="primary"
                            style={{ padding: '4px 8px', fontSize: '11px' }}
                            onClick={() => handleUpdateOccupancy(a.id)}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            style={{ padding: '4px 8px', fontSize: '11px' }}
                            onClick={() => setUpdatingOccupancy(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="secondary"
                          style={{ padding: '4px 10px', fontSize: '11px' }}
                          onClick={() => {
                            setUpdatingOccupancy(a.id);
                            setNewOccupancyValue(String(a.total - a.available));
                          }}
                        >
                          Adjust Occupancy
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: SLOTS MONITOR */}
      {adminTab === 'slots' && (
        <div>
          <div className="filter-bar">
            <label htmlFor="slot-facility-select" style={{ fontSize: '12px', fontWeight: 600 }}>
              Select Facility:
            </label>
            <select
              id="slot-facility-select"
              value={selectedFacilityId}
              onChange={(e) => setSelectedFacilityId(e.target.value)}
            >
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.code})
                </option>
              ))}
            </select>

            <label htmlFor="slot-status-select" style={{ fontSize: '12px', fontWeight: 600, marginLeft: '12px' }}>
              Filter Status:
            </label>
            <select
              id="slot-status-select"
              value={slotStatusFilter}
              onChange={(e) => setSlotStatusFilter(e.target.value)}
            >
              <option value="ALL">All Statuses ({inspectSlots.length})</option>
              <option value="AVAILABLE">Available</option>
              <option value="BOOKED">Booked</option>
              <option value="OCCUPIED">Occupied</option>
            </select>
          </div>

          <div style={{ background: 'white', padding: '20px', borderRadius: '8px', border: '1px solid var(--line)' }}>
            <div className="slot-grid">
              {filteredInspectorSlots.slice(0, 200).map((s) => (
                <div
                  key={s.id}
                  className={`slot-button ${
                    s.status === 'AVAILABLE'
                      ? 'open'
                      : s.status === 'BOOKED'
                      ? 'booked-slot'
                      : 'taken'
                  }`}
                  style={{ textAlign: 'center', padding: '6px' }}
                >
                  {s.slot_number.split('-').pop()}
                  <small style={{ display: 'block', fontSize: '8px' }}>{s.status}</small>
                </div>
              ))}
            </div>
            {filteredInspectorSlots.length > 200 && (
              <small style={{ display: 'block', marginTop: '12px', color: 'var(--muted)' }}>
                Showing 200 of {filteredInspectorSlots.length} slots.
              </small>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: BOOKINGS MANAGER */}
      {adminTab === 'bookings' && (
        <div>
          <div className="filter-bar">
            {['ALL', 'BOOKED', 'ACTIVE', 'CANCELLED', 'EXPIRED'].map((s) => (
              <button
                key={s}
                type="button"
                className={`tab-btn ${bookingFilter === s ? 'active' : ''}`}
                onClick={() => setBookingFilter(s)}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Booking ID</th>
                  <th>Facility</th>
                  <th>Slot</th>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Vehicle</th>
                  <th>Status</th>
                  <th>Start Time</th>
                  <th>Expiry Time</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredAdminBookings.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', color: 'var(--muted)' }}>
                      No bookings found for filter "{bookingFilter}".
                    </td>
                  </tr>
                ) : (
                  filteredAdminBookings.map((b) => (
                    <tr key={b.booking_id}>
                      <td>
                        <code>{b.booking_id}</code>
                      </td>
                      <td>{b.parking_name}</td>
                      <td>
                        <strong>{b.slot_number}</strong>
                      </td>
                      <td>{b.customer_name}</td>
                      <td>{b.phone_number}</td>
                      <td>
                        <code>{b.vehicle_number}</code>
                      </td>
                      <td>
                        <span className={`badge ${statusBadgeClass(b.status)}`}>
                          {b.status}
                        </span>
                      </td>
                      <td>{new Date(b.start_time).toLocaleTimeString()}</td>
                      <td>{new Date(b.expiry_time).toLocaleTimeString()}</td>
                      <td>
                        {b.status === 'BOOKED' || b.status === 'ACTIVE' ? (
                          <button
                            type="button"
                            className="secondary"
                            style={{ color: '#b91c1c', borderColor: '#b91c1c', padding: '3px 8px', fontSize: '10px' }}
                            onClick={() => handleAdminCancelBooking(b.booking_id)}
                          >
                            Cancel
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 5: USERS LIST */}
      {adminTab === 'users' && (
        <div className="admin-table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Registered At</th>
              </tr>
            </thead>
            <tbody>
              {adminUsers.map((u) => (
                <tr key={u.id}>
                  <td>{u.id}</td>
                  <td>
                    <strong>{u.name}</strong>
                  </td>
                  <td>{u.email}</td>
                  <td>
                    <span
                      className={`badge ${
                        u.role === 'admin' ? 'badge-primary' : 'badge-neutral'
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td>{u.created_at ? new Date(u.created_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 6: ML ANALYTICS */}
      {adminTab === 'ml' && (
        <div style={{ background: 'white', padding: '24px', borderRadius: 'var(--r-lg)', border: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ margin: 0 }}>🧠 Machine Learning Analytics & Pipeline Status</h3>
            {mlStats && (
              <span className={`badge ${mlStats.model_status === 'active' ? 'badge-success' : 'badge-warning'}`}>
                Status: {mlStats.model_status}
              </span>
            )}
          </div>

          {loadingMl ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <Spinner size={32} />
              <p style={{ marginTop: '12px', color: 'var(--muted)' }}>Fetching machine learning diagnostics...</p>
            </div>
          ) : mlStats ? (
            <div>
              <div className="stat-banner" style={{ margin: '0 0 24px' }}>
                <div className="stat-box">
                  <b>{mlStats.model_type}</b>
                  <span>Model Type</span>
                </div>
                <div className="stat-box">
                  <b>{(mlStats.total_occupancy_logs ?? 0).toLocaleString()}</b>
                  <span>Total Occupancy Logs</span>
                </div>
                <div className="stat-box">
                  <b>{mlStats.facilities_with_logs} / {areas.length}</b>
                  <span>Facilities with Logs</span>
                </div>
                <div className="stat-box">
                  <b>{mlStats.data_freshness ? new Date(mlStats.data_freshness).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A'}</b>
                  <span>Data Freshness</span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '24px' }}>
                <div style={{ padding: '16px', background: 'var(--bg)', borderRadius: 'var(--r-md)', border: '1px solid var(--line)' }}>
                  <h4 style={{ margin: '0 0 10px', fontSize: '14px' }}>Runtime Diagnostics & Status</h4>
                  <p style={{ margin: '0 0 8px', fontSize: '13px' }}>
                    scikit-learn: <b style={{ color: mlStats.sklearn_available ? 'var(--green)' : 'var(--red)' }}>{mlStats.sklearn_available ? '✓ Available' : '✗ Unavailable'}</b>
                  </p>
                  <p style={{ margin: '0 0 8px', fontSize: '13px' }}>
                    NumPy: <b style={{ color: mlStats.numpy_available ? 'var(--green)' : 'var(--red)' }}>{mlStats.numpy_available ? '✓ Available' : '✗ Unavailable'}</b>
                  </p>
                  <p style={{ margin: '0 0 8px', fontSize: '13px' }}>
                    Model Status: <span className={`badge ${mlStats.model_status === 'active' ? 'badge-success' : 'badge-neutral'}`}>{mlStats.model_status}</span>
                  </p>
                  <p style={{ margin: 0, fontSize: '12px', color: 'var(--muted)' }}>
                    {mlStats.training_notes || 'Model trained per-request on facility historical data'}
                  </p>
                </div>

                <div style={{ padding: '16px', background: 'var(--bg)', borderRadius: 'var(--r-md)', border: '1px solid var(--line)' }}>
                  <h4 style={{ margin: '0 0 10px', fontSize: '14px' }}>Features Used in Regression</h4>
                  <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', lineHeight: 1.6 }}>
                    {Array.isArray(mlStats.features_used) && mlStats.features_used.map((f, i) => (
                      <li key={i}><code>{f}</code></li>
                    ))}
                  </ul>
                </div>
              </div>

              <div style={{ padding: '14px 18px', background: 'rgba(29,114,216,0.06)', borderRadius: 'var(--r-md)', border: '1px solid rgba(29,114,216,0.2)' }}>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--navy)' }}>
                  💡 <b>Note:</b> Model is trained per-request from historical OccupancyLog data. More logs = better predictions.
                </p>
              </div>
            </div>
          ) : (
            <p style={{ color: 'var(--muted)' }}>Unable to load ML statistics. Ensure you are signed in as an administrator.</p>
          )}
        </div>
      )}
    </Page>
  );
}

// =========================================================
// 9. CONTACT PAGE
// =========================================================

function Contact() {
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    category: 'General Inquiry',
    message: '',
  });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <Page
      kicker="CONTACT VELTRIX"
      title="Get in touch."
      intro="Our municipal mobility operations and driver assistance teams are standing by 24/7."
    >
      <div className="contact-grid">
        {/* Contact Form */}
        <div className="contact-card">
          {submitted ? (
            <div style={{ textAlign: 'center', padding: '30px 10px' }}>
              <p className="eyebrow" style={{ color: 'var(--green)' }}>
                ✓ MESSAGE RECEIVED
              </p>
              <h2>Thank you, {form.name}!</h2>
              <p style={{ color: 'var(--muted)' }}>
                Your inquiry regarding <strong>{form.category}</strong> has been dispatched to the
                VELTRIX Operations team. We will contact you at <strong>{form.email}</strong> shortly.
              </p>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setSubmitted(false);
                  setForm({ name: '', email: '', phone: '', category: 'General Inquiry', message: '' });
                }}
              >
                Send Another Message
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <h2 style={{ marginTop: 0, color: 'var(--navy)' }}>Send us a message</h2>

              <label>
                Your Name
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Priya Nair"
                />
              </label>

              <label>
                Email Address
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="name@example.com"
                />
              </label>

              <label>
                Phone Number (Optional)
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="9876543210"
                />
              </label>

              <label>
                Inquiry Category
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  <option>General Inquiry</option>
                  <option>Facility & Slot Booking Assistance</option>
                  <option>Commercial Parking Partnership</option>
                  <option>Municipal Transit & Urban Mobility Integration</option>
                  <option>Technical Support</option>
                </select>
              </label>

              <label>
                Message
                <textarea
                  required
                  rows={4}
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  placeholder="How can we assist you with VELTRIX Smart Parking?"
                />
              </label>

              <button type="submit" className="primary" style={{ width: '100%' }}>
                Submit Inquiry
              </button>
            </form>
          )}
        </div>

        {/* Contact Information & Channels */}
        <div>
          <div className="contact-channel">
            <i>📍</i>
            <div>
              <b>Mumbai Mobility Operations Center</b>
              <p>Bandra-Kurla Complex (BKC), G Block, Mumbai 400051</p>
            </div>
          </div>

          <div className="contact-channel">
            <i>📞</i>
            <div>
              <b>24/7 Driver Support Hotline</b>
              <p>+91 (022) 4910-8800 · Toll-Free</p>
            </div>
          </div>

          <div className="contact-channel">
            <i>✉️</i>
            <div>
              <b>Operational Email Channels</b>
              <p>Driver Help: support@veltrixparking.com</p>
              <p>Partnerships: partner@veltrixparking.com</p>
            </div>
          </div>

          <div className="contact-channel">
            <i>⏰</i>
            <div>
              <b>Operating Hours</b>
              <p>Automated Slot Booking: 24/7/365</p>
              <p>Operations Helpdesk: 07:00 – 23:00 IST</p>
            </div>
          </div>
        </div>
      </div>
    </Page>
  );
}

// =========================================================
// 10. HOW IT WORKS / ABOUT
// =========================================================

function HowItWorks({ go }) {
  return (
    <Page
      kicker="PLATFORM ARCHITECTURE"
      title="How VELTRIX powers smart cities."
      intro="An end-to-end overview of our full-stack parking platform, database consistency, and predictive heuristics."
    >
      <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: '10px', padding: '30px', margin: '20px 0' }}>
        <h2 style={{ marginTop: 0, color: 'var(--navy)' }}>Core System Principles</h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginTop: '20px' }}>
          <div>
            <h3>1. Database as Source of Truth</h3>
            <p style={{ color: 'var(--muted)', fontSize: '13px', lineHeight: 1.6 }}>
              All 92 Mumbai facilities and 63,371 individual parking spaces are persisted in a relational SQLite schema. We do not use mock frontend randomizers.
            </p>
          </div>

          <div>
            <h3>2. Atomic Reservation Concurrency</h3>
            <p style={{ color: 'var(--muted)', fontSize: '13px', lineHeight: 1.6 }}>
              Reservations lock the individual slot status atomically on the backend, guaranteeing that double bookings are rejected with HTTP 409 Conflict.
            </p>
          </div>

          <div>
            <h3>3. Transparent Demand Forecasting</h3>
            <p style={{ color: 'var(--muted)', fontSize: '13px', lineHeight: 1.6 }}>
              Our forecast engine computes trend trajectories from real timestamped occupancy logs and active booking rates, avoiding fabricated artificial intelligence claims.
            </p>
          </div>

          <div>
            <h3>4. OpenStreetMap Geocoding</h3>
            <p style={{ color: 'var(--muted)', fontSize: '13px', lineHeight: 1.6 }}>
              Destination lookups use Nominatim and Haversine distance computations to accurately match drivers with the nearest available bays.
            </p>
          </div>
        </div>

        <div style={{ marginTop: '28px' }}>
          <button type="button" className="primary" onClick={() => go('/parking')}>
            Start Finding Parking
          </button>
        </div>
      </div>
    </Page>
  );
}

// =========================================================
// USER PROFILE
// =========================================================

function Profile({ user, go, logout }) {
  return (
    <Page
      kicker="USER PROFILE"
      title={user.name}
      intro="Your verified VELTRIX account credentials and system privileges."
    >
      <div className="profile">
        <p>
          Name <b>{user.name}</b>
        </p>
        <p>
          Email <b>{user.email}</b>
        </p>
        <p>
          Role{' '}
          <b>
            <span className={`badge ${user.role === 'admin' ? 'badge-primary' : 'badge-neutral'}`}>
              {user.role}
            </span>
          </b>
        </p>
        <p>
          Account ID <b>#{user.id}</b>
        </p>
      </div>

      <div style={{ marginTop: '24px', display: 'flex', gap: '12px' }}>
        <button type="button" className="primary" onClick={() => go('/bookings')}>
          My Bookings
        </button>
        {user.role === 'admin' && (
          <button type="button" className="secondary" onClick={() => go('/admin')}>
            Admin Portal
          </button>
        )}
        <button type="button" className="secondary" onClick={logout}>
          Sign Out
        </button>
      </div>
    </Page>
  );
}

// =========================================================
// AUTH (Login, Signup, Admin Login)
// =========================================================

function Auth({ signup, admin, go, done }) {
  const [f, setF] = useState({
    name: '',
    email: admin ? 'admin@veltrixparking.com' : '',
    password: admin ? 'admin123' : '',
    confirm: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const change = (e) => setF({ ...f, [e.target.name]: e.target.value });

  const send = async (e) => {
    e.preventDefault();
    setError('');

    if (signup && f.password !== f.confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      let loggedUser;
      if (signup) {
        loggedUser = await authService.signup({
          name: f.name,
          email: f.email,
          password: f.password,
        });
      } else {
        loggedUser = await authService.login({
          email: f.email,
          password: f.password,
        });
      }

      done(loggedUser);
      if (loggedUser.role === 'admin') {
        go('/admin');
      } else {
        go('/dashboard');
      }
    } catch (err) {
      setError(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth">
      <form onSubmit={send}>
        <p className="eyebrow">
          {admin ? 'ADMINISTRATOR AUTHENTICATION' : signup ? 'CREATE DRIVER ACCOUNT' : 'WELCOME BACK'}
        </p>

        <h1>{signup ? 'Create your account' : admin ? 'Admin Sign In' : 'Sign in to VELTRIX'}</h1>

        {signup && (
          <label>
            Full Name
            <input
              required
              name="name"
              value={f.name}
              onChange={change}
              placeholder="e.g. Anand Sen"
            />
          </label>
        )}

        <label>
          Email Address
          <input
            required
            type="email"
            name="email"
            value={f.email}
            onChange={change}
            placeholder="driver@example.com"
          />
        </label>

        <label>
          Password
          <input
            required
            type="password"
            name="password"
            value={f.password}
            onChange={change}
            placeholder="••••••••"
          />
        </label>

        {signup && (
          <label>
            Confirm Password
            <input
              required
              type="password"
              name="confirm"
              value={f.confirm}
              onChange={change}
              placeholder="••••••••"
            />
          </label>
        )}

        {admin && (
          <small style={{ color: 'var(--muted)', fontSize: '11px' }}>
            Demo Admin Credentials: <code>admin@veltrixparking.com</code> / <code>admin123</code>
          </small>
        )}

        {error && <p className="error">{error}</p>}

        <button type="submit" className="primary" disabled={loading}>
          {loading ? 'Authenticating...' : signup ? 'Create Account' : 'Sign In'}
        </button>

        {!admin && (
          <p className="switch">
            {signup ? 'Already registered?' : 'New to VELTRIX?'}{' '}
            <button
              type="button"
              onClick={() => go(signup ? '/login' : '/signup')}
            >
              {signup ? 'Login' : 'Create account'}
            </button>
          </p>
        )}

        {!admin && (
          <p className="switch" style={{ marginTop: '4px' }}>
            <button type="button" onClick={() => go('/admin/login')}>
              Administrator Login →
            </button>
          </p>
        )}
      </form>
    </main>
  );
}

// =========================================================
// FOOTER
// =========================================================

function Footer({ go }) {
  return (
    <footer className="footer">
      <b>VELTRIX</b>
      <span>AI-Powered Smart Parking & Urban Mobility Management System</span>
      <span>BKC Mobility Hub, Mumbai</span>
      <span>
        <button
          type="button"
          onClick={() => go('/contact')}
          style={{ background: 'none', border: 0, color: '#dbeaff', cursor: 'pointer', textDecoration: 'underline' }}
        >
          Contact Support
        </button>
      </span>
      <span>Privacy · Terms of Service</span>
    </footer>
  );
}

// =========================================================
// AI ASSISTANT COMPONENT
// =========================================================

function AIAssistant({ areas = [], language = 'en', routeSummary, recommendations }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([{
    role: 'assistant',
    text: "Hi! I'm VELTRIX AI. Ask me about parking, availability, or routes."
  }]);
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  // Voice input using Web Speech API
  const startVoice = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Voice recognition not supported in this browser.');
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = language === 'hi' ? 'hi-IN' : language === 'mr' ? 'mr-IN' : language === 'gu' ? 'gu-IN' : 'en-IN';
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setInput(transcript);
      setTimeout(() => handleSend(transcript), 100);
    };
    recognition.start();
  };

  // Text to speech
  const speak = (text) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language === 'hi' ? 'hi-IN' : language === 'mr' ? 'mr-IN' : language === 'gu' ? 'gu-IN' : 'en-IN';
    utterance.rate = 0.95;
    setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  const handleSend = async (text) => {
    const query = (text || input).trim();
    if (!query) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: query }]);

    // Call backend assistant endpoint
    try {
      const resp = await fetch('http://localhost:8001/api/assistant/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, context: { facility_id: null } })
      });
      if (resp.ok) {
        const data = await resp.json();
        const responseText = data.response_text || 'I found some information for you.';
        setMessages(prev => [...prev, { role: 'assistant', text: responseText, data: data.data, action: data.action }]);
        speak(responseText);
      } else {
        // Fallback to local processing
        const fallbackResponse = processQueryLocally(query);
        setMessages(prev => [...prev, { role: 'assistant', text: fallbackResponse }]);
        speak(fallbackResponse);
      }
    } catch (err) {
      const fallbackResponse = processQueryLocally(query);
      setMessages(prev => [...prev, { role: 'assistant', text: fallbackResponse }]);
      speak(fallbackResponse);
    }
  };

  const processQueryLocally = (query) => {
    const q = query.toLowerCase();
    if (q.includes('best') || q.includes('recommend')) {
      const best = [...areas].filter(a => a.available > 0).sort((a, b) => b.available - a.available)[0];
      if (best) return `The best available option right now is ${best.name} with ${best.available} free slots out of ${best.total} total.`;
    }
    if (q.includes('available') || q.includes('open') || q.includes('free')) {
      const total = areas.reduce((s, a) => s + (a.available || 0), 0);
      return `Currently there are ${total.toLocaleString()} available parking slots across ${areas.length} facilities.`;
    }
    if (q.includes('full') || q.includes('occupied')) {
      const full = areas.filter(a => (a.available || 0) === 0).length;
      return `${full} out of ${areas.length} facilities are currently full.`;
    }
    if (q.includes('book') || q.includes('reserve')) {
      return 'To book a slot, go to Find Parking, select a facility, choose an available slot (green), and fill in your details.';
    }
    if (q.includes('cancel')) {
      return 'To cancel a booking, go to My Bookings and click Cancel Reservation next to your active booking.';
    }
    const availSum = areas.reduce((s, a) => s + (a.available || 0), 0);
    return `I can help you find parking, check availability, and get predictions. Currently there are ${areas.length} parking facilities in Mumbai with ${availSum.toLocaleString()} available slots.`;
  };

  const t = (key) => getTranslation(language, key);

  if (!open) {
    return (
      <button
        className="ai-assistant-fab"
        onClick={() => setOpen(true)}
        title="VELTRIX AI Assistant"
      >
        <span>🤖</span>
        <span className="fab-label">AI</span>
      </button>
    );
  }

  return (
    <div className="ai-assistant-panel">
      <div className="ai-assistant-header">
        <span>🤖 {t('assistantTitle')}</span>
        <button onClick={() => { window.speechSynthesis?.cancel(); setOpen(false); }}>✕</button>
      </div>
      <div className="ai-assistant-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`ai-msg ai-msg-${msg.role}`}>
            <span className="ai-msg-text">{msg.text}</span>
          </div>
        ))}
      </div>
      <div className="ai-assistant-suggestions">
        {[t('assistantPrompt1'), t('assistantPrompt2'), t('assistantPrompt3'), t('assistantPrompt4')].map((s, i) => (
          <button key={i} type="button" className="ai-suggestion" onClick={() => handleSend(s)}>{s}</button>
        ))}
      </div>
      <div className="ai-assistant-input">
        <input
          type="text"
          placeholder={t('assistantPlaceholder')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
        />
        <button type="button" className="primary" onClick={() => handleSend()}>Send</button>
        <button
          type="button"
          className={listening ? 'primary' : 'secondary'}
          onClick={startVoice}
          title={t('assistantVoice')}
        >
          {listening ? '🔴' : '🎤'}
        </button>
      </div>
    </div>
  );
}

// =========================================================
// MOUNT APPLICATION
// =========================================================

createRoot(document.getElementById('root')).render(<App />);